import { db } from '../db/index.js';
import { couponDiscountFor } from './pricing.js';

const fail = (code, message, params) => ({ ok: false, code, message, params });

// ตรวจเงื่อนไขคูปอง: มีอยู่/เปิดใช้, ไม่หมดอายุ, ยอดขั้นต่ำ, จำกัดครั้งรวม, จำกัดต่อผู้ใช้
// amount = ยอดหลังหักส่วนลดเกม (สตางค์)
export function evaluateCoupon(code, userId, amount) {
  const coupon = db.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').get(String(code).trim());
  if (!coupon) return fail('COUPON_INVALID', 'โค้ดส่วนลดไม่ถูกต้อง');
  if (coupon.expires_at !== null && coupon.expires_at < Date.now()) return fail('COUPON_EXPIRED', 'โค้ดส่วนลดหมดอายุแล้ว');
  if (amount < coupon.min_subtotal) {
    return fail('COUPON_MIN', `ยอดสั่งซื้อไม่ถึงขั้นต่ำของโค้ดนี้ (ขั้นต่ำ ฿${(coupon.min_subtotal / 100).toLocaleString('th-TH')})`, { min: (coupon.min_subtotal / 100).toLocaleString('en-US') });
  }
  if (coupon.max_uses !== null) {
    const used = db.prepare('SELECT COUNT(*) AS n FROM coupon_usages WHERE coupon_id = ?').get(coupon.id).n;
    if (used >= coupon.max_uses) return fail('COUPON_EXHAUSTED', 'โค้ดส่วนลดถูกใช้ครบจำนวนแล้ว');
  }
  if (coupon.max_per_user !== null) {
    const used = db.prepare('SELECT COUNT(*) AS n FROM coupon_usages WHERE coupon_id = ? AND user_id = ?').get(coupon.id, userId).n;
    if (used >= coupon.max_per_user) return fail('COUPON_USER_LIMIT', 'คุณใช้โค้ดนี้ครบจำนวนครั้งที่กำหนดแล้ว');
  }
  return { ok: true, coupon, discount: couponDiscountFor(coupon, amount) };
}
