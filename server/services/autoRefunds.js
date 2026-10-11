import { db } from '../db/index.js';
import { adminAlert } from './audit.js';
import { getStripe } from './stripe.js';

// คิวคืนเงินอัตโนมัติ (outbox): webhook บันทึกงานใน transaction เดียวกับผลการประมวลผล แล้วเรียก Stripe หลัง commit
// ล้มเหลว → retry แบบ backoff (idempotency key เดิม จึงไม่คืนเงินซ้ำ) ; ครั้งแรกที่ล้มเหลวและเมื่อเลิกลองแจ้งแอดมิน
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
let running = false;
export const isAutoRefundBusy = () => running;

// เรียกภายใน transaction ของผู้เรียก — payment_intent เดิมซ้ำจะถูกเมิน (คืนเงินได้ครั้งเดียวอยู่แล้ว)
export function enqueueAutoRefund({ paymentIntent, orderId, reason }, now = Date.now()) {
  db.prepare('INSERT OR IGNORE INTO auto_refunds (payment_intent, order_id, reason, next_attempt_at) VALUES (?, ?, ?, ?)')
    .run(paymentIntent, orderId ?? null, reason, now);
}

const inFlight = new Set(); // งานที่กำลังเรียก Stripe อยู่ (รอบตั้งเวลากับ webhook ไม่ทำงานเดียวกันซ้อนกัน)

async function attempt(listed, now) {
  // อ่านสถานะล่าสุดก่อนเรียก Stripe: รายการของรอบตั้งเวลาอาจเก่าแล้ว (webhook ทำงานนี้เสร็จไประหว่างนั้น)
  const job = db.prepare("SELECT * FROM auto_refunds WHERE id = ? AND status = 'pending' AND next_attempt_at <= ?").get(listed.id, now);
  if (!job) return 0;
  try {
    const refund = await getStripe().refunds.create(
      { payment_intent: job.payment_intent, metadata: { auto_reason: job.reason, order_id: String(job.order_id ?? '') } },
      { idempotencyKey: `auto-refund-${job.payment_intent}` },
    );
    db.transaction(() => {
      db.prepare("UPDATE auto_refunds SET status = 'done', attempts = attempts + 1, last_error = NULL, provider_refund_id = ?, done_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(refund?.id ?? null, job.id);
      db.prepare("UPDATE payments SET status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE payment_intent = ? AND status = 'needs_review'").run(job.payment_intent);
    })();
    return 1;
  } catch (e) {
    const attempts = job.attempts + 1;
    const what = `คืนเงินอัตโนมัติ (${job.reason}, ${job.payment_intent})`;
    if (attempts >= MAX_ATTEMPTS) {
      db.prepare("UPDATE auto_refunds SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?").run(attempts, e.message, job.id);
      adminAlert('REFUND_FAILED', job.order_id, `${what} ไม่สำเร็จหลังลอง ${attempts} ครั้ง: ${e.message} — ต้องคืนเงินด้วยตนเองที่ Stripe Dashboard`);
    } else {
      db.prepare('UPDATE auto_refunds SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?')
        .run(attempts, e.message, now + BACKOFF_MS[attempts - 1], job.id);
      if (attempts === 1) adminAlert('REFUND_FAILED', job.order_id, `${what} ไม่สำเร็จ: ${e.message} — ระบบจะลองใหม่อัตโนมัติ (ลูกค้ายังไม่ได้เงินคืน)`);
    }
  }
  return 0;
}

// paymentIntent: ทำเฉพาะงานของการชำระนั้น (webhook เรียกหลังบันทึกงาน — ไม่ต้องรองานเก่าที่ค้างอีกสูงสุด 20 งาน
// และไม่ถูกข้ามเมื่อรอบตั้งเวลากำลังทำงานอยู่) ; ไม่ระบุ = รอบตั้งเวลา ทำงานที่ถึงเวลาทั้งหมด
export async function processAutoRefunds(now = Date.now(), { paymentIntent } = {}) {
  if (!paymentIntent) {
    if (running) return 0;
    running = true;
  }
  let done = 0;
  try {
    const due = paymentIntent
      ? db.prepare("SELECT * FROM auto_refunds WHERE status = 'pending' AND payment_intent = ? AND next_attempt_at <= ?").all(paymentIntent, now)
      : db.prepare("SELECT * FROM auto_refunds WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT 20").all(now);
    for (const job of due) {
      if (inFlight.has(job.id)) continue;
      inFlight.add(job.id);
      try { done += await attempt(job, now); } finally { inFlight.delete(job.id); }
    }
  } finally {
    if (!paymentIntent) running = false;
  }
  return done;
}
