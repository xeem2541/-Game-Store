import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// UI เฟส 25: ฉากเปิดตัว + พื้นหลังแสงของเหลว (WebGL) ของ hero, วงล้อเกม 3 มิติตามการเลื่อน
const ready = (page) => page.waitForSelector('body.ready', { state: 'attached' });
const serious = (r) => r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));

test('ฉากเปิดตัว: เล่นครั้งเดียวต่อการเปิดเว็บ ไม่บังการคลิก และจบเองแล้วซ่อนสนิท', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/', { waitUntil: 'commit' });
  await page.waitForSelector('.intro', { state: 'attached' });
  expect(await page.evaluate(() => document.documentElement.dataset.intro)).toBe('play');
  const intro = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.intro')); return { display: s.display, pe: s.pointerEvents }; });
  expect(intro).toEqual({ display: 'block', pe: 'none' });
  // ระหว่างฉากเล่น ปุ่มใน hero ยังเป็นสิ่งที่อยู่บนสุด ณ ตำแหน่งนั้น (คลิกได้ทันที)
  const btn = page.locator('.hero-actions .btn').first();
  const b = await btn.boundingBox();
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.hero-actions') !== null, [b.x + b.width / 2, b.y + b.height / 2])).toBe(true);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.intro')).visibility), { timeout: 5000 }).toBe('hidden');

  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.dataset.intro ?? null)).toBeNull(); // ไม่เล่นซ้ำในแท็บเดิม
  await page.goto('/games.html');
  expect(await page.evaluate(() => document.documentElement.dataset.intro ?? null)).toBeNull(); // หน้าอื่นไม่มีฉากเปิดตัว
});

test('ฉากเปิดตัว: ขอลดการเคลื่อนไหว = ไม่เล่นเลย', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.dataset.intro ?? null)).toBeNull();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.intro')).display)).toBe('none');
  expect(await page.locator('.hero-liquid').count()).toBe(0);
});

// เบราว์เซอร์ทดสอบแบบ headless วาด WebGL ด้วย CPU (SwiftShader) — จำลองชื่อ GPU เพื่อทดสอบเส้นทางที่เครื่องผู้ใช้จริงใช้
const fakeGpu = () => {
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    const get = C.prototype.getParameter;
    C.prototype.getParameter = function (p) { return p === 0x9246 || p === 0x1F01 ? 'E2E Test GPU' : get.call(this, p); }; // UNMASKED_RENDERER_WEBGL / RENDERER
  }
};

test('พื้นหลังแสงของเหลว: วาดอยู่เมื่อเห็น hero และหยุดเมื่อเลื่อนออกนอกจอ (เครื่องที่มี GPU)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebGL ใน headless ของเบราว์เซอร์อื่นไม่แน่นอน (ฉาก 3D ใช้เกณฑ์เดียวกัน)');
  await page.addInitScript(fakeGpu);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await ready(page);
  const hasGl = await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl')));
  test.skip(!hasGl, 'เครื่องทดสอบไม่มี WebGL');
  const canvas = page.locator('canvas.hero-liquid');
  await expect(canvas).toHaveAttribute('data-running', 'true', { timeout: 15_000 });
  const frames = () => canvas.evaluate((c) => Number(c.dataset.frames) || 0);
  const f1 = await frames();
  await expect.poll(frames).toBeGreaterThan(f1);
  await page.evaluate(() => scrollTo({ top: document.querySelector('#hero').offsetHeight + 400, behavior: 'instant' }));
  await expect(canvas).toHaveAttribute('data-running', 'false');
});

test('พื้นหลังแสงของเหลว: เครื่องที่วาด WebGL ด้วย CPU ไม่โหลด shader (เห็นพื้นหลังนิ่ง)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'ตรวจชื่อ renderer ของ headless Chromium (SwiftShader)');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await ready(page);
  const software = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl ? /swiftshader|llvmpipe|software/i.test(String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER))) : null;
  });
  test.skip(software !== true, 'เครื่องทดสอบนี้วาด WebGL ด้วย GPU');
  await page.waitForTimeout(2500); // เลยช่วง requestIdleCallback ที่จะโหลด shader ถ้าผ่านเงื่อนไข
  expect(await page.locator('canvas.hero-liquid').count()).toBe(0);
  await expect(page.locator('.hero-fallback')).toBeAttached();
});

test('วงล้อเกม 3 มิติ: หมุนตามการเลื่อน, ชื่อใต้วงล้อตรงกับเกมด้านหน้า, Tab แล้วเกมนั้นหมุนมาด้านหน้า, axe ผ่าน', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await ready(page);
  const sec = page.locator('#ringSec');
  await expect(sec).toHaveClass(/is-ring/);
  const items = sec.locator('.ring-item');
  const n = await items.count();
  expect(n).toBeGreaterThanOrEqual(3);
  const front = () => sec.locator('.ring-item.is-front .ring-cap').textContent();
  const scrollTo = (p) => sec.evaluate((s, f) => { const top = s.getBoundingClientRect().top + scrollY; window.scrollTo({ top: top + f * (s.offsetHeight - innerHeight), behavior: 'instant' }); }, p); // html ตั้ง scroll-behavior: smooth

  await scrollTo(0);
  await expect.poll(front).toBe(await items.first().locator('.ring-cap').textContent());
  const first = await sec.locator('.ring').evaluate((r) => r.style.transform);
  await scrollTo(1);
  await expect.poll(front).toBe(await items.last().locator('.ring-cap').textContent());
  expect(await sec.locator('.ring').evaluate((r) => r.style.transform)).not.toBe(first);
  await expect(sec.locator('.ring-name')).toHaveText(await front());
  // ฉากค้างกลางจอระหว่างเลื่อน
  await scrollTo(0.5);
  await expect.poll(() => sec.locator('.ring-sticky').evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(0);

  // คีย์บอร์ด: โฟกัสที่เกมลำดับ 4 → เกมนั้นหมุนมาข้างหน้า
  await items.nth(3).locator('a').focus();
  await expect.poll(front).toBe(await items.nth(3).locator('.ring-cap').textContent());

  const res = await new AxeBuilder({ page }).include('#ringSec').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(serious(res).map((v) => v.id)).toEqual([]);
});

test('วงล้อเกม: ขอลดการเคลื่อนไหว = แถวปัดแนวนอน ไม่ค้างกลางจอและไม่จองความสูงไว้เลื่อน', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await ready(page);
  const sec = page.locator('#ringSec');
  await expect(sec).not.toHaveClass(/is-ring/);
  expect(await sec.evaluate((s) => s.offsetHeight)).toBeLessThan(800);
  expect(await sec.locator('.ring').evaluate((r) => r.scrollWidth > r.clientWidth)).toBe(true);
});

test('วงล้อเกมบนมือถือ: การ์ดด้านหน้าและชื่อเกมอยู่ในจอ ระหว่าง header กับแถบเมนูล่าง', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await ready(page);
  const sec = page.locator('#ringSec');
  await expect(sec).toHaveClass(/is-ring/);
  await sec.evaluate((s) => { const top = s.getBoundingClientRect().top + scrollY; scrollTo({ top: top + 0.4 * (s.offsetHeight - innerHeight), behavior: 'instant' }); });
  const box = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    const tab = document.querySelector('.tabbar');
    return { header: r('.topbar').bottom, front: r('.ring-item.is-front').top, info: r('.ring-price').bottom, tab: tab?.getClientRects().length ? r('.tabbar').top : innerHeight };
  });
  expect(box.front).toBeGreaterThan(box.header);
  expect(box.info).toBeLessThanOrEqual(box.tab);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});
