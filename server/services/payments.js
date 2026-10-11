import { config } from '../config.js';
import { db } from '../db/index.js';
import { adminAlert } from './audit.js';
import { enqueueAutoRefund, processAutoRefunds } from './autoRefunds.js';
import { HttpError } from './errors.js';
import { orderEvents, transition } from './orders.js';
import { formatBaht } from './pricing.js';
import { getStripe, stripeConfigured } from './stripe.js';

const MIN_AMOUNT = 1000; // ขั้นต่ำการเรียกเก็บของ Stripe สำหรับ THB = ฿10.00 (หน่วยสตางค์)
const REUSE_WINDOW = '-25 minutes'; // Checkout Session อายุ 31 นาที — เกินนี้ไม่ใช้ซ้ำ
const SESSION_TTL_MS = 31 * 60_000; // Stripe กำหนดอย่างน้อย 30 นาที
const PAYMENT_GRACE_MS = 5 * 60_000; // เผื่อ webhook มาช้าหลังลูกค้าจ่ายตอนท้าย session
const MAX_ORDER_LIFETIME_MS = 2 * 3600_000; // ต่ออายุออเดอร์ได้ไม่เกินนี้นับจากตอนสร้าง (กันกดชำระวนเพื่อกักโค้ดในสต็อก)

const createdAtMs = (order) => Date.parse(`${order.created_at.replace(' ', 'T')}Z`);

const touch = (id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE payments SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), id);
};

