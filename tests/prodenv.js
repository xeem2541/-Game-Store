import crypto from 'node:crypto';

const rand = (n = 24) => crypto.randomBytes(n).toString('hex');

// ค่าตั้งค่า production ที่ "ผ่านการตรวจ" สำหรับรันเซิร์ฟเวอร์ลูก (child process) ในเทส — ทุกความลับสุ่มใหม่ ไม่ใช่คีย์จริง
export function validProdEnv(extra = {}) {
  return {
    ...process.env,
    NODE_ENV: 'production', DATABASE_PATH: ':memory:', APP_URL: 'https://shop.example.org',
    JWT_SECRET: rand(), KEY_ENCRYPTION_SECRET: rand(),
    STRIPE_SECRET_KEY: `sk_test_${rand(16)}`, STRIPE_WEBHOOK_SECRET: `whsec_${rand(16)}`,
    SMTP_HOST: 'smtp.mail.invalid', SHOP_NAME: 'Test Shop Co', SHOP_ADDRESS: '1 Test Rd', SHOP_TAX_ID: '1234567890123', TRUST_PROXY: '1',
    LOG_REQUESTS: '0', ...extra,
  };
}
