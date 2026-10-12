import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// หน้าเข้าสู่ระบบ/สมัคร แบบแบ่งครึ่งจอ: ภาพปกเกม + ฟอร์ม, แท็บสลับหน้า (พา ?next= ไปด้วย), แสดง/ซ่อนรหัสผ่าน, ตัววัดความแข็งแรง
const serious = async (page) => {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
};

test('เข้าสู่ระบบ (desktop): ภาพซ้าย-ฟอร์มขวา, ปกเกมโหลด, แท็บพา ?next= ไปหน้าสมัคร, แสดง/ซ่อนรหัสผ่าน, axe ผ่าน', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/login?next=%2Fcart');
  const art = page.locator('.auth-art');
  const box = page.locator('.auth-split .auth-box');
  const [a, b] = [await art.boundingBox(), await box.boundingBox()];
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1); // ภาพอยู่ซ้ายของฟอร์ม
  await expect(page.locator('.aa-card.is-in')).toHaveCount(3);
  await expect(page.locator('.auth-tabs [aria-current="page"]')).toHaveAttribute('href', /^\/login/);
  await expect(page.locator('.auth-tabs a[href^="/register"]')).toHaveAttribute('href', '/register?next=%2Fcart');

  const pw = page.locator('input[name=password]');
  const toggle = page.locator('.pw-toggle');
  await pw.fill('secret-pass-1');
  await toggle.click();
  await expect(pw).toHaveAttribute('type', 'text');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAttribute('aria-label', /ซ่อน|Hide/);
  await expect(pw).toBeFocused();
  await toggle.click();
  await expect(pw).toHaveAttribute('type', 'password');
  // ชื่อช่องรหัสผ่านไม่ปนชื่อปุ่ม (ปุ่มอยู่นอก <label>)
  await expect(page.getByLabel('รหัสผ่าน', { exact: true })).toHaveCount(1);
  expect(await serious(page)).toEqual([]);
});

test('สมัคร: ตัววัดความแข็งแรงเปลี่ยนตามที่พิมพ์ (เบอร์โทร/ชื่อในอีเมล = อ่อนมาก) และ screen reader ได้ยินระดับ, มือถือภาพเป็นแถบด้านบน, axe ผ่าน', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/register');
  const meter = page.locator('.pw-meter');
  const hint = page.locator('#pwHint');
  const pw = page.locator('input[name=password]');
  await expect(pw).toHaveAttribute('aria-describedby', 'pwHint');
  await expect(meter).toHaveAttribute('data-level', '0');
  await pw.fill('abc');
  await expect(meter).toHaveAttribute('data-level', '1');
  await pw.fill('0812345678');
  await expect(meter).toHaveAttribute('data-level', '1');
  await expect(hint).toContainText(/เดาง่าย|guess/);
  await page.fill('input[name=email]', 'kittisak@example.com');
  await pw.fill('kittisak2026!');
  await expect(meter).toHaveAttribute('data-level', '1');
  await pw.fill('trombone7');
  await expect(meter).toHaveAttribute('data-level', '2');
  await pw.fill('trombone-Kite7');
  await expect(meter).toHaveAttribute('data-level', '4');
  await expect(hint).toContainText(/แข็งแรง|Strong/);

  const [a, b] = [await page.locator('.auth-art').boundingBox(), await page.locator('.auth-split .auth-box').boundingBox()];
  expect(a.y + a.height).toBeLessThanOrEqual(b.y + 1); // ภาพอยู่บนฟอร์ม
  expect(a.height).toBeLessThan(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await serious(page)).toEqual([]);
});

test('ลืมรหัส / ตั้งรหัสใหม่ / ยืนยันอีเมล ใช้โครงแบ่งครึ่งจอเดียวกัน และหน้าตั้งรหัสใหม่มีตัววัด', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  for (const path of ['/forgot', '/reset?token=x', '/verify?token=x']) {
    await page.goto(path);
    await expect(page.locator('main.auth-split .auth-art')).toBeVisible();
    await expect(page.locator('main.auth-split .auth-box h1')).toBeVisible();
  }
  await page.goto('/reset?token=x');
  await page.locator('input[name=password]').fill('trombone-Kite7');
  await expect(page.locator('.pw-meter')).toHaveAttribute('data-level', '4');
});
