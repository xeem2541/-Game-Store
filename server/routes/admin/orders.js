import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { adminOnly } from '../../middleware/adminAuth.js';
import { audit } from '../../services/audit.js';
import { decrypt, maskKey } from '../../services/crypto.js';
import { enqueueEmail } from '../../services/emailQueue.js';
import { HttpError } from '../../services/errors.js';
import { serializeOrder, transition } from '../../services/orders.js';
import { refundOrder } from '../../services/refunds.js';
import { BKK_DATE, dateStr, idParam, likeArg, pageInfo, paging } from './util.js';

export const ordersAdminRouter = Router();

const STATUSES = ['pending', 'paid', 'cancelled', 'refunded'];
const SORTS = { newest: 'o.id DESC', oldest: 'o.id ASC', totalDesc: 'o.total DESC', totalAsc: 'o.total ASC' };

// เงื่อนไขกรองออเดอร์ (ใช้ร่วมกับการส่งออก CSV)
export function orderFilter(query) {
  const q = z.object({
    q: z.string().trim().max(100).optional(), status: z.enum(STATUSES).optional(), provider: z.enum(['stripe', 'dev', 'free']).optional(),
    from: dateStr.optional(), to: dateStr.optional(),
  }).parse(query);
  const where = ['1 = 1'];
  const args = [];
  if (q.q) {
    const asId = /^#?\d+$/.test(q.q) ? Number(q.q.replace('#', '')) : null;
    where.push(asId !== null ? '(o.id = ? OR u.email LIKE ? ESCAPE \'\\\')' : 'u.email LIKE ? ESCAPE \'\\\'');
    if (asId !== null) args.push(asId);
    args.push(likeArg(q.q));
  }
  if (q.status) { where.push('o.status = ?'); args.push(q.status); }
  if (q.provider) { where.push('EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.provider = ?)'); args.push(q.provider); }
  if (q.from) { where.push(`${BKK_DATE('o.created_at')} >= ?`); args.push(q.from); }
  if (q.to) { where.push(`${BKK_DATE('o.created_at')} <= ?`); args.push(q.to); }
  return { where: where.join(' AND '), args };
}

ordersAdminRouter.get('/', (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const { where, args } = orderFilter(req.query);
  const sort = SORTS[req.query.sort] ?? SORTS.newest;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders o JOIN users u ON u.id = o.user_id WHERE ${where}`).get(...args).n;
  const items = db.prepare(`SELECT o.id, o.status, o.total, o.coupon_code AS couponCode, o.created_at AS createdAt, o.paid_at AS paidAt,
      u.id AS userId, u.email, u.name,
      (SELECT p.provider FROM payments p WHERE p.order_id = o.id ORDER BY p.id DESC LIMIT 1) AS provider,
      (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS itemCount
    FROM orders o JOIN users u ON u.id = o.user_id WHERE ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json({ items, ...pageInfo(total, page, limit) });
});

ordersAdminRouter.get('/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(idParam.parse(req.params.id));
  if (!o) throw new HttpError(404, 'ไม่พบคำสั่งซื้อ', 'ORDER_NOT_FOUND');
  const user = db.prepare('SELECT id, email, name, status FROM users WHERE id = ?').get(o.user_id); // ไม่ส่ง hash รหัสผ่านเด็ดขาด
  const keys = db.prepare(`SELECT k.id, oi.title, k.key_enc, k.status FROM game_keys k JOIN order_items oi ON oi.id = k.order_item_id
    WHERE oi.order_id = ? ORDER BY k.id`).all(o.id).map(({ key_enc: enc, ...k }) => ({ ...k, masked: maskKey(decrypt(enc)) }));
  audit(req, 'order.view', 'order', o.id); // ดูออเดอร์ = เข้าถึงข้อมูลลูกค้า
  res.json({
    order: serializeOrder(o),
    user,
    payments: db.prepare(`SELECT id, provider, provider_ref AS providerRef, payment_intent AS paymentIntent, amount, amount_refunded AS amountRefunded, currency, status, last_error AS lastError,
      created_at AS createdAt, updated_at AS updatedAt FROM payments WHERE order_id = ? ORDER BY id`).all(o.id),
    events: db.prepare(`SELECT e.from_status AS fromStatus, e.to_status AS toStatus, e.reason, e.created_at AS createdAt, u.name AS actor
      FROM order_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.order_id = ? ORDER BY e.id`).all(o.id),
    refund: db.prepare('SELECT r.amount, r.reason, r.source, r.created_at AS createdAt, u.name AS admin FROM refunds r LEFT JOIN users u ON u.id = r.admin_id WHERE r.order_id = ?').get(o.id) ?? null,
    keys, // ปิดบังบางส่วน — ดูเต็มที่ "สต็อกโค้ด" (admin) พร้อม audit log
    emails: db.prepare('SELECT kind, status, attempts, last_error AS lastError, created_at AS createdAt, sent_at AS sentAt FROM email_queue WHERE order_id = ? ORDER BY id DESC LIMIT 10').all(o.id),
  });
});

