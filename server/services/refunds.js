import { db } from '../db/index.js';
import { adminAlert } from './audit.js';
import { HttpError } from './errors.js';
import { transition } from './orders.js';
import { getStripe } from './stripe.js';

// คืนเงินเต็มจำนวน (เรียกจากแอดมินเท่านั้น): Stripe Refund → ออเดอร์ refunded → โค้ดถูกเพิกถอน → คืนสิทธิ์คูปอง
export async function refundOrder(orderId, admin, reason) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new HttpError(404, 'ไม่พบคำสั่งซื้อ', 'ORDER_NOT_FOUND');
  if (order.status !== 'paid') throw new HttpError(409, 'คืนเงินได้เฉพาะคำสั่งซื้อที่ชำระแล้ว', 'ORDER_NOT_REFUNDABLE');

  const pay = db.prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'succeeded' ORDER BY id DESC").get(orderId);
  let providerRefundId = null;
  if (pay?.provider === 'stripe') {
    try {
      const refund = await getStripe().refunds.create(
        { payment_intent: pay.payment_intent, metadata: { order_id: String(orderId), admin_id: String(admin.id) } },
        { idempotencyKey: `refund-order-${orderId}` }, // กดซ้ำ/เรียกซ้ำไม่คืนเงินสองรอบ
      );
      providerRefundId = refund.id;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      // Stripe ปฏิเสธ/ล่ม: ยังไม่แตะสถานะออเดอร์ ให้แอดมินลองใหม่ได้
      throw new HttpError(502, `คืนเงินผ่าน Stripe ไม่สำเร็จ: ${e.message}`, 'REFUND_PROVIDER_ERROR');
    }
  } // dev / free: ไม่มีเงินจริงให้คืน

  db.transaction(() => {
    const fresh = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
    // webhook charge.refunded อาจมาก่อนแล้ว (ออเดอร์เป็น refunded ไปแล้ว) → ไม่ต้องเปลี่ยนสถานะซ้ำ แค่บันทึกว่าใครเป็นคนทำ
    if (fresh.status === 'paid') transition(orderId, 'refunded', { reason, actorId: admin.id });
    db.prepare(`INSERT INTO refunds (order_id, amount, provider_refund_id, reason, admin_id, source) VALUES (?, ?, ?, ?, ?, 'admin')
      ON CONFLICT(order_id) DO UPDATE SET provider_refund_id = COALESCE(excluded.provider_refund_id, provider_refund_id),
        reason = excluded.reason, admin_id = excluded.admin_id, source = 'admin'`)
      .run(orderId, order.total, providerRefundId, reason, admin.id);
    if (pay) db.prepare("UPDATE payments SET status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(pay.id);
  })();
  if (!providerRefundId && pay?.provider === 'stripe') adminAlert('REFUND_NO_ID', orderId, 'คืนเงินสำเร็จแต่ไม่มี refund id');
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}
