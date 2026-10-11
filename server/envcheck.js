// ตรวจค่าตั้งค่าสำหรับ production (ฟังก์ชันล้วน — ใช้ทั้งตอนสตาร์ทเซิร์ฟเวอร์ และ `npm run check:env`)
// errors  = ร้ายแรง: production จะไม่ยอมสตาร์ท
// warnings = เตือน: สตาร์ทได้แต่ควรแก้ก่อนเปิดขายจริง
const PLACEHOLDER = /change-?me|dev-?(local|only)|xxxx|example|your[-_]?secret|simulation|placeholder|default|test-secret/i;

const weakSecret = (v) => !v || v.length < 32 || PLACEHOLDER.test(v);

// URL สาธารณะของร้าน: APP_URL ก่อน แล้วค่อย BASE_URL / RENDER_EXTERNAL_URL (Render ตั้งให้อัตโนมัติ) — ใช้ร่วมกับ config.js ให้ตรวจกับค่าที่ใช้จริง
export const resolveAppUrl = (env = process.env) => (env.APP_URL || env.BASE_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');

export function checkProductionEnv(env = process.env) {
  const errors = [];
  const warnings = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };

  need(!weakSecret(env.JWT_SECRET), 'JWT_SECRET ต้องเป็นค่าสุ่มยาวอย่างน้อย 32 ตัวอักษร และห้ามเป็นค่าตัวอย่าง/ค่าเริ่มต้น (สร้างด้วย: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))")');
  need(!weakSecret(env.KEY_ENCRYPTION_SECRET), 'KEY_ENCRYPTION_SECRET ต้องเป็นค่าสุ่มยาวอย่างน้อย 32 ตัวอักษร และห้ามเป็นค่าตัวอย่าง (ใช้เข้ารหัสโค้ดเกม — เปลี่ยนภายหลังไม่ได้ ต้องสำรองไว้ที่ปลอดภัย)');
  if (env.JWT_SECRET && env.JWT_SECRET === env.KEY_ENCRYPTION_SECRET) errors.push('JWT_SECRET และ KEY_ENCRYPTION_SECRET ต้องเป็นคนละค่ากัน');

  need(/^whsec_[A-Za-z0-9]{16,}$/.test(env.STRIPE_WEBHOOK_SECRET ?? '') && !PLACEHOLDER.test(env.STRIPE_WEBHOOK_SECRET ?? ''),
    'STRIPE_WEBHOOK_SECRET ต้องเป็น Signing secret จริงของ endpoint (ขึ้นต้น whsec_) — ไม่มีค่านี้จะยืนยันการชำระเงินไม่ได้');
  const sk = env.STRIPE_SECRET_KEY ?? '';
  need(/^(sk|rk)_(live|test)_[A-Za-z0-9]{16,}$/.test(sk) && !PLACEHOLDER.test(sk), 'STRIPE_SECRET_KEY ต้องตั้งค่าเป็นคีย์จริง (sk_live_... หรือ sk_test_... สำหรับ staging)');
  if (/^(sk|rk)_test_/.test(sk)) warnings.push('STRIPE_SECRET_KEY เป็นคีย์โหมดทดสอบ (sk_test_) — ลูกค้าจะจ่ายเงินจริงไม่ได้ ใช้ sk_live_ เมื่อเปิดขายจริง');

  const url = resolveAppUrl(env);
  const insecureOk = env.ALLOW_HTTP_APP_URL === '1';
  if (!/^https?:\/\//.test(url)) errors.push('APP_URL ต้องระบุ เช่น https://shop.example.com');
  else if (!insecureOk) {
    need(url.startsWith('https://'), 'APP_URL ต้องเป็น https:// (หรือตั้ง ALLOW_HTTP_APP_URL=1 เฉพาะตอนลอง production บนเครื่องตัวเอง)');
    need(!/\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url), 'APP_URL ห้ามเป็น localhost ใน production');
  }

  if (!env.SMTP_HOST) warnings.push('ยังไม่ได้ตั้ง SMTP_HOST — ลูกค้าจะไม่ได้รับอีเมลยืนยัน/โค้ดเกม/รีเซ็ตรหัสผ่าน');
  if (!env.SHOP_NAME || !env.SHOP_ADDRESS || !env.SHOP_TAX_ID || env.SHOP_TAX_ID === '0000000000000') warnings.push('ข้อมูลร้าน (SHOP_NAME / SHOP_ADDRESS / SHOP_TAX_ID) ยังเป็นค่าตัวอย่าง — จะพิมพ์ลงใบเสร็จ');
  if (!env.TRUST_PROXY) warnings.push('ไม่ได้ตั้ง TRUST_PROXY — ถ้าอยู่หลัง reverse proxy (Caddy/nginx) ให้ตั้ง TRUST_PROXY=1 ไม่งั้น rate limit จะนับ IP ของ proxy แทน IP ลูกค้า');
  if (env.DEV_PAY === '1') errors.push('ห้ามเปิด DEV_PAY ใน production');
  if (env.ALLOW_DEMO_SEED === '1') warnings.push('เปิด ALLOW_DEMO_SEED=1 อยู่ — ฐานข้อมูลว่างจะถูกใส่เกมสมมติ คูปองทดสอบ และโค้ดเกมปลอม (FAKE-...) ที่ลูกค้าซื้อด้วยเงินจริงได้ ใช้กับ staging เท่านั้น');
  if (env.ADMIN_MFA_REQUIRED === '0') warnings.push('ปิด 2FA ของหลังบ้านอยู่ (ADMIN_MFA_REQUIRED=0) — บัญชีที่คืนเงินและดูโค้ดเกมได้ป้องกันด้วยรหัสผ่านอย่างเดียว');
  if (env.RENDER && env.REQUIRE_EXISTING_DB !== '1') warnings.push('ยังไม่ได้ตั้ง REQUIRE_EXISTING_DB=1 — หลัง deploy ครั้งแรกสำเร็จให้ตั้งไว้ ถ้า disk ไม่ถูก mount ระบบจะหยุดแทนที่จะเริ่มด้วยฐานข้อมูลว่าง');
  return { errors, warnings };
}