// ---------- เริ่มชำระเงิน: ยอดมาจากออเดอร์ในฐานข้อมูลเท่านั้น ----------
export async function createCheckout(user, order) {
  if (order.status !== 'pending') throw new HttpError(409, 'ชำระเงินได้เฉพาะคำสั่งซื้อที่รอชำระ', 'ORDER_NOT_PAYABLE');
  if (order.total < MIN_AMOUNT) throw new HttpError(422, 'ยอดต่ำกว่าขั้นต่ำของช่องทางชำระเงิน (฿10)', 'PAYMENT_TOO_SMALL');
  const stripe = getStripe(); // ไม่ได้ตั้งค่า → 503 พร้อมบอกว่าขาดอะไร

  const open = db.prepare(`SELECT * FROM payments WHERE order_id = ? AND provider = 'stripe' AND status = 'created'
    AND checkout_url IS NOT NULL AND created_at > datetime('now', ?) ORDER BY id DESC`).get(order.id, REUSE_WINDOW);
  if (open) return { url: open.checkout_url };

  // ออเดอร์ต้องอยู่ได้นานกว่า session ที่จะสร้าง ไม่งั้นลูกค้าที่จ่ายช่วงท้าย (โดยเฉพาะ PromptPay) จะจ่ายหลังออเดอร์ถูกยกเลิกแล้วโดนคืนเงิน
  const sessionExpiresAt = Date.now() + SESSION_TTL_MS;
  const orderMustLastUntil = sessionExpiresAt + PAYMENT_GRACE_MS;
  if (orderMustLastUntil > createdAtMs(order) + MAX_ORDER_LIFETIME_MS) {
    throw new HttpError(409, 'คำสั่งซื้อนี้เปิดไว้นานเกินกำหนดแล้ว กรุณายกเลิกแล้วสั่งซื้อใหม่', 'ORDER_TOO_OLD');
  }

  const titles = db.prepare('SELECT title FROM order_items WHERE order_id = ? ORDER BY id').all(order.id).map((r) => r.title).join(', ');
  const attempt = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE order_id = ? AND provider = 'stripe'").get(order.id).n + 1;
  const meta = { order_id: String(order.id), user_id: String(user.id) };

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'promptpay'],
      line_items: [{
        quantity: 1,
        price_data: { currency: 'thb', unit_amount: order.total, product_data: { name: `${config.shop.name} — Order #${order.id}`, description: titles.slice(0, 500) } },
      }],
      client_reference_id: String(order.id),
      metadata: meta,
      payment_intent_data: { metadata: meta },
      customer_email: user.email,
      success_url: `${config.appUrl}/order/${order.id}?checkout=return`,
      cancel_url: `${config.appUrl}/order/${order.id}?checkout=canceled`,
      expires_at: Math.floor(sessionExpiresAt / 1000),
    }, { idempotencyKey: `order-${order.id}-attempt-${attempt}` });
  } catch (e) {
    // รายละเอียดจาก Stripe (อาจมีข้อมูลบัญชี/การตั้งค่าร้าน) เก็บไว้ใน log เท่านั้น ลูกค้าเห็นข้อความทั่วไป
    console.error(`สร้าง Checkout Session ของออเดอร์ #${order.id} ไม่สำเร็จ:`, e.type ?? '', e.message);
    throw new HttpError(502, 'สร้างหน้าชำระเงินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 'PAYMENT_PROVIDER_ERROR');
  }

  db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO payments (order_id, provider, provider_ref, payment_intent, amount, currency, status, checkout_url)
      VALUES (?, 'stripe', ?, ?, ?, 'thb', 'created', ?)`)
      .run(order.id, session.id, session.payment_intent ?? null, order.total, session.url);
    db.prepare("UPDATE orders SET expires_at = MAX(expires_at, ?) WHERE id = ? AND status = 'pending'").run(orderMustLastUntil, order.id);
  })();
  return { url: session.url };
}

// ---------- จำลองการชำระเงิน (route ถูก mount เฉพาะนอก production) ----------
export function devPay(orderId) {
  return db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const paid = transition(orderId, 'paid'); // ตรวจ state machine + จัดสรรโค้ด
    db.prepare("INSERT INTO payments (order_id, provider, amount, currency, status) VALUES (?, 'dev', ?, 'thb', 'succeeded')").run(orderId, order.total);
    return paid;
  })();
}

// ---------- Webhook ----------
// ประมวลผลใน transaction เดียว (event id ถูกบันทึกพร้อมผลลัพธ์) → event เดิมมาซ้ำจะไม่ทำซ้ำ และถ้าพังกลางทางจะ rollback ให้ Stripe ส่งใหม่
// งานคืนเงินอัตโนมัติถูกบันทึกลงคิว auto_refunds ใน transaction เดียวกัน แล้วเรียก Stripe หลัง commit (ล้มเหลว/ล่ม → retry ภายหลัง)
export async function processStripeEvent(event) {
  const result = db.transaction(() => {
    const ins = db.prepare('INSERT OR IGNORE INTO webhook_events (id, type) VALUES (?, ?)').run(event.id, event.type);
    if (!ins.changes) return 'duplicate';
    const obj = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
        // บัตร: payment_status = paid ทันที / ช่องทางที่ยืนยันทีหลังจะมาเป็น async_payment_succeeded
        if (obj.payment_status === 'paid') {
          confirm(event, { orderId: orderIdOf(obj), amount: obj.amount_total, currency: obj.currency, paymentIntent: obj.payment_intent, sessionId: obj.id });
        }
        break;
      case 'checkout.session.async_payment_succeeded':
        confirm(event, { orderId: orderIdOf(obj), amount: obj.amount_total, currency: obj.currency, paymentIntent: obj.payment_intent, sessionId: obj.id });
        break;
      case 'payment_intent.succeeded':
        confirm(event, { orderId: orderIdOf(obj), amount: obj.amount_received ?? obj.amount, currency: obj.currency, paymentIntent: obj.id, sessionId: null });
        break;
      case 'payment_intent.payment_failed':
        markFailed({ paymentIntent: obj.id, orderId: orderIdOf(obj), error: obj.last_payment_error?.message ?? 'payment failed' });
        break;
      case 'checkout.session.async_payment_failed':
        markFailed({ sessionId: obj.id, orderId: orderIdOf(obj), error: 'async payment failed' });
        break;
      case 'checkout.session.expired': {
        const pay = db.prepare("SELECT id FROM payments WHERE provider = 'stripe' AND provider_ref = ? AND status = 'created'").get(obj.id);
        if (pay) touch(pay.id, { status: 'expired' });
        break;
      }
      case 'charge.refunded':
        onChargeRefunded(event, obj);
        break;
      default:
        return 'ignored';
    }
    return 'processed';
  })();
  await processAutoRefunds(); // คืนเงินทันทีถ้าทำได้ — ไม่สำเร็จก็ยังอยู่ในคิว (ไม่ทำให้ webhook ล้ม)
  return result;
}

const orderIdOf = (obj) => {
  const raw = obj.metadata?.order_id ?? obj.client_reference_id;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function markFailed({ paymentIntent, sessionId, orderId, error }) {
  const pay = (sessionId && db.prepare("SELECT * FROM payments WHERE provider = 'stripe' AND provider_ref = ?").get(sessionId))
    || (paymentIntent && db.prepare("SELECT * FROM payments WHERE provider = 'stripe' AND payment_intent = ?").get(paymentIntent))
    || (orderId && db.prepare("SELECT * FROM payments WHERE provider = 'stripe' AND order_id = ? AND status = 'created' ORDER BY id DESC").get(orderId));
  if (!pay || pay.status === 'succeeded') return; // จ่ายสำเร็จแล้วไม่ถูกทับด้วย event ล้มเหลว
  touch(pay.id, { status: 'failed', last_error: error, payment_intent: paymentIntent ?? pay.payment_intent });
  // ออเดอร์ยังเป็น pending: ลูกค้ากดชำระใหม่ได้ (จะสร้าง session ใหม่)
}

function confirm(event, { orderId, amount, currency, paymentIntent, sessionId }) {
  const refund = (reason) => paymentIntent && enqueueAutoRefund({ paymentIntent, orderId, reason });
  const order = orderId && db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) {
    adminAlert('PAYMENT_UNKNOWN_ORDER', null, `ได้รับเงินแต่ไม่พบออเดอร์ (event ${event.id}, order_id=${orderId})`);
    refund('unknown_order');
    return;
  }
  let pay = (sessionId && db.prepare("SELECT * FROM payments WHERE provider = 'stripe' AND provider_ref = ?").get(sessionId))
    || (paymentIntent && db.prepare("SELECT * FROM payments WHERE provider = 'stripe' AND payment_intent = ?").get(paymentIntent))
    || db.prepare("SELECT * FROM payments WHERE provider = 'stripe' AND order_id = ? AND status = 'created' ORDER BY id DESC").get(order.id);
  if (!pay) {
    const { lastInsertRowid } = db.prepare("INSERT INTO payments (order_id, provider, provider_ref, payment_intent, amount, currency, status) VALUES (?, 'stripe', ?, ?, ?, ?, 'created')")
      .run(order.id, sessionId, paymentIntent ?? null, amount, String(currency ?? 'thb').toLowerCase());
    pay = db.prepare('SELECT * FROM payments WHERE id = ?').get(lastInsertRowid);
  }
  if (pay.status === 'succeeded' && pay.payment_intent === paymentIntent) return; // event คนละชนิดของการจ่ายเดิม (เช่น session + payment_intent)
  // บันทึกยอด/สกุลเงินที่ Stripe รายงานจริง (ไม่ใช่ค่าที่คาดไว้) เพื่อให้ประวัติการเงินตรงกับความจริง
  touch(pay.id, { payment_intent: paymentIntent ?? pay.payment_intent, raw_event_id: event.id, amount, currency: String(currency ?? 'thb').toLowerCase() });

  // ตรวจยอด/สกุลเงินกับออเดอร์ในฐานข้อมูล ก่อนเปลี่ยนสถานะ
  if (amount !== order.total || String(currency).toLowerCase() !== 'thb') {
    touch(pay.id, { status: 'needs_review', last_error: `ยอด/สกุลเงินไม่ตรง: ได้รับ ${amount} ${currency}, ออเดอร์ ${order.total} thb` });
    adminAlert('AMOUNT_MISMATCH', order.id, `ได้รับ ${amount} ${currency} แต่ออเดอร์ต้องการ ${order.total} thb — คืนเงินอัตโนมัติ`);
    refund('amount_mismatch');
    return;
  }

  if (order.status === 'pending') {
    try {
      transition(order.id, 'paid');
      touch(pay.id, { status: 'succeeded', last_error: null });
    } catch (e) {
      if (e.code !== 'OUT_OF_STOCK') throw e;
      touch(pay.id, { status: 'needs_review', last_error: e.message });
      adminAlert('OUT_OF_STOCK_AFTER_PAYMENT', order.id, `ลูกค้าจ่ายแล้วแต่โค้ดหมด (${e.params?.titles}) — คืนเงินอัตโนมัติ`);
      refund('out_of_stock');
    }
  } else if (order.status === 'paid') {
    // ออเดอร์จ่ายแล้วด้วยการชำระอื่น → รายการนี้คือการจ่ายซ้ำ
    touch(pay.id, { status: 'needs_review', last_error: 'duplicate payment' });
    adminAlert('DUPLICATE_PAYMENT', order.id, `ออเดอร์จ่ายแล้ว แต่มีการชำระซ้ำ (payment_intent ${paymentIntent}) — คืนเงินอัตโนมัติ`);
    refund('duplicate');
  } else {
    // cancelled / refunded → จ่ายหลังออเดอร์หมดอายุหรือถูกยกเลิก: ไม่ให้โค้ด คืนเงิน และบันทึกให้แอดมินดู
    touch(pay.id, { status: 'needs_review', last_error: `ออเดอร์สถานะ ${order.status}` });
    adminAlert('LATE_PAYMENT', order.id, `ได้รับเงินหลังออเดอร์เป็น ${order.status} (${order.cancel_reason ?? '-'}) — คืนเงินอัตโนมัติ`);
    refund('late_payment');
  }
}

function onChargeRefunded(event, charge) {
  const pay = charge.payment_intent && db.prepare("SELECT * FROM payments WHERE provider = 'stripe' AND payment_intent = ?").get(charge.payment_intent);
  if (!pay) return;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(pay.order_id);
  if (pay.status === 'needs_review') { touch(pay.id, { status: 'refunded' }); return; } // คืนอัตโนมัติของรายการที่ไม่ได้ใช้ซื้อ
  if (pay.status !== 'succeeded' || order.status !== 'paid') return; // ผ่านระบบเราไปแล้ว/ไม่เกี่ยวข้อง
  if (charge.amount_refunded < charge.amount) {
    // คืนบางส่วน (เช่น ชดเชยให้ลูกค้า): บันทึกยอดสะสมไว้ที่ payment — ออเดอร์ยัง paid และโค้ดเกมยังใช้ได้
    // (โค้ดดิจิทัลแบ่งคืนครึ่งเดียวไม่ได้ ถ้าต้องการยกเลิกการขายให้คืนส่วนที่เหลือจน Stripe แจ้งว่าคืนครบ ระบบจะเพิกถอนโค้ดเอง)
    if (charge.amount_refunded > pay.amount_refunded) {
      touch(pay.id, { amount_refunded: charge.amount_refunded });
      adminAlert('PARTIAL_REFUND', order.id, `Stripe คืนเงินบางส่วนแล้ว ${formatBaht(charge.amount_refunded)} จาก ${formatBaht(charge.amount)} — ออเดอร์ยังเป็น "ชำระแล้ว" และโค้ดเกมยังใช้ได้`);
    }
    return;
  }
  // คืนเต็มจำนวนจาก Stripe Dashboard
  db.prepare("INSERT OR IGNORE INTO refunds (order_id, amount, reason, source) VALUES (?, ?, 'refunded via Stripe Dashboard', 'stripe_dashboard')").run(order.id, charge.amount_refunded);
  transition(order.id, 'refunded');
  touch(pay.id, { status: 'refunded', amount_refunded: charge.amount_refunded });
}

// ---------- ออเดอร์ถูกยกเลิก/หมดอายุ → expire Checkout Session ฝั่ง Stripe ----------
async function expireSessions(orderId) {
  if (!stripeConfigured()) return;
  const rows = db.prepare("SELECT id, provider_ref FROM payments WHERE order_id = ? AND provider = 'stripe' AND status = 'created' AND provider_ref IS NOT NULL").all(orderId);
  for (const r of rows) {
    try {
      await getStripe().checkout.sessions.expire(r.provider_ref);
    } catch (e) {
      console.warn(`expire session ${r.provider_ref} ไม่สำเร็จ (อาจหมดอายุอยู่แล้ว): ${e.message}`);
    }
    db.prepare("UPDATE payments SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'created'").run(r.id);
  }
}
orderEvents.on('status', (order, to) => { if (to === 'cancelled') expireSessions(order.id).catch(() => {}); });
