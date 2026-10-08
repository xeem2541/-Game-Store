import { processStripeEvent } from '../services/payments.js';
import { verifyWebhook, webhookConfigured } from '../services/stripe.js';

// ต้อง mount ด้วย express.raw() ก่อน express.json() เพราะการตรวจลายเซ็นใช้ raw body
// และไม่ผ่าน CSRF/คุกกี้ — ความน่าเชื่อถือมาจากลายเซ็น Stripe เท่านั้น
export async function stripeWebhook(req, res) {
  if (!webhookConfigured()) {
    return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า STRIPE_WEBHOOK_SECRET ใน .env', code: 'WEBHOOK_NOT_CONFIGURED' });
  }
  let event;
  try {
    event = verifyWebhook(req.body, req.get('stripe-signature') ?? '');
  } catch {
    return res.status(400).json({ error: 'ลายเซ็น webhook ไม่ถูกต้อง', code: 'BAD_SIGNATURE' });
  }
  const result = await processStripeEvent(event); // error ที่ไม่คาดคิด → 500 ให้ Stripe ส่งซ้ำ
  res.json({ received: true, result });
}
