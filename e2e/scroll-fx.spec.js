import { test, expect } from '@playwright/test';

// parallax / ค่อย ๆ ปรากฏ แบบสำรอง (scroll-fx.js) สำหรับเบราว์เซอร์ที่ไม่รองรับ CSS scroll-driven animation
// Chromium รองรับอยู่แล้ว → ทำให้ CSS.supports ตอบว่าไม่รองรับเพื่อทดสอบเส้นทางสำรอง (Firefox ใช้เส้นทางนี้จริงอยู่แล้ว)
const forceFallback = (page) => page.addInitScript(() => {
  const real = CSS.supports.bind(CSS);
  CSS.supports = (...a) => (/animation-timeline/.test(a.join(' ')) ? false : real(...a));
});

test('สำรอง: ฉากหลัง hero เลื่อนช้ากว่าเนื้อหา และหน้าเกมค่อย ๆ แสดงส่วนที่เลื่อนถึง (ส่วนที่อยู่ในจอแสดงทันที)', async ({ page }) => {
  await forceFallback(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForSelector('body.ready', { state: 'attached' });
  await expect(page.locator('html')).toHaveClass(/scroll-fx/);
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, 400); });
  await expect.poll(() => page.locator('.hero-bg').evaluate((el) => el.style.transform)).toMatch(/translateY\(\d+(\.\d+)?px\)/);

  await page.goto('/game/dragon-realm');
  await page.waitForSelector('body.ready', { state: 'attached' });
  const sections = page.locator('.reveal-scroll');
  // ส่วนที่อยู่ในจอตั้งแต่แรกแสดงทันที (hero หน้าเกมสูงเกือบเต็มจอตั้งแต่เฟส 26 — ส่วนแรกอาจอยู่ใต้จอแล้ว)
  await expect.poll(() => sections.evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().top < innerHeight).every((el) => el.classList.contains('revealed')))).toBe(true);
  const last = sections.last();
  await expect(last).not.toHaveClass(/revealed/);
  await last.scrollIntoViewIfNeeded();
  await expect(last).toHaveClass(/revealed/);
  await expect(last).toHaveCSS('opacity', '1');
});

test('สำรอง: ขอลดการเคลื่อนไหว → ไม่ขยับ ไม่ซ่อนอะไร', async ({ page }) => {
  await forceFallback(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/game/dragon-realm');
  await page.waitForSelector('body.ready', { state: 'attached' });
  await expect(page.locator('html')).not.toHaveClass(/scroll-fx/);
  await expect(page.locator('.reveal-scroll').last()).toHaveCSS('opacity', '1');
});