// staff และ admin ยกเลิกออเดอร์ที่ยังรอชำระได้
ordersAdminRouter.post('/:id/cancel', (req, res) => {
  const id = idParam.parse(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().max(300).optional() }).parse(req.body ?? {});
  const o = db.prepare('SELECT status FROM orders WHERE id = ?').get(id);
  if (!o) throw new HttpError(404, 'ไม่พบคำสั่งซื้อ', 'ORDER_NOT_FOUND');
  if (o.status !== 'pending') throw new HttpError(409, 'ยกเลิกได้เฉพาะคำสั่งซื้อที่รอชำระ', 'ORDER_NOT_CANCELLABLE');
  const updated = transition(id, 'cancelled', { reason: 'admin', actorId: req.user.id });
  audit(req, 'order.cancel', 'order', id, { before: { status: 'pending' }, after: { status: 'cancelled' }, note: reason ?? null });
  res.json({ order: serializeOrder(updated) });
});

ordersAdminRouter.post('/:id/resend-email', (req, res) => {
  const id = idParam.parse(req.params.id);
  const o = db.prepare('SELECT status FROM orders WHERE id = ?').get(id);
  if (!o) throw new HttpError(404, 'ไม่พบคำสั่งซื้อ', 'ORDER_NOT_FOUND');
  if (o.status !== 'paid') throw new HttpError(409, 'ส่งอีเมลได้เฉพาะคำสั่งซื้อที่ชำระแล้ว', 'ORDER_NOT_PAID');
  enqueueEmail('order_paid', id);
  audit(req, 'order.resend_email', 'order', id);
  res.json({ ok: true });
});

// คืนเงินเต็มจำนวน (admin เท่านั้น) — ต้องส่ง confirmOrderId = เลขออเดอร์ซ้ำอีกครั้ง (ยืนยันชั้นที่สอง ตรวจที่เซิร์ฟเวอร์ด้วย)
ordersAdminRouter.post('/:id/refund', adminOnly, async (req, res) => {
  const id = idParam.parse(req.params.id);
  const body = z.object({
    reason: z.string().trim().min(3, 'กรุณาระบุเหตุผลการคืนเงิน').max(500),
    confirmOrderId: z.number().int(),
  }).parse(req.body);
  if (body.confirmOrderId !== id) throw new HttpError(400, 'เลขออเดอร์ที่ยืนยันไม่ตรงกัน', 'REFUND_CONFIRM_MISMATCH');
  const order = await refundOrder(id, req.user, body.reason);
  audit(req, 'order.refund', 'order', id, { before: { status: 'paid' }, after: { status: 'refunded' }, reason: body.reason });
  res.json({ order: serializeOrder(order) });
});
