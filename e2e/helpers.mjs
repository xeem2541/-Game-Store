import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentStep, totpCode } from '../server/services/totp.js';

const require = createRequire(import.meta.url);
const Stripe = require('stripe');
const Database = require('better-sqlite3');
const tmp = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
export const WEBHOOK_SECRET = 'whsec_e2e_local_only_secret_value';

export const uniqueEmail = (p = 'e2e') => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
export const password = () => `Pw-${Math.random().toString(36).slice(2)}-Aa1!`;

// อ่านลิงก์ (verify / reset) จากอีเมลที่เซิร์ฟเวอร์ dev พิมพ์ลง log ล่าสุดของผู้รับคนนั้น
export async function mailLink(email, kind = 'verify') {
  const log = path.join(tmp, 'server.log');
  for (let i = 0; i < 40; i += 1) {
    const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    const blocks = text.split('[DEV MAIL]').filter((b) => b.includes(`to=${email}`));
    const m = blocks.reverse().map((b) => b.match(new RegExp(`http://localhost:3199/${kind}\\?token=[a-f0-9]+`))).find(Boolean);
    if (m) return m[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`ไม่พบอีเมล ${kind} ของ ${email} ใน log`);
}

// ส่ง webhook ที่เซ็นลายเซ็นด้วย secret ของเซิร์ฟเวอร์ทดสอบ (เลียนแบบ Stripe)
export async function sendStripeWebhook(type, object) {
  const stripe = new Stripe('sk_test_unused');
  const payload = JSON.stringify({ id: `evt_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, object: 'event', type, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch('http://localhost:3199/api/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
  return { status: r.status, body: await r.json() };
}
export const sessionCompleted = (orderId, amount) => ({
  id: `cs_e2e_${orderId}`, object: 'checkout.session', payment_status: 'paid', amount_total: amount, currency: 'thb',
  payment_intent: `pi_e2e_${orderId}`, metadata: { order_id: String(orderId) }, client_reference_id: String(orderId),
});

export function db() { return new Database(path.join(tmp, 'e2e.db')); }
export function setRole(email, role) { const d = db(); d.prepare('UPDATE users SET role = ? WHERE email = ?').run(role, email); d.close(); }

// สมัครสมาชิก + ยืนยันอีเมลผ่าน UI แล้วคืนข้อมูลบัญชี
export async function registerAndVerify(page, { name = 'ผู้ทดสอบ e2e' } = {}) {
  const email = uniqueEmail();
  const pw = password();
  await page.goto('/register');
  await page.fill('input[name=name]', name);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', pw);
  await page.click('button[type=submit]');
  await page.waitForURL('**/profile**');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);
  await page.goto(await mailLink(email, 'verify'));
  await page.waitForSelector('#msg.ok');
  return { email, password: pw, name };
}

// ล็อกอินหลังบ้านผ่าน UI รวม 2FA: ครั้งแรกตั้งค่าผ่านหน้าจอจริง (อ่านรหัสลับ → คำนวณรหัส 6 หลัก → เก็บรหัสกู้คืน)
// ครั้งถัดไปใช้รหัสกู้คืนที่เก็บไว้ (รหัสจากแอปใช้ซ้ำในช่วง 30 วินาทีเดียวกันไม่ได้)
const recoveryCodes = new Map();
export async function adminLogin(page, { email, password: pw }) {
  await page.goto('/admin/login');
  await page.fill('#form input[name=email]', email);
  await page.fill('#form input[name=password]', pw);
  await page.click('#form button[type=submit]');
  const step = await Promise.race([
    page.waitForSelector('#mfaForm:not([hidden])').then(() => 'verify'),
    page.waitForURL('**/admin/').then(() => 'app'),
    // ล็อกอินไม่ผ่าน (ข้อความผิดพลาดขึ้น) → ล้มทันทีพร้อมข้อความ แทนที่จะรอจนหมดเวลา
    page.waitForSelector('#msg:not(:empty)').then(async () => { throw new Error(`ล็อกอินหลังบ้านไม่ผ่าน: ${await page.textContent('#msg')}`); }),
  ]);
  if (step === 'verify') {
    const codes = recoveryCodes.get(email);
    if (!codes?.length) throw new Error(`ไม่มีรหัสกู้คืนของ ${email}`);
    await page.fill('#mfaForm input[name=code]', codes.shift());
    await page.click('#mfaForm button[type=submit]');
    await page.waitForURL('**/admin/');
  }
  // บัญชีที่ยังไม่ตั้ง 2FA → หน้าแอดมินแสดงหน้าตั้งค่าแทนเมนู
  const setup = await Promise.race([
    page.waitForSelector('#mfaStart').then(() => true),
    page.waitForSelector('#nav a', { state: 'attached' }).then(() => false), // จอเล็กเมนูซ่อนใน drawer (visibility: hidden) จนกว่าจะกดเปิด
  ]);
  if (setup) {
    await page.click('#mfaStart');
    const secret = (await page.textContent('#mfaSecret')).replace(/\s/g, '');
    await page.fill('#mfaEnable input[name=code]', totpCode(secret, currentStep()));
    await page.click('#mfaEnable button[type=submit]');
    await page.waitForSelector('#recoveryCodes');
    recoveryCodes.set(email, (await page.locator('#recoveryCodes code').allTextContents()).map((c) => c.trim()));
    await page.check('#savedCodes');
    await page.click('#mfaDone');
    await page.waitForSelector('#nav a', { state: 'attached' });
  }
}
