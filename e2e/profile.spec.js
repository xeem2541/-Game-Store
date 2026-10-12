import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { registerAndVerify } from './helpers.mjs';

// หน้าบัญชี (UI เฟส 19): หัวโปรไฟล์, เมนูข้าง/แถบเลื่อน, เปลี่ยนรหัสผ่านพร้อมตัววัดความแข็งแรง
const serious = async (page) => {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
};

test('บัญชี: หัวโปรไฟล์ + เมนูข้างบนจอกว้าง, สลับแท็บ, เปลี่ยนรหัสผ่านมีปุ่มแสดง/ซ่อน + ตัววัดความแข็งแรง, axe ผ่าน', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const u = await registerAndVerify(page);
  await page.goto('/profile');
  await page.waitForSelector('body.ready', { state: 'attached' });
  const hero = page.locator('#profileHero');
  await expect(hero.locator('.avatar')).toHaveText(/\S/);
  await expect(hero.locator('.ph-meta')).toContainText(u.email);
  await expect(page.locator('.profile-nav')).toBeVisible();
  const [nav, panel] = [await page.locator('.profile-nav').boundingBox(), await page.locator('#panel').boundingBox()];
  expect(panel.x).toBeGreaterThan(nav.x + nav.width - 1); // เมนูอยู่ซ้าย เนื้อหาอยู่ขวา
  expect(await serious(page)).toEqual([]);

  await page.locator('[data-tab=password]').click();
  await expect(page.locator('[data-tab=password]')).toHaveClass(/active/);
  const next = page.locator('#pwForm input[name=next]');
  await next.fill('12345678');
  await expect(page.locator('.pw-meter')).toHaveAttribute('data-level', '1');
  await next.fill('correct-Horse-battery-9');
  await expect(page.locator('.pw-meter')).toHaveAttribute('data-level', '4');
  const toggle = page.locator('#pwForm .pw-toggle').nth(1);
  await toggle.click();
  await expect(next).toHaveAttribute('type', 'text');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await serious(page)).toEqual([]);

  await page.locator('#pwForm input[name=cur]').fill(u.password);
  await page.locator('#pwForm button[type=submit]').click();
  await expect(page.locator('#msg')).toHaveClass(/ok/);
  await expect(page.locator('.pw-meter')).toHaveAttribute('data-level', '0');
});

test('บัญชีบนมือถือ: เมนูเป็นแถบแนวนอน ไม่ล้นจอ และกดสลับแท็บได้', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await registerAndVerify(page);
  await page.goto('/profile');
  await page.waitForSelector('body.ready', { state: 'attached' });
  const [nav, panel] = [await page.locator('.profile-nav').boundingBox(), await page.locator('#panel').boundingBox()];
  expect(panel.y).toBeGreaterThan(nav.y); // เมนูอยู่เหนือเนื้อหา
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-tab=orders]').scrollIntoViewIfNeeded();
  await page.locator('[data-tab=orders]').click();
  await expect(page.locator('#panel .empty')).toBeVisible();
  expect(await serious(page)).toEqual([]);
});
