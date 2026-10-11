import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminLogin, registerAndVerify, setRole } from './helpers.mjs';

// หน้าตาและการใช้งานหลังบ้าน (UI เฟส 7): a11y ทุกหน้า, เมนู drawer บนจอเล็ก, toast มองเห็นได้, กล่องโต้ตอบใช้คีย์บอร์ดได้
test.setTimeout(240_000);
const ROUTES = ['dashboard', 'games', 'games/1', 'stock', 'orders', 'users', 'coupons', 'reviews', 'reports', 'audit'];
const serious = (r) => r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);

test('หลังบ้าน: axe (WCAG 2 AA) ทุกหน้าที่ 1280 และ 375px, หน้าเข้าสู่ระบบ', async ({ page, browser }) => {
  const ctx = await browser.newContext();
  const login = await ctx.newPage();
  await login.goto('/admin/login');
  expect(serious(await new AxeBuilder({ page: login }).withTags(['wcag2a', 'wcag2aa']).analyze()), 'admin/login').toEqual([]);
  await ctx.close();

  const u = await registerAndVerify(page);
  setRole(u.email, 'admin');
  await adminLogin(page, u);
  for (const w of [1280, 375]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const route of ROUTES) {
      await page.goto(`/admin/#/${route}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#view .spinner')).toHaveCount(0);
      expect(serious(await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()), `admin/${route} @${w}px`).toEqual([]);
    }
  }
});

test('หลังบ้าน: เมนู drawer บนจอเล็ก, กล่องโต้ตอบ (Esc + คืนโฟกัส) และ toast', async ({ page }) => {
  const u = await registerAndVerify(page);
  setRole(u.email, 'admin');
  await page.setViewportSize({ width: 375, height: 812 });
  await adminLogin(page, u);
  await page.goto('/admin/#/dashboard');

  // เมนูปิดอยู่: ลิงก์ในเมนูต้องไม่ถูก Tab ไปถึง (ซ่อนจริง ไม่ใช่แค่เลื่อนออกนอกจอ)
  const menuBtn = page.locator('#menuBtn');
  await expect(page.locator('#nav a').first()).toBeHidden();
  await expect(menuBtn).toHaveAttribute('aria-expanded', 'false');
  await menuBtn.click();
  await expect(menuBtn).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#nav a').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menuBtn).toHaveAttribute('aria-expanded', 'false');
  await expect(menuBtn).toBeFocused();
  // กดพื้นหลังมืดเพื่อปิด / เลือกเมนูแล้วเมนูปิดเอง
  await menuBtn.click();
  await page.locator('#nav a[data-key="games"]').click();
  await expect(menuBtn).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#nav a[data-key="games"]')).toHaveAttribute('aria-current', 'page');

  // กล่องยืนยัน: Esc ปิดแล้วโฟกัสกลับไปที่ปุ่มที่เปิด
  await page.goto('/admin/#/games/1');
  const hide = page.locator('#hideBtn');
  await hide.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(hide).toBeFocused();

  // toast มองเห็นได้จริง (เดิม CSS ของหน้าร้านซ่อนไว้) และอยู่ในกล่อง aria-live
  await page.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
  const toast = page.locator('#toasts .toast');
  await expect(toast).toBeVisible();
  await expect(page.locator('#toasts')).toHaveAttribute('aria-live', 'polite');
});

test('หน้าเข้าสู่ระบบหลังบ้าน: แสดงทีละขั้น (ฟอร์ม 2FA ซ่อนจนกว่ารหัสผ่านถูก)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lang', 'en')); // เลือกภาษาอังกฤษไว้ในหน้าร้าน
  await page.goto('/admin/login');
  await expect(page.locator('#form')).toBeVisible();
  await expect(page.locator('#mfaForm')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('lang', 'th'); // หลังบ้านมีภาษาไทยอย่างเดียว ไม่ตามภาษาที่เลือกในหน้าร้าน
});
