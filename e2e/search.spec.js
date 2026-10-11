import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// ค้นหา (UI เฟส 8): รายการแนะนำใช้คีย์บอร์ดได้ (ARIA combobox), เน้นคำที่ตรง, คำไทย, หน้าผลการค้นหา
test('ช่องค้นหา: รายการแนะนำ ลูกศร/Enter/Esc, เน้นคำที่ตรง และ screen reader รู้ว่าเลือกอะไรอยู่', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lang', 'th'));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForSelector('body.ready', { state: 'attached' });
  const input = page.locator('#search');
  await expect(input).toHaveAttribute('role', 'combobox');
  await expect(input).toHaveAttribute('aria-expanded', 'false');

  await input.fill('drag');
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(list.getByRole('option').first().locator('mark')).toHaveText(/drag/i);
  await expect(list.getByRole('option').last()).toContainText('ดูผลการค้นหาทั้งหมด');
  const bad = (await new AxeBuilder({ page }).include('.search').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' ' + (n.failureSummary ?? '')).join(' | ')}`)).toEqual([]);

  await input.fill('');
  await input.fill('drag'); // axe ย้ายโฟกัสออกจากช่องค้นหา → รายการปิด (ตั้งใจ) จึงพิมพ์ใหม่
  await expect(list).toBeVisible();
  await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', 'sug-0');
  await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await input.press('Escape');
  await expect(list).toBeHidden();
  await expect(input).toHaveAttribute('aria-expanded', 'false');

  // คำไทยแนะนำเกมที่ชื่อเป็นภาษาอังกฤษได้ แล้ว Enter เปิดหน้าเกม
  await input.fill('มังกร');
  await expect(list.getByRole('option').first()).toContainText('Dragon Realm');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/game\/dragon-realm/);
});

test('หน้าผลการค้นหา: หัวข้อบอกคำค้น, ช่องค้นหาแสดงคำเดิม, แจ้งเมื่อแสดงผลแบบผ่อนปรน และเมื่อไม่พบ', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lang', 'th'));
  await page.goto('/games.html?q=' + encodeURIComponent('dragon zzzqqq'));
  await page.waitForSelector('body.ready', { state: 'attached' });
  await expect(page.locator('h1')).toContainText('ผลการค้นหา “dragon zzzqqq”');
  await expect(page.locator('#search')).toHaveValue('dragon zzzqqq');
  await expect(page.locator('#grid .search-note')).toBeVisible();
  await expect(page.locator('#grid .card').first()).toContainText('Dragon Realm');

  await page.goto('/games.html?q=zzzqqq');
  await page.waitForSelector('body.ready', { state: 'attached' });
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#empty')).toContainText('zzzqqq');
  await page.locator('#empty a').click();
  await expect(page).toHaveURL(/\/games\.html$/);
});
