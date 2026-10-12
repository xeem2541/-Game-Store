import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// หน้ารวมเกม (UI เฟส 15): ช่องแนวเกมแบบ bento, แถบตัวกรองติดใต้ header, ป้ายตัวกรองที่ลบได้, การ์ดหลังเปลี่ยนตัวกรอง
const open = async (page, qs = '') => {
  await page.goto(`/games.html${qs}`);
  await page.waitForSelector('body.ready', { state: 'attached' });
};
const cardGenres = (page) => page.locator('#grid .card .meta').evaluateAll((els) => els.map((e) => e.textContent.split('•')[0].trim()));

test('ช่องแนวเกม: แนวที่มีเกมมากสุดเป็นช่องใหญ่, กดเพื่อกรอง (URL + ป้าย + การ์ด), กดซ้ำเพื่อยกเลิก', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  const tiles = page.locator('.genre-tile');
  const genres = await page.locator('#genre option').evaluateAll((o) => o.map((x) => x.value).filter(Boolean));
  await expect(tiles).toHaveCount(genres.length + 1); // ทุกแนว + "ทุกแนว"
  await expect(tiles.first()).toHaveClass(/is-big/);
  await expect(page.locator('.genre-tile.is-all')).toHaveAttribute('aria-pressed', 'true');

  const big = tiles.first();
  const genre = await big.getAttribute('data-genre');
  await big.click();
  await expect(page).toHaveURL(new RegExp(`genre=${encodeURIComponent(genre)}`));
  await expect(big).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#genre')).toHaveValue(genre);
  await expect(page.locator('.filter-chip[data-clear="genre"]')).toBeVisible();
  await expect.poll(async () => new Set(await cardGenres(page)).size).toBe(1);

  await big.click();
  await expect(page).not.toHaveURL(/genre=/);
  await expect(page.locator('.genre-tile.is-all')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#activeFilters')).toBeHidden();
});

test('ป้ายตัวกรอง: แสดงตัวกรองที่ใช้, กด ✕ ลบทีละตัวแล้วโฟกัสไปป้ายถัดไป, "ล้างทั้งหมด" ล้างทุกอย่าง', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, '?onSale=1&minPrice=100&maxPrice=1000&platform=PC');
  const chips = page.locator('#activeFilters .filter-chip');
  // จาก URL ตอนเปิดหน้า: แพลตฟอร์ม, ช่วงราคา, เฉพาะลดราคา + ล้างทั้งหมด
  await expect(chips).toHaveCount(4);
  await expect(page.locator('.filter-chip[data-clear="price"]')).toContainText('100');
  await expect(page.locator('.filter-chip[data-clear="price"]')).toHaveAttribute('aria-label', /1,?000/);

  await page.locator('.filter-chip[data-clear="platform"]').click();
  await expect(page).not.toHaveURL(/platform=/);
  await expect(page.locator('#platform')).toHaveValue('');
  await expect(chips).toHaveCount(3);
  await expect(page.locator('.filter-chip[data-clear="price"]')).toBeFocused();

  await page.locator('.filter-chip[data-clear="all"]').click();
  await expect(page).toHaveURL(/\/games\.html$/);
  await expect(page.locator('#activeFilters')).toBeHidden();
});

test('การ์ดหลังเปลี่ยนตัวกรอง: หัวใจมีชื่อปุ่ม, ป้ายส่วนลดพื้นทึบ, จำนวนเกมอัปเดต และ axe ผ่าน', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  const count = await page.locator('#count').textContent();
  await page.locator('input[name="onSale"]').check();
  await expect(page).toHaveURL(/onSale=1/);
  await expect(page.locator('#count')).not.toHaveText(count);
  await expect(page.locator('#grid')).toHaveAttribute('aria-busy', 'false');
  // หัวใจของการ์ดชุดใหม่ต้องถูกระบาย (มีไอคอน + aria-label) — เดิมระบายก่อนใส่การ์ด ปุ่มเลยว่างไม่มีชื่อ
  const hearts = page.locator('#grid .card [data-wish]');
  expect(await hearts.count()).toBeGreaterThan(0);
  for (const label of await hearts.evaluateAll((b) => b.map((x) => x.getAttribute('aria-label')))) expect(label).toBeTruthy();
  const badgeBg = await page.locator('#grid .card .badge').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(badgeBg).toMatch(/^rgb\(/); // rgb() = ทึบ (rgba(..., 0.1) เดิมโปร่งจนอ่านไม่ออกบนภาพสว่าง)
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
});

test('แถบตัวกรองติดใต้ header ตอนเลื่อน (desktop) และหน้าผลค้นหาไม่มีช่องแนวเกม', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await page.evaluate(() => scrollTo(0, 900));
  await expect.poll(() => page.locator('#filters').evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(130);
  const header = await page.locator('header.topbar').boundingBox();
  const bar = await page.locator('#filters').boundingBox();
  expect(bar.y).toBeGreaterThanOrEqual(header.y + header.height - 1); // ไม่ซ้อนทับ header

  await open(page, '?q=dragon');
  await expect(page.locator('#genreBento')).toBeHidden();
  await expect(page.locator('#activeFilters .filter-chip[data-clear="q"]')).toBeVisible();
});

test('มือถือ: ช่องแนวเกมเป็นแถวปัดแนวนอน หน้าไม่เลื่อนแนวนอน; ขอลดการเคลื่อนไหว: หัวข้อไม่แยกคำ การ์ดไม่มีแอนิเมชัน', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  const bento = page.locator('#genreBento');
  expect(await bento.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
  expect(await bento.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // ตัวกรองอยู่ในแผงที่เลื่อนขึ้นจากล่างจอ (ไม่ให้ฟอร์มยาวดันการ์ดเกมพ้นจอแรก; รายละเอียดใน filter-sheet.spec.js) — เปิดแล้วโฟกัสช่องแรก
  await expect(page.locator('#filters')).toBeHidden();
  await page.locator('#filtersToggle').click();
  await expect(page.locator('#filterSheet')).toHaveAttribute('open', '');
  await expect(page.locator('#filters')).toBeVisible();
  await expect(page.locator('#genre')).toBeFocused();
  await expect(page.locator('#catalogTitle')).not.toHaveClass(/kt-in/);
  expect(await page.locator('#grid .card').first().evaluate((el) => getComputedStyle(el).animationDuration)).toBe('0s');
});
