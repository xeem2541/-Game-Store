import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// UI เฟส 24: Spotlight บนการ์ด, ปุ่มแม่เหล็ก, ตัวเลขนับขึ้น, ผิวฟิล์ม, แถบชื่อเกมเลื่อน
const ready = (page) => page.waitForSelector('body.ready', { state: 'attached' });
const serious = (r) => r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));

test('Spotlight + แม่เหล็ก: ตามเมาส์บน desktop, ปุ่มขยับไม่เกิน 8px และแสงไม่บังปุ่ม', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await ready(page);
  // เอฟเฟกต์นี้เฉพาะอุปกรณ์ที่มีเมาส์ — เบราว์เซอร์ headless บางตัวไม่รายงานว่ามีเมาส์
  test.skip(!(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)), 'เบราว์เซอร์นี้ไม่รายงาน (hover: hover) and (pointer: fine)');
  const card = page.locator('#bestsellers .card').first();
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + 60, box.y + 80);
  await expect.poll(() => card.evaluate((c) => c.style.getPropertyValue('--x'))).toMatch(/^\d+px$/);
  // ปุ่ม "+ ตะกร้า" ยังเป็นสิ่งที่อยู่บนสุด ณ จุดนั้น (แสง/ผิวฟิล์มไม่บัง)
  const add = card.locator('[data-add]');
  const ab = await add.boundingBox();
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-add]') !== null, [ab.x + ab.width / 2, ab.y + ab.height / 2])).toBe(true);

  await page.goto('/game/dragon-realm');
  await ready(page);
  const btn = page.locator('#addBtn');
  const r = await btn.boundingBox();
  await page.mouse.move(r.x + r.width + 40, r.y + r.height + 40, { steps: 4 }); // ใกล้ปุ่ม แต่ไกลพอที่ไม่จำกัดก็จะเกิน 8px
  await expect(btn).toHaveClass(/is-magnet/);
  await page.waitForTimeout(700); // รอ transition จบ
  const [tx, ty] = (await btn.evaluate((b) => getComputedStyle(b).translate)).split(' ').map(parseFloat);
  expect(Math.abs(tx)).toBeGreaterThan(0);
  expect(Math.abs(tx)).toBeLessThanOrEqual(8);
  expect(Math.abs(ty)).toBeLessThanOrEqual(8);
  await page.mouse.move(5, 5); // ออกนอกระยะ → กลับที่เดิม
  await expect(btn).not.toHaveClass(/is-magnet/);
});

test('จอสัมผัส (hover: none): ไม่มี spotlight และปุ่มไม่ขยับ', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'จำลองจอสัมผัส (isMobile) ได้แน่นอนบน Chromium');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto('/game/dragon-realm');
  await ready(page);
  const btn = page.locator('#addBtn');
  const r = await btn.boundingBox();
  await page.mouse.move(r.x + r.width + 20, r.y + 10);
  await page.waitForTimeout(300);
  await expect(btn).not.toHaveClass(/is-magnet/);
  expect(await btn.evaluate((b) => b.style.getPropertyValue('--mag-x'))).toBe('');
  await ctx.close();
});

test('Count-up: วิ่งขึ้นเมื่อเลื่อนถึงแล้วจบที่ค่าจริงทุกตัวอักษร (ครั้งเดียว)', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const price = page.locator('#onSale .card .price').first();
  const real = await price.evaluate((el) => el.textContent); // ค่าจริงอยู่ใน DOM ก่อนเลื่อนถึง
  expect(real).toMatch(/\d/);
  await price.evaluate((el) => {
    window.__cu = [];
    new MutationObserver(() => window.__cu.push(el.textContent)).observe(el, { subtree: true, characterData: true, childList: true });
  });
  await price.scrollIntoViewIfNeeded();
  await expect.poll(() => price.evaluate((el) => el.querySelector('.cu-num') !== null)).toBe(true); // เริ่มนับแล้ว
  await expect.poll(() => price.evaluate((el) => el.textContent)).toBe(real); // จบที่ค่าจริงทุกตัวอักษร
  const seen = await page.evaluate(() => window.__cu);
  expect(seen.some((s) => s !== real)).toBe(true); // มีค่าระหว่างทางจริง
  // เลื่อนออกแล้วกลับมา: ไม่นับซ้ำ
  await page.evaluate(() => scrollTo(0, 0));
  await page.evaluate(() => { window.__cu = []; });
  await price.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__cu.length)).toBe(0);
});

