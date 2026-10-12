import { test, expect } from '@playwright/test';
import { adminLogin, registerAndVerify, setRole } from './helpers.mjs';

// หลังบ้าน (UI เฟส 22): ไอคอนเมนูเป็น SVG ชุดเดียวกับหน้าร้าน และตารางกว้างบนมือถือเป็นการ์ดทีละแถว (ไม่เลื่อนแนวนอน)
test.setTimeout(180_000);

test('หลังบ้าน: เมนูใช้ไอคอน SVG (ไม่ใช่อีโมจิ) + ชื่อเมนูเป็นไทย; จอกว้าง = ตารางตามเดิม; มือถือ = การ์ด มีชื่อคอลัมน์ ไม่เลื่อนแนวนอน และ screen reader ยังเห็นเป็นตาราง', async ({ page }) => {
  const u = await registerAndVerify(page);
  setRole(u.email, 'admin');
  await adminLogin(page, u);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/admin/#/games');
  await expect(page.locator('#view table')).toBeVisible();

  const links = page.locator('#nav a');
  await expect(links.first()).toContainText('ภาพรวม');
  await expect(links.first().locator('svg use')).toHaveAttribute('href', '/icons.svg#icon-dashboard');
  const labels = await links.allTextContents();
  expect(labels.join('')).not.toMatch(/\p{Extended_Pictographic}/u); // ไม่มีอีโมจิในเมนู
  for (let i = 0; i < await links.count(); i += 1) await expect(links.nth(i).locator('svg')).toHaveCount(1);
  // ไอคอนวาดจริง (ไม่ใช่กล่องว่าง): sprite โหลดได้
  expect((await links.first().locator('svg').boundingBox()).width).toBeGreaterThan(10);

  // จอกว้าง: ยังเป็นตารางปกติ (หัวตารางเห็น แถวเรียงในแนวตาราง)
  expect(await page.locator('.as-cards table').evaluate((n) => getComputedStyle(n).display)).toBe('table');
  await expect(page.locator('.as-cards thead')).toBeVisible();

  // มือถือ: การ์ด
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/admin/#/games');
  await expect(page.locator('#view .as-cards')).toBeVisible();
  const wrap = page.locator('.as-cards').first();
  expect(await wrap.evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(true); // ไม่ต้องเลื่อนแนวนอน
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const row = wrap.locator('tbody tr').first();
  expect(await row.evaluate((n) => getComputedStyle(n).display)).toBe('block');
  const price = row.locator('td[data-label="ราคา"]');
  expect(await price.evaluate((n) => getComputedStyle(n, '::before').content)).toContain('ราคา'); // ชื่อคอลัมน์แสดงในการ์ด
  await expect(price).toBeVisible();
  expect(await wrap.locator('thead').evaluate((n) => n.getBoundingClientRect().width)).toBeLessThanOrEqual(1); // หัวตารางซ่อนทางสายตา
  // ยังเป็นตารางสำหรับเทคโนโลยีช่วยเหลือ (role ชัดเจน): หัวคอลัมน์และแถวอยู่ใน a11y tree
  await expect(page.getByRole('columnheader', { name: 'ราคา' })).toHaveCount(1);
  expect(await page.getByRole('row').count()).toBeGreaterThan(10);
  await expect(page.getByRole('cell').first()).toBeAttached();

  // เมนูมือถือ: ปุ่มเปิดเป็นไอคอน SVG ที่ยังมีชื่อปุ่ม
  await expect(page.locator('#menuBtn svg')).toHaveCount(1);
  await expect(page.locator('#menuBtn')).toHaveAttribute('aria-label', 'เปิดเมนู');
});
