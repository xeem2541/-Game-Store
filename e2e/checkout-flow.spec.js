import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { registerAndVerify } from './helpers.mjs';

// เส้นทางซื้อ (UI เฟส 16): แถบขั้นตอน, การ์ดในตะกร้า (ลบ/ปัดลบ), คูปองตอบสนองทันที, แถบยอดรวมติดล่างจอบนมือถือ,
// หน้าคำสั่งซื้อหลังจ่าย = คูปองโค้ดเกม + พลุฉลอง + ปุ่มคัดลอก/เปิดในร้านของแพลตฟอร์ม
const SLUGS = ['dragon-realm', 'zombie-outbreak', 'cozy-farm-life'];

async function fillCart(page, slugs = SLUGS) {
  await page.evaluate(async (s) => {
    const csrf = (await fetch('/api/health')).headers.get('x-csrf-token');
    const r = await fetch('/api/cart', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ slugs: s }) });
    if (!r.ok) throw new Error('PUT /api/cart ' + r.status);
  }, slugs);
}
const openCart = async (page) => {
  await page.goto('/cart');
  await page.waitForSelector('body.ready', { state: 'attached' });
};
const serious = async (page) => {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
};
const current = (page) => page.locator('.steps li[aria-current="step"]').getAttribute('data-step');

test('ตะกร้า: แถบขั้นตอน, ลบเกมแล้วยอดลด + โฟกัสไปรายการถัดไป, คูปองผิด/ถูก/นำออก และ axe ผ่าน', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await registerAndVerify(page);
  await fillCart(page);
  await openCart(page);
  expect(await current(page)).toBe('1');
  await expect(page.locator('.lines .line')).toHaveCount(3);
  await expect(page.locator('.lines-head')).toContainText('3');
  await expect(page.locator('.sum-bar')).toBeHidden(); // แถบล่างจอมีเฉพาะมือถือ

  const total = async () => page.locator('.summary .grand strong').textContent();
  const before = await total();
  await page.locator(`#view [data-rm="${SLUGS[0]}"]`).click();
  await expect(page.locator('.lines .line')).toHaveCount(2);
  await expect.poll(total).not.toBe(before);
  await expect(page.locator(`#view [data-rm="${SLUGS[1]}"]`)).toBeFocused();
  await expect(page.locator('#toast')).toContainText('Dragon Realm');

  // คูปอง: ปุ่มกดไม่ได้จนกว่าจะพิมพ์, ตัวพิมพ์ใหญ่อัตโนมัติ, โค้ดผิด = aria-invalid + ข้อความ
  const apply = page.locator('#couponForm button[type=submit]');
  await expect(apply).toBeDisabled();
  await page.locator('#couponInput').pressSequentially('nope-code');
  await expect(page.locator('#couponInput')).toHaveValue('NOPE-CODE');
  await apply.click();
  await expect(page.locator('#couponInput')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#couponMsg')).not.toBeEmpty();
  await expect(page.locator('#couponInput')).toBeFocused();
  await page.locator('#couponInput').fill('welcome10');
  await apply.click();
  await expect(page.locator('.coupon-tag .coupon-code')).toHaveText('WELCOME10');
  await expect(page.locator('.coupon-save')).toHaveText(/^−฿/);
  await expect(page.locator('.savings')).toBeVisible();
  expect(await serious(page)).toEqual([]);

  await page.locator('#couponRemove').click();
  await expect(page.locator('#couponInput')).toBeFocused();
  await expect(page.locator('.summary')).not.toContainText('WELCOME10');
});

test('มือถือ: ปัดการ์ดไปทางซ้ายเพื่อลบ (ปัดสั้น = เด้งกลับ), แถบยอดรวมติดล่างจอและซ่อนเมื่อถึงกล่องสรุป', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await registerAndVerify(page);
  await fillCart(page);
  await openCart(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bar = page.locator('.sum-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('฿');

  // จำลองนิ้วปัด (PointerEvent ชนิด touch) — สั้นกว่า 40% → เด้งกลับ, ยาวกว่า → ลบ
  const swipe = (slug, distance) => page.evaluate(([s, d]) => {
    const line = document.querySelector(`.swipe[data-slug="${s}"] .line`);
    const r = line.getBoundingClientRect();
    const at = (type, x) => line.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: r.top + 20 }));
    const x0 = r.right - 30;
    at('pointerdown', x0);
    for (let i = 1; i <= 10; i += 1) at('pointermove', x0 - (r.width * d * i) / 10);
    at('pointerup', x0 - r.width * d);
  }, [slug, distance]);
  await swipe(SLUGS[2], 0.2);
  await expect(page.locator('.lines .line')).toHaveCount(3);
  await swipe(SLUGS[2], 0.6);
  await expect(page.locator('.lines .line')).toHaveCount(2);

  await page.locator('.side').scrollIntoViewIfNeeded();
  await expect(bar).toHaveClass(/is-off/);
});

