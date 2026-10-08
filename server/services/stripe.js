import Stripe from 'stripe';
import { config } from '../config.js';
import { HttpError } from './errors.js';

let client = null;
let override = null; // ใช้ในเทส: ฉีด Stripe ปลอมเพื่อไม่ต้องเรียก API จริง

export const setStripeClient = (c) => { override = c; };
export const stripeConfigured = () => Boolean(override || config.stripe.secretKey);
export const webhookConfigured = () => Boolean(config.stripe.webhookSecret);

export function getStripe() {
  if (override) return override;
  if (!config.stripe.secretKey) {
    throw new HttpError(503, 'ยังไม่ได้ตั้งค่าการชำระเงิน: ขาด STRIPE_SECRET_KEY ใน .env (ดู README)', 'PAYMENTS_NOT_CONFIGURED', { missing: 'STRIPE_SECRET_KEY' });
  }
  client ??= new Stripe(config.stripe.secretKey);
  return client;
}

// ตรวจลายเซ็น webhook ด้วย raw body — ไม่ต้องใช้เครือข่าย
export function verifyWebhook(rawBody, signature) {
  const s = new Stripe(config.stripe.secretKey || 'sk_test_unused');
  return s.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
}
