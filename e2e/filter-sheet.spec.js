import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// ตัวกรองหน้ารวมเกมบนมือถือ (UI เฟส 21): แผงเลื่อนขึ้นจากล่างจอ (<dialog> modal), กรองทันที, ปิดได้หลายทาง
const ready = (page) => page.waitForSelector('body.ready', { state: 'attached' });
const settle = (el) => el.evaluate((n) => Promise.all(n.getAnimations().map((a) => a.finished.catch(() => {}))));
const serious = async (page) => {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
};
const openSheet = async (page) => {
  await page.locator('#filtersToggle').click();
  const sheet = page.locator('#filterSheet');
  await expect(sheet).toHaveAttribute('open', '');
  await settle(sheet); // รอแอนิเมชันเลื่อนขึ้นจบก่อนวัดตำแหน่ง/ตรวจสี
  return sheet;
};

test('มือถือ: ปุ่มตัวกรองเปิดแผงจากล่างจอ, ปรับค่าแล้วกรองทันที + ปุ่มล่างบอกจำนวนเกม, ปุ่มล่างปิดแล้วโฟกัสกลับ, axe ผ่าน', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/games.html');
  await ready(page);
  await expect(page.locator('#filters')).toBeHidden();
  const total = await page.locator('#filtersDone').textContent();

  const sheet = await openSheet(page);
  const box = await sheet.boundingBox();
  expect(Math.round(box.y + box.height)).toBe(812); // ชิดล่างจอ
  expect(box.width).toBeGreaterThanOrEqual(374);
  expect(box.height).toBeLessThan(812 * 0.9); // ไม่เต็มจอ เห็นพื้นหลังด้านบน
  await expect(page.locator('#genre')).toBeFocused();
  await expect(page.locator('#fsTitle')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await serious(page)).toEqual([]);

  await page.locator('#platform').selectOption('PS5');
  await expect(page).toHaveURL(/platform=PS5/);
  await expect(page.locator('#filtersDone')).not.toHaveText(total); // จำนวนเกมในปุ่มล่างเปลี่ยนตามผลกรอง
  await expect(page.locator('#filtersDone')).toContainText(/\d/);
  await page.locator('#filtersDone').click();
  await expect(sheet).not.toHaveAttribute('open', '');
  await expect(page.locator('#filtersToggle')).toBeFocused(); // คืนโฟกัสให้ปุ่มที่เปิด
  await expect(page.locator('#filtersCount')).toHaveText('1');
  await expect(page.locator('.filter-chip').first()).toContainText('PS5');
  await expect(page.locator('html')).not.toHaveClass(/sheet-open/);
});

test('มือถือ: ปิดแผงด้วย Esc, ปุ่ม ✕, กดพื้นหลัง และลากแถบลง (ลากสั้นเด้งกลับ); หมุนเป็นจอกว้างแล้วฟอร์มกลับเข้าหน้า', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/games.html');
  await ready(page);
  const sheet = page.locator('#filterSheet');

  await openSheet(page);
  await page.keyboard.press('Escape');
  await expect(sheet).not.toHaveAttribute('open', '');

  await openSheet(page);
  await page.locator('#filtersClose').click();
  await expect(sheet).not.toHaveAttribute('open', '');

  await openSheet(page);
  await page.mouse.click(187, 60); // พื้นหลังด้านบน (นอกแผง)
  await expect(sheet).not.toHaveAttribute('open', '');

  // ลากด้วยนิ้ว (PointerEvent ชนิด touch): สั้น = เด้งกลับ, ยาว = ปิด
  const drag = (distance) => page.evaluate((d) => {
    const grip = document.querySelector('.fs-grip');
    const r = grip.getBoundingClientRect();
    const at = (type, y) => grip.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9, pointerType: 'touch', clientX: r.left + 20, clientY: y }));
    at('pointerdown', r.top + 2);
    for (let i = 1; i <= 8; i += 1) at('pointermove', r.top + 2 + (d * i) / 8);
    at('pointerup', r.top + 2 + d);
  }, distance);
  await openSheet(page);
  await drag(40);
  await expect(sheet).toHaveAttribute('open', '');
  await expect.poll(() => sheet.evaluate((n) => getComputedStyle(n).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  await drag(400);
  await expect(sheet).not.toHaveAttribute('open', '');

  // หมุน/ขยายเป็นจอกว้างขณะเปิดอยู่: แผงปิดเอง ฟอร์มกลับไปเป็นแถบในหน้า
  await openSheet(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(sheet).not.toHaveAttribute('open', '');
  await expect(page.locator('#filters')).toBeVisible();
  await expect(page.locator('#filtersToggle')).toBeHidden();
  await expect(page.locator('html')).not.toHaveClass(/sheet-open/);
});

test('ขอลดการเคลื่อนไหว: เปิด/ปิดแผงทันที ไม่มีแอนิเมชัน; จอกว้าง: ฟอร์มเป็นแถบในหน้าและกรองได้ตามเดิม', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/games.html');
  await ready(page);
  await page.locator('#filtersToggle').click();
  const sheet = page.locator('#filterSheet');
  await expect(sheet).toHaveAttribute('open', '');
  expect(await sheet.evaluate((n) => getComputedStyle(n).animationDuration)).toBe('0s');
  await page.locator('#filtersDone').click();
  await expect(sheet).not.toHaveAttribute('open', ''); // ปิดทันที ไม่รอ animationend

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#filtersToggle')).toBeHidden();
  await expect(page.locator('#filters')).toBeVisible();
  await expect(page.locator('#filterSheet')).not.toHaveAttribute('open', '');
  await page.locator('#platform').selectOption('PC');
  await expect(page).toHaveURL(/platform=PC/);
  expect(await serious(page)).toEqual([]);
});