test('ยืนยัน → จ่าย → คูปองโค้ดเกม: ขั้นตอน 2/3/4, พลุฉลอง, แสดง/คัดลอกโค้ด, ลิงก์ร้านของแพลตฟอร์ม และ axe ผ่าน', async ({ page, browserName, context }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await registerAndVerify(page);
  await fillCart(page, SLUGS.slice(0, 2));
  await page.goto('/checkout');
  await page.waitForSelector('#placeBtn');
  expect(await current(page)).toBe('2');
  await expect(page.locator('.steps li.is-done')).toHaveCount(1);
  await expect(page.locator('.pay-method')).toHaveCount(2);
  expect(await serious(page)).toEqual([]);

  await page.click('#placeBtn');
  await page.waitForURL(/\/order\/\d+$/);
  await expect(page.locator('.status.pending')).toBeVisible();
  expect(await current(page)).toBe('3');
  await page.click('#devPay');
  await expect(page.locator('.status.paid')).toBeVisible();
  expect(await current(page)).toBe('4');
  await expect(page.locator('.steps li.is-done')).toHaveCount(3);
  await expect(page.locator('.paid-hero')).toHaveClass(/is-new/);
  await expect(page.locator('canvas.confetti')).toBeAttached();
  await expect(page.locator('canvas.confetti')).not.toBeAttached({ timeout: 6000 }); // ลบทิ้งเองเมื่อจบ

  const vouchers = page.locator('#keys .voucher');
  await expect(vouchers).toHaveCount(2);
  const first = vouchers.first();
  await expect(first.locator('.voucher-title')).toHaveText('Dragon Realm');
  await expect(first.locator('.voucher-platform')).toHaveText('PC');
  await expect(first.locator('.key')).toHaveText(/^•/);
  await first.locator('[data-act=show]').click();
  await expect(first.locator('[data-act=show]')).toHaveAttribute('aria-pressed', 'true');
  await expect(first.locator('.key')).toHaveText(/^FAKE-/);
  const redeem = first.locator('.voucher-redeem');
  await expect(redeem).toHaveAttribute('href', /steampowered\.com/);
  await expect(redeem).toHaveAttribute('rel', /noopener/);
  await expect(vouchers.nth(1).locator('.voucher-redeem')).toHaveAttribute('href', /playstation\.com/);
  if (browserName === 'chromium') {
    await first.locator('[data-act=copy]').click();
    await expect(first.locator('[data-act=copy]')).toHaveClass(/is-done/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^FAKE-/);
  }
  // art ของคูปองโหลดได้จริง (ภาพฉากของเกม)
  expect(await first.locator('.voucher-art').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('/api/games/dragon-realm/scene.svg');
  expect(await serious(page)).toEqual([]);

  // เปิดหน้าเดิมอีกครั้ง: ไม่ฉลองซ้ำ
  await page.reload();
  await expect(page.locator('.status.paid')).toBeVisible();
  await expect(page.locator('.paid-hero')).not.toHaveClass(/is-new/);
  await expect(page.locator('canvas.confetti')).toHaveCount(0);
});

test('ขอลดการเคลื่อนไหว: จ่ายแล้วไม่มีพลุ คูปองไม่มีแอนิเมชัน; มือถือ: คูปองเป็นแนวตั้งไม่ล้นจอ', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await registerAndVerify(page);
  await fillCart(page, ['cozy-farm-life']);
  await page.goto('/checkout');
  await page.click('#placeBtn');
  await page.waitForURL(/\/order\/\d+$/);
  await page.click('#devPay');
  await expect(page.locator('.status.paid')).toBeVisible();
  await expect(page.locator('canvas.confetti')).toHaveCount(0);
  await expect(page.locator('.voucher-redeem')).toHaveAttribute('href', /nintendo\.com/);
  const v = page.locator('.voucher').first();
  expect(await v.evaluate((el) => getComputedStyle(el).animationDuration)).toBe('0s');
  const box = await v.boundingBox();
  expect(box.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