test('Marquee: ชุดซ้ำ aria-hidden + ไม่รับ Tab, หยุดเมื่อ hover/กดปุ่ม และ axe ผ่าน', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await ready(page);
  const band = page.locator('#marqueeDeals');
  await band.scrollIntoViewIfNeeded();
  await expect(band).toHaveClass(/is-running/);
  const lists = band.locator('.marquee-list');
  expect(await lists.count()).toBeGreaterThan(1);
  await expect(lists.first()).not.toHaveAttribute('aria-hidden', 'true');
  expect(await band.locator('.marquee-list:not([aria-hidden="true"])').count()).toBe(1);
  expect(await band.locator('.marquee-list[aria-hidden="true"] a:not([tabindex="-1"])').count()).toBe(0);
  // ชื่อเกมใน accessibility tree มีชุดเดียว
  const first = await lists.first().locator('a').first().innerText();
  expect(await page.getByRole('link', { name: first, exact: false }).and(band.locator('a')).count()).toBe(1);

  const track = band.locator('.marquee-track');
  const state = () => track.evaluate((t) => getComputedStyle(t).animationPlayState);
  // IntersectionObserver แจ้งแบบ async (WebKit ช้ากว่า) — รอให้แถบรู้ว่าอยู่ในจอก่อน
  await page.mouse.move(5, 5);
  await expect.poll(state).toBe('running');
  await band.locator('.marquee-viewport').hover();
  await expect.poll(state).toBe('paused');
  await page.mouse.move(5, 5);
  await expect.poll(state).toBe('running');
  const toggle = band.locator('.marquee-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(5, 5);
  await expect.poll(state).toBe('paused');

  const res = await new AxeBuilder({ page }).include('.marquee').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(serious(res).map((v) => v.id)).toEqual([]);
});

test('ขอลดการเคลื่อนไหว: ทุกเอฟเฟกต์ปิด ตัวเลขเป็นค่าจริง แถบชื่อเกมไม่เลื่อนและไม่ซ้ำ', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await ready(page);
  const band = page.locator('#marqueeTop');
  await expect(band).toHaveClass(/is-static/);
  expect(await band.locator('.marquee-list').count()).toBe(1);
  await expect(band.locator('.marquee-toggle')).toBeHidden();
  const price = page.locator('#onSale .card .price').first();
  await price.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  expect(await price.locator('.cu-num').count()).toBe(0); // ไม่แตะตัวเลขเลย
  const card = page.locator('#bestsellers .card').first();
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + 50, box.y + 50);
  await page.waitForTimeout(200);
  expect(await card.evaluate((c) => c.style.getPropertyValue('--x'))).toBe('');
  expect(await page.evaluate(() => getComputedStyle(document.body, '::after').display)).toBe('none'); // ผิวฟิล์มปิด
});

test('ผิวฟิล์ม: อยู่หลังเนื้อหาและไม่รับคลิก — ช่องค้นหายังกดได้', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await ready(page);
  const grain = await page.evaluate(() => { const s = getComputedStyle(document.body, '::after'); return { z: s.zIndex, pe: s.pointerEvents, bg: s.backgroundImage.slice(0, 30) }; });
  expect(grain).toEqual({ z: '-1', pe: 'none', bg: expect.stringContaining('data:image/svg+xml') });
  const search = page.locator('#search');
  const sb = await search.boundingBox();
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [sb.x + 20, sb.y + sb.height / 2])).toBe('search');
});
