import { config } from '../config.js';
import { db } from '../db/index.js';
import { maskKey } from './crypto.js';
import { adminAlert } from './audit.js';
import { keysForOrder } from './keys.js';
import { sendMail } from './mail.js';

// คิวอีเมลแบบเบา ๆ ในฐานข้อมูล: ส่งล้มเหลวจะ retry แบบ backoff และไม่ทำให้ออเดอร์พัง
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
const MAX_ATTEMPTS = BACKOFF_MS.length;
let running = false;
export const isEmailQueueBusy = () => running;

const baht = (satang) => '฿' + (satang / 100).toLocaleString('en-US', { minimumFractionDigits: satang % 100 ? 2 : 0, maximumFractionDigits: 2 });

export function enqueueEmail(kind, orderId) {
  db.prepare('INSERT INTO email_queue (kind, order_id, next_attempt_at) VALUES (?, ?, ?)').run(kind, orderId, Date.now());
  // ประมวลผลทันทีหลังจบ transaction ปัจจุบัน (ในเทสจะสั่งเองเพื่อให้ผลแน่นอน)
  if (config.env !== 'test') setImmediate(() => processEmailQueue().catch((e) => console.error('email queue:', e.message)));
}

function buildOrderPaidEmail(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status !== 'paid') return null; // ถูกคืนเงิน/ยกเลิกไปแล้ว ไม่ส่งโค้ด
  const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(order.user_id);
  const items = db.prepare('SELECT title, platform, unit_price FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
  const keys = keysForOrder(orderId);
  const inv = db.prepare('SELECT number FROM invoices WHERE order_id = ?').get(orderId);

  const build = (fmtKey) => [
    `สวัสดี ${user.name},`,
    '',
    `ขอบคุณที่สั่งซื้อกับ ${config.shop.name} — คำสั่งซื้อ #${orderId} ชำระเงินเรียบร้อยแล้ว`,
    '',
    'รายการสั่งซื้อ / Items:',
    ...items.map((i) => `  - ${i.title} (${i.platform}): ${baht(i.unit_price)}`),
    ...(order.coupon_code ? [`  คูปอง ${order.coupon_code}: -${baht(order.coupon_discount)}`] : []),
    `ยอดสุทธิ / Total: ${baht(order.total)}${inv ? `   เลขที่ใบเสร็จ: ${inv.number}` : ''}`,
    '',
    'โค้ดเกมของคุณ / Your game keys:',
    ...keys.map((k) => `  - ${k.title}: ${fmtKey(k.code)}`),
    '',
    `ดูโค้ดและดาวน์โหลดใบเสร็จได้ที่ / View keys & download your receipt: ${config.appUrl}/order/${orderId}`,
    'โปรดเก็บโค้ดเป็นความลับ ไม่แชร์ให้ผู้อื่น / Keep your keys private.',
  ].join('\n');

  return { to: user.email, subject: `คำสั่งซื้อ #${orderId} สำเร็จ – โค้ดเกมของคุณ | Order #${orderId} confirmed`, text: build((c) => c), devLog: build(maskKey) };
}

const BUILDERS = { order_paid: buildOrderPaidEmail };

export async function processEmailQueue(now = Date.now()) {
  if (running) return 0;
  running = true;
  let sent = 0;
  try {
    const due = db.prepare("SELECT * FROM email_queue WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT 20").all(now);
    for (const job of due) {
      try {
        const msg = BUILDERS[job.kind]?.(job.order_id);
        if (msg) await sendMail(msg, { strict: true });
        db.prepare("UPDATE email_queue SET status = 'sent', sent_at = CURRENT_TIMESTAMP, attempts = attempts + 1, last_error = ? WHERE id = ?")
          .run(msg ? null : 'skipped: order no longer paid', job.id);
        if (msg) sent += 1;
      } catch (err) {
        const attempts = job.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          db.prepare("UPDATE email_queue SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?").run(attempts, err.message, job.id);
          adminAlert('EMAIL_FAILED', job.order_id, `ส่งอีเมล ${job.kind} ไม่สำเร็จหลัง ${attempts} ครั้ง: ${err.message}`);
        } else {
          db.prepare('UPDATE email_queue SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?')
            .run(attempts, err.message, now + BACKOFF_MS[attempts - 1], job.id);
        }
      }
    }
  } finally {
    running = false;
  }
  return sent;
}
