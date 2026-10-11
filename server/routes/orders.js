import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { enqueueEmail } from '../services/emailQueue.js';
import { HttpError } from '../services/errors.js';
import { keysForOrder } from '../services/keys.js';
import { createOrder, getOwnOrder, serializeOrder, transition } from '../services/orders.js';
import { createCheckout, devPay } from '../services/payments.js';
import { renderReceipt } from '../services/receipt.js';

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

const idParam = z.coerce.number().int().positive();

// โค้ดเกมแสดงเฉพาะเจ้าของออเดอร์ที่ชำระแล้ว และบันทึก audit log ทุกครั้งที่เปิดดู
function orderWithKeys(req, order) {
  const out = serializeOrder(order);
  if (order.status === 'paid') {
    out.keys = keysForOrder(order.id).map(({ orderItemId, gameId, ...k }) => k);
    audit(req, 'key.view', 'order', order.id, { count: out.keys.length });
  }
  return out;
}

const createLimiter = rateLimit({
  windowMs: 10 * 60_000, limit: config.orderRateLimit, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `user-${req.user.id}`,
  // กดซ้ำด้วย idempotency key เดิม (ได้ออเดอร์เดิมคืน 200) ไม่กินโควตา — ครั้งที่สร้างใหม่หรือล้มเหลวยังนับ (กันการยิงถี่)
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode === 200,
  message: { error: 'สร้างคำสั่งซื้อบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่', code: 'ORDER_RATE_LIMIT' },
});

ordersRouter.post('/', createLimiter, (req, res) => {
  const body = z.object({
    couponCode: z.string().trim().max(40).optional(),
    idempotencyKey: z.string().trim().min(8).max(100),
  }).parse(req.body);
  if (!req.user.email_verified) throw new HttpError(403, 'กรุณายืนยันอีเมลก่อนสั่งซื้อ', 'EMAIL_NOT_VERIFIED');
  const { order, created } = createOrder(req.user, body);
  res.status(created ? 201 : 200).json({ order: serializeOrder(order), created });
});

ordersRouter.get('/:id', (req, res) => {
  res.json({ order: orderWithKeys(req, getOwnOrder(req.user.id, idParam.parse(req.params.id))) });
});

ordersRouter.post('/:id/cancel', (req, res) => {
  const order = getOwnOrder(req.user.id, idParam.parse(req.params.id));
  // ยกเลิกได้เฉพาะ pending (state machine เป็นตัวตัดสินอีกชั้น)
  if (order.status !== 'pending') throw new HttpError(409, 'ยกเลิกได้เฉพาะคำสั่งซื้อที่รอชำระ', 'ORDER_NOT_CANCELLABLE');
  res.json({ order: serializeOrder(transition(order.id, 'cancelled', { reason: 'user' })) });
});

// เริ่มชำระเงินจริง: ยอดมาจากออเดอร์ในฐานข้อมูล body ถูกเมินทั้งหมด — สถานะ paid เกิดจาก webhook เท่านั้น
ordersRouter.post('/:id/pay', async (req, res) => {
  const order = getOwnOrder(req.user.id, idParam.parse(req.params.id));
  res.json(await createCheckout(req.user, order));
});

ordersRouter.get('/:id/receipt.pdf', async (req, res) => {
  const order = getOwnOrder(req.user.id, idParam.parse(req.params.id)); // ของคนอื่น → 404
  if (order.status !== 'paid') throw new HttpError(409, 'ออกใบเสร็จได้เฉพาะคำสั่งซื้อที่ชำระแล้ว', 'RECEIPT_NOT_AVAILABLE');
  const number = serializeOrder(order).invoiceNumber ?? `order-${order.id}`;
  const pdf = await renderReceipt(order.id); // สร้างเสร็จก่อนค่อยส่ง header
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="receipt-${number}.pdf"`,
    'Cache-Control': 'private, no-store',
  }).send(pdf);
});

const resendLimiter = rateLimit({
  windowMs: 10 * 60_000, limit: config.emailResendLimit, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `user-${req.user.id}`,
  message: { error: 'ส่งอีเมลบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่', code: 'EMAIL_RATE_LIMIT' },
});

ordersRouter.post('/:id/resend-email', resendLimiter, (req, res) => {
  const order = getOwnOrder(req.user.id, idParam.parse(req.params.id));
  if (order.status !== 'paid') throw new HttpError(409, 'ส่งอีเมลได้เฉพาะคำสั่งซื้อที่ชำระแล้ว', 'ORDER_NOT_PAID');
  enqueueEmail('order_paid', order.id);
  res.json({ ok: true });
});

// จำลองการชำระเงินสำเร็จ — ไม่ถูก mount เมื่อ NODE_ENV=production
if (config.devPay) {
  ordersRouter.post('/:id/dev-pay', (req, res) => {
    const order = getOwnOrder(req.user.id, idParam.parse(req.params.id));
    res.json({ order: serializeOrder(devPay(order.id)) });
  });
}
