// เซิร์ฟเวอร์สำหรับ e2e: ฐานข้อมูลใหม่ทุกครั้ง, อีเมล dev พิมพ์ลงไฟล์ log (ให้เทสอ่านลิงก์ยืนยัน), ใช้ไฟล์ที่ build แล้ว (USE_DIST)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'e2e', '.tmp');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
export const LOG = path.join(tmp, 'server.log');

Object.assign(process.env, {
  NODE_ENV: 'development', PORT: '3199', APP_URL: 'http://localhost:3199', USE_DIST: '1',
  DATABASE_PATH: path.join(tmp, 'e2e.db'), JWT_SECRET: 'e2e-jwt-secret-0123456789abcdef0123456789', KEY_ENCRYPTION_SECRET: 'e2e-key-secret-0123456789abcdef0123456789',
  STRIPE_WEBHOOK_SECRET: 'whsec_e2e_local_only_secret_value', STRIPE_SECRET_KEY: '', SMTP_HOST: '', API_RATE_LIMIT: '100000', AUTH_RATE_LIMIT: '1000', LOG_REQUESTS: '0', DEV_PAY: '1',
});
const tee = (fn) => (...a) => { fs.appendFileSync(LOG, a.map(String).join(' ') + '\n'); fn(...a); };
console.log = tee(console.log.bind(console));
console.warn = tee(console.warn.bind(console));

// Stripe ปลอมสำหรับ e2e (ไม่เรียก API จริง): ให้ปุ่มคืนเงินของแอดมินทำงานได้โดยไม่ต้องมีคีย์
const { setStripeClient } = await import('../server/services/stripe.js');
let n = 0;
setStripeClient({
  checkout: { sessions: { create: async () => ({ id: `cs_e2e_fake_${++n}`, url: 'https://checkout.stripe.test/pay', payment_intent: null }), expire: async () => ({}) } },
  refunds: { create: async () => ({ id: `re_e2e_${++n}`, status: 'succeeded' }) },
});

const { start } = await import('../server/index.js');
const app = start();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => app.stop().then(() => process.exit(0)));
