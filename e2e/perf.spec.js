import { test, expect } from '@playwright/test';

// งบประสิทธิภาพและพฤติกรรมของแอนิเมชัน/3D — วัดบน Chromium (มี CDP สำหรับจำลอง CPU ช้า)
// เกณฑ์: CLS < 0.1, LCP < 2.5 วินาที ที่จอมือถือ + CPU ช้าลง 4 เท่า (ใกล้เคียงมือถือระดับกลาง)
test.setTimeout(180_000);
test.skip(({ browserName }) => browserName !== 'chromium', 'ใช้ CDP ของ Chromium');

const PAGES = [['home', '/'], ['games', '/games.html'], ['game', '/game/dragon-realm'], ['cart', '/cart'], ['login', '/login']];

async function measure(page, url) {
  await page.addInitScript(() => {
    window.__vitals = { lcp: 0, cls: 0 };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__vitals.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500); // ให้ส่วนที่โหลดทีหลัง (การ์ด, ฉาก 3D) แสดงผลก่อนสรุป CLS
  return page.evaluate(() => window.__vitals);
}

test('Web vitals บนมือถือ (CPU ช้า 4x): CLS < 0.1 และ LCP < 2.5 วินาที ทุกหน้าหลัก', async ({ browser }) => {
  for (const [name, url] of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const v = await measure(page, url);
    expect(v.cls, `${name}: CLS ${v.cls.toFixed(3)}`).toBeLessThan(0.1);
    expect(v.lcp, `${name}: LCP ${Math.round(v.lcp)} ms`).toBeLessThan(2500);
    await ctx.close();
  }
});

test('Desktop: CLS < 0.1 (header จองที่ไว้ก่อน JS เติมเนื้อหา)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const [name, url] of PAGES) {
    const v = await measure(page, url);
    expect(v.cls, `${name}: CLS ${v.cls.toFixed(3)}`).toBeLessThan(0.1);
  }
});

test('ฉาก 3D หน้าแรก: โหลดแบบ lazy, หยุด render เมื่อเลื่อนออกนอกจอ, ไม่โหลดเมื่อขอลดการเคลื่อนไหวหรือบนมือถือ', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const scripts = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  await page.goto('/');
  const canvas = page.locator('#heroBg canvas.hero-canvas');
  await expect(canvas).toHaveAttribute('data-running', 'true', { timeout: 15_000 });
  expect(scripts.some((u) => /three/.test(u)), 'โหลดไฟล์ 3D แยก (lazy)').toBe(true);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(canvas).toHaveAttribute('data-running', 'false');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(canvas).toHaveAttribute('data-running', 'true');
  await ctx.close();

  const reduced = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const p2 = await reduced.newPage();
  const scripts2 = [];
  p2.on('request', (r) => { if (r.resourceType() === 'script') scripts2.push(r.url()); });
  await p2.goto('/');
  await p2.waitForLoadState('networkidle');
  await p2.waitForTimeout(2500);
  await expect(p2.locator('#heroBg canvas')).toHaveCount(0);
  await expect(p2.locator('#heroBg .hero-fallback')).toBeVisible();
  await expect(p2.locator('#heroStack img'), 'ภาพนิ่งสำรอง: ปกเกม 3 ใบ').toHaveCount(3);
  await expect(p2.locator('#heroStack img').first()).toBeVisible();
  expect(scripts2.some((u) => /three/.test(u)), 'ไม่ควรดาวน์โหลดไฟล์ 3D').toBe(false);
  await reduced.close();

  // จอมือถือ: ไม่โหลดฉาก 3D (ประหยัดแบตและเน็ต) ใช้พื้นหลังนิ่ง
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p3 = await mobile.newPage();
  const scripts3 = [];
  p3.on('request', (r) => { if (r.resourceType() === 'script') scripts3.push(r.url()); });
  await p3.goto('/');
  await p3.waitForLoadState('networkidle');
  await p3.waitForTimeout(2500);
  await expect(p3.locator('#heroBg canvas')).toHaveCount(0);
  expect(scripts3.some((u) => /three/.test(u)), 'มือถือไม่ควรดาวน์โหลดไฟล์ 3D').toBe(false);
  await mobile.close();
});

test('หน้าแรกบนมือถือ: แถวเกมเป็นแถวปัดแนวนอน (หน้าไม่ยาวเกินจำเป็น) และทั้งหน้าไม่เลื่อนแนวนอน', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForSelector('body.ready', { state: 'attached' });
  const r = await page.evaluate(() => {
    const row = document.querySelector('#bestsellers');
    return { pageOverflow: document.documentElement.scrollWidth - innerWidth, rowScrolls: row.scrollWidth > row.clientWidth, height: document.documentElement.scrollHeight };
  });
  expect(r.pageOverflow).toBe(0);
  expect(r.rowScrolls).toBe(true);
  expect(r.height, 'เดิมยาว 16,000px เพราะการ์ดเรียงลงทีละใบ').toBeLessThan(8000);
  await ctx.close();
});
