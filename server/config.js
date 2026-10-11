import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { checkProductionEnv, resolveAppUrl } from './envcheck.js';

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
const stripeSecret = process.env.STRIPE_SECRET_KEY || '';
// DEMO_MODE=1: เว็บตัวอย่างสำหรับโชว์ (เช่น Render plan ฟรี) — ยังเป็น production เต็มรูปแบบ (คุกกี้ secure, HSTS, CSP)
// ต่างแค่: ชำระเงินแบบจำลอง (ไม่ต่อ Stripe), ใส่เกมตัวอย่างเอง, ยืนยันอีเมลอัตโนมัติเมื่อไม่มี SMTP, แสดงป้าย DEMO และไม่ให้ search engine เก็บ
const demoMode = process.env.DEMO_MODE === '1';

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

// ความลับต้องตั้งเองเสมอ (ยกเว้นตอนรันเทส) — ไม่มีค่าเริ่มต้นที่ใครก็รู้ ลืมตั้ง NODE_ENV=production บนเซิร์ฟเวอร์จริงก็ปลอม token ไม่ได้
const isTest = env === 'test';
// โหมดตัวอย่างที่ไม่ได้ตั้งความลับ: สุ่มครั้งแรกแล้วเก็บไว้ข้างฐานข้อมูล (สิทธิ์ 600) — อยู่และหายไปพร้อมข้อมูล
// (ฐานข้อมูลยังอยู่แต่ KEY_ENCRYPTION_SECRET เปลี่ยน = ถอดรหัสโค้ดเกมเดิมไม่ได้; plan ฟรีล้างทั้งคู่พร้อมกันทุก restart)
function demoSecret(name) {
  const file = path.join(path.dirname(path.resolve(process.env.DATABASE_PATH || './data/store.db')), '.demo-secrets.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* ยังไม่มีไฟล์ */ }
  if (!saved[name]) {
    saved[name] = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
  }
  return saved[name];
}
function requiredSecret(name, testFallback) {
  const v = process.env[name];
  if (v) return v;
  if (isTest) return testFallback;
  if (demoMode) return demoSecret(name);
  throw new Error(`ยังไม่ได้ตั้ง ${name} ใน .env (คัดลอกจาก .env.example แล้วใส่ค่าสุ่ม: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")`);
}

const appUrl = resolveAppUrl(process.env) || 'http://localhost:3000';

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
  // Render อยู่หลัง proxy เสมอ (ตั้งตัวแปร RENDER ให้เอง) → ไม่ได้ตั้งก็เชื่อ 1 hop ไม่งั้นทุกคนจะถูกนับเป็น IP ของ proxy เดียวกัน
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY ?? (process.env.RENDER ? '1' : undefined)),
  jwtSecret: requiredSecret('JWT_SECRET', 'test-only-jwt-secret'),
  keySecret: requiredSecret('KEY_ENCRYPTION_SECRET', 'test-only-key-encryption-secret'),
  // 1 = ไม่ยอมเริ่มถ้าไม่พบไฟล์ฐานข้อมูล (กัน disk ไม่ถูก mount แล้วได้ฐานข้อมูลว่างใหม่) — ตั้งหลังติดตั้งครั้งแรก
  requireExistingDb: process.env.REQUIRE_EXISTING_DB === '1',
  orderExpiryMinutes: Number(process.env.ORDER_EXPIRY_MINUTES) || 30,
  demoMode,
  // ปุ่ม/endpoint จำลองการชำระเงิน: ต้องเปิดเองด้วย DEV_PAY=1 และไม่มีวันเปิดใน production (ลืมตั้งค่า = ปิด) — ยกเว้นโหมดตัวอย่าง
  devPay: (!isProd && process.env.DEV_PAY === '1') || demoMode,
  logRequests: env !== 'test' && process.env.LOG_REQUESTS !== '0',
  apiRateLimit: Number(process.env.API_RATE_LIMIT) || 300, // คำขอ /api ต่อนาทีต่อ IP
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT) || 20, // ต่อ 15 นาที ต่อ IP
  emailResendLimit: Number(process.env.EMAIL_RESEND_LIMIT) || 5, // ต่อ 10 นาทีต่อผู้ใช้
  // กันกักสต็อก: ออเดอร์ pending จองโค้ดไว้ → จำกัดจำนวนที่ค้างได้พร้อมกัน และความถี่การสร้างออเดอร์ต่อผู้ใช้
  // 2FA (TOTP) สำหรับบัญชีหลังบ้าน (staff/admin): ค่าเริ่มต้น = บังคับ ตั้ง 0 เพื่อปิด (production จะเตือน)
  adminMfaRequired: process.env.ADMIN_MFA_REQUIRED !== '0',
  maxPendingOrders: Number(process.env.MAX_PENDING_ORDERS) || 3,
  orderRateLimit: Number(process.env.ORDER_RATE_LIMIT) || 10, // ต่อ 10 นาทีต่อผู้ใช้
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
