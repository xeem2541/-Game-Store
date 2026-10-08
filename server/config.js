import 'dotenv/config';
import { checkProductionEnv } from './envcheck.js';

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
const stripeSecret = process.env.STRIPE_SECRET_KEY || '';

// production: ค่าความลับสำคัญเป็นค่าเริ่มต้น/ว่าง/อ่อนเกินไป → ไม่ยอมสตาร์ท (แสดงปัญหาทั้งหมดในครั้งเดียว)
if (isProd) {
  const { errors, warnings } = checkProductionEnv(process.env);
  for (const w of warnings) console.warn(`⚠️  ${w}`);
  if (errors.length) {
    throw new Error(`ตั้งค่า production ไม่ปลอดภัย/ไม่ครบ — เซิร์ฟเวอร์จึงไม่สตาร์ท:\n${errors.map((e) => `  ✖ ${e}`).join('\n')}\n(ตรวจล่วงหน้าได้ด้วย: npm run check:env)`);
  }
}
// กันพลาดเอาคีย์จริงมาใช้ตอนพัฒนา: นอก production ยอมรับเฉพาะ sk_test_ / rk_test_
if (!isProd && stripeSecret && !/^(sk|rk)_test_/.test(stripeSecret)) {
  throw new Error('STRIPE_SECRET_KEY ที่ไม่ใช่โหมดทดสอบ (sk_test_...) ใช้ได้เฉพาะเมื่อ NODE_ENV=production');
}

const appUrl = (process.env.APP_URL || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

// TRUST_PROXY: เว้นว่าง/false = ไม่เชื่อ header จาก proxy | true | จำนวน hop (เช่น 1) | 'loopback' ฯลฯ (รูปแบบเดียวกับ express "trust proxy")
function parseTrustProxy(v) {
  if (v === undefined || v === '' || v === 'false' || v === '0') return false;
  if (v === 'true') return true;
  return /^\d+$/.test(v) ? Number(v) : v;
}

// สิทธิ์เสริมของ staff (ค่าเริ่มต้น = อ่านอย่างเดียว) — อ่านจาก env ทุกครั้งที่ใช้ เพื่อให้เทสสลับค่าได้
export const STAFF_PERMISSION_NAMES = ['games.write', 'stock.write', 'coupons.manage', 'reports.users'];
const staffPermissions = () => (process.env.STAFF_PERMISSIONS ?? '').split(',').map((s) => s.trim()).filter((s) => STAFF_PERMISSION_NAMES.includes(s));

export const config = {
  port: Number(process.env.PORT) || 3000,
  env,
  isProd,
  dbPath: process.env.DATABASE_PATH || './data/store.db',
  appUrl,
  corsOrigins: (process.env.CORS_ORIGINS || appUrl).split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret',
  keySecret: process.env.KEY_ENCRYPTION_SECRET || 'dev-only-key-encryption-secret',
  orderExpiryMinutes: Number(process.env.ORDER_EXPIRY_MINUTES) || 30,
  devPay: !isProd, // ปุ่ม/endpoint จำลองการชำระเงิน เปิดเฉพาะนอก production
  logRequests: env !== 'test' && process.env.LOG_REQUESTS !== '0',
  apiRateLimit: Number(process.env.API_RATE_LIMIT) || 300, // คำขอ /api ต่อนาทีต่อ IP
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT) || 20, // ต่อ 15 นาที ต่อ IP
  emailResendLimit: Number(process.env.EMAIL_RESEND_LIMIT) || 5, // ต่อ 10 นาทีต่อผู้ใช้
  get staffPermissions() { return staffPermissions(); },
  stripe: {
    secretKey: stripeSecret,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  shop: {
    name: process.env.SHOP_NAME || 'Game Store (ตัวอย่าง)',
    address: process.env.SHOP_ADDRESS || '123 ถนนตัวอย่าง แขวงตัวอย่าง เขตตัวอย่าง กรุงเทพมหานคร 10000',
    taxId: process.env.SHOP_TAX_ID || '0000000000000',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Game Store <no-reply@localhost>',
  },
};
