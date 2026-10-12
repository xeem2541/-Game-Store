import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { adminLogin, db, registerAndVerify, sendStripeWebhook, sessionCompleted, setRole } from './helpers.mjs';

// เส้นทางหลักทั้งเส้น: สมัคร → ยืนยันอีเมล → ตะกร้า → คูปอง → checkout → webhook จำลองยืนยันจ่าย → โค้ดในคลัง → ใบเสร็จ PDF → แอดมินคืนเงิน → โค้ดถูกเพิกถอน
test('ลูกค้าซื้อเกมครบวงจร แล้วแอดมินคืนเงิน', async ({ browser }) => {
  const customerCtx = await browser.newContext();
  const page = await customerCtx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // เก็บ JS error และการละเมิด CSP (ไม่นับ "Failed to load resource" ของคำขอที่ตั้งใจให้ผิด เช่น คูปองไม่ถูกต้อง = 422)
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused to|CSP/i.test(m.text())) errors.push(m.text()); });

  // 1) สมัคร + ยืนยันอีเมล
  await registerAndVerify(page);

  // 2) ใส่ตะกร้า
  await page.goto('/game/dragon-realm');
  await expect(page.getByRole('heading', { level: 1, name: 'Dragon Realm' })).toBeVisible(); // ชื่อตามที่ screen reader อ่าน (คำที่แยกไว้ทำแอนิเมชันซ่อนจาก screen reader)
  await page.click('#addBtn');
  await expect(page.locator('#cartCount')).toHaveText('1');

  // 3) หน้าตะกร้า + คูปอง (ผิดก่อน แล้วถูก)
  await page.goto('/cart');
  await expect(page.locator('.lines .line')).toHaveCount(1);
  await page.fill('#couponInput', 'NOPE-CODE');
  await page.click('#couponForm button[type=submit]');
  await expect(page.locator('.coupon .msg')).not.toBeEmpty();
  await page.fill('#couponInput', 'welcome10');
  await page.click('#couponForm button[type=submit]');
  await expect(page.locator('.summary')).toContainText('WELCOME10');

  // 4) checkout → ออเดอร์ pending
  await page.click('a[href="/checkout"]');
  await page.click('#placeBtn');
  await page.waitForURL(/\/order\/\d+$/);
  const orderId = Number(page.url().split('/').pop());
  await expect(page.locator('.status.pending')).toBeVisible();
  const order = await page.evaluate((id) => fetch(`/api/orders/${id}`).then((r) => r.json()), orderId);
  expect(order.order.couponCode).toBe('WELCOME10');
  const afterGame = Math.round(129000 * 0.7); // ราคา 1290 บาท ลด 30%
  expect(order.order.total).toBe(afterGame - Math.floor(afterGame * 0.1)); // แล้วคูปอง 10%

  // 5) กลับจาก "Stripe" (query string ไม่ใช่หลักฐาน) → หน้าต้องรอ webhook; ส่ง webhook ที่เซ็นถูกต้อง → เปลี่ยนเป็น Paid เอง
  await page.goto(`/order/${orderId}?checkout=return`);
  await expect(page.locator('.banner.info')).toBeVisible();
  const bad = await sendStripeWebhook('checkout.session.completed', sessionCompleted(orderId, 100)); // ยอดผิด
  expect(bad.status).toBe(200);
  await expect(page.locator('.status.pending')).toBeVisible(); // ยอดไม่ตรง → ไม่เป็น paid
  const good = await sendStripeWebhook('checkout.session.completed', { ...sessionCompleted(orderId, order.order.total), id: `cs_e2e_ok_${orderId}`, payment_intent: `pi_e2e_ok_${orderId}` });
  expect(good.body.result).toBe('processed');
  await expect(page.locator('.status.paid')).toBeVisible({ timeout: 20_000 });

  // 6) โค้ดเกม (ซ่อนก่อน แล้วกดแสดง) + ใบเสร็จ PDF
  const key = page.locator('#keys .voucher .key').first();
  await expect(key).toHaveText(/^•+/);
  await page.locator('#keys .voucher [data-act=show]').first().click();
  await expect(key).toHaveText(/^FAKE-[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$/);
  const code = (await key.textContent()).trim();
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('a[href$="receipt.pdf"]')]);
  expect(download.suggestedFilename()).toMatch(/^receipt-INV-\d{4}-\d{6}\.pdf$/);
  expect(fs.readFileSync(await download.path()).subarray(0, 5).toString()).toBe('%PDF-');

  // 7) คลังเกมมีโค้ดเดียวกัน
  await page.goto('/profile#library');
  await expect(page.locator('#panel .lib-row')).toHaveCount(1);
  await page.locator('#panel .key-row button').first().click();
  await expect(page.locator('#panel .key')).toHaveText(code);

  // 8) แอดมินคืนเงินผ่านหน้าหลังบ้าน (ยืนยัน 2 ชั้น)
  const adminCtx = await browser.newContext();
  const ap = await adminCtx.newPage();
  const admin = await registerAndVerify(ap, { name: 'แอดมิน e2e' });
  setRole(admin.email, 'admin');
  await adminLogin(ap, admin); // ครั้งแรก: ตั้งค่า 2FA ผ่านหน้าจอ
  await ap.goto(`/admin/#/orders/${orderId}`);
  await expect(ap.locator('h1')).toContainText(`#${orderId}`);
  await expect(ap.locator('body')).not.toContainText(code); // หน้าแอดมินไม่แสดงโค้ดเต็ม
  await ap.click('[data-act=refund]');
  await ap.fill('.modal textarea', 'ลูกค้าขอคืนเงินในการทดสอบ e2e');
  await ap.click('.modal button[type=submit]');
  await ap.fill('.modal input', String(orderId + 1)); // เลขผิด → ต้องไม่ผ่าน
  await ap.click('.modal button[type=submit]');
  await expect(ap.locator('.modal .msg')).not.toBeEmpty();
  await ap.fill('.modal input', String(orderId));
  await ap.click('.modal button[type=submit]');
  await expect(ap.locator('h1 .badge.refunded')).toBeVisible({ timeout: 15_000 });

  // 9) ฝั่งลูกค้า: สถานะคืนเงินแล้ว คลังว่าง โค้ดถูกเพิกถอน คืนสิทธิ์คูปอง
  await page.goto(`/order/${orderId}`);
  await expect(page.locator('.status.refunded')).toBeVisible();
  await page.goto('/profile#library');
  await expect(page.locator('#panel .empty')).toBeVisible();
  const d = db();
  const row = d.prepare('SELECT k.status FROM game_keys k JOIN order_items oi ON oi.id = k.order_item_id WHERE oi.order_id = ?').get(orderId);
  const usage = d.prepare('SELECT COUNT(*) AS n FROM coupon_usages WHERE order_id = ?').get(orderId).n;
  d.close();
  expect(row.status).toBe('revoked');
  expect(usage).toBe(0);

  expect(errors, `console/page errors (รวม CSP): ${errors.join(' | ')}`).toEqual([]);
  await customerCtx.close();
  await adminCtx.close();
});
