import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// UI เฟส 26: เคอร์เซอร์วงแสง, สีพื้นหลังตามเกม, แถวการ์ดเอียงตามความเร็วการเลื่อน, หน้าเกมเต็มจอ (โลกของเกม), เปิดหน้าเกมแบบวงกลม
const ready = (page) => page.waitForSelector('body.ready', { state: 'attached' });
const serious = (r) => r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
const finePointer = (page) => page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches);
const toRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };

test('เคอร์เซอร์วงแสง: ตามเมาส์, ขยายบนลิงก์, ขึ้น "ดู" บนการ์ดเกม และไม่บังการคลิก', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/games.html');
  await ready(page);
  test.skip(!(await finePointer(page)), 'เบราว์เซอร์นี้ไม่รายงานว่ามีเมาส์');
  const card = page.locator('#grid .card').first();
  await card.evaluate((c) => c.scrollIntoView({ block: 'center', behavior: 'instant' })); // ทั้งการ์ด (รวมปุ่มด้านล่าง) อยู่ในจอ
  const cover = await card.locator('.cover').boundingBox();
  await page.mouse.move(cover.x + cover.width / 2, cover.y + cover.height / 2, { steps: 4 });
  const cur = page.locator('.cursor');
  await expect(cur).toHaveClass(/\bon\b/);
  await expect(cur).toHaveAttribute('data-state', 'game');
  await expect(cur.locator('.cursor-label')).not.toBeEmpty();
  expect(await cur.evaluate((c) => getComputedStyle(c).pointerEvents)).toBe('none');
  const add = await card.locator('[data-add]').boundingBox();
  await page.mouse.move(add.x + add.width / 2, add.y + add.height / 2, { steps: 4 });
  await expect(cur).toHaveAttribute('data-state', 'link');
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-add]') !== null, [add.x + add.width / 2, add.y + add.height / 2])).toBe(true);
});

test('เคอร์เซอร์วงแสงและการเอียง: ไม่มีบนจอสัมผัสและเมื่อขอลดการเคลื่อนไหว', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'จำลองจอสัมผัส (isMobile) ได้แน่นอนบน Chromium');
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const tp = await touch.newPage();
  await tp.goto('/games.html');
  await ready(tp);
  expect(await tp.locator('.cursor').count()).toBe(0);
  await touch.close();
  const reduced = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const rp = await reduced.newPage();
  await rp.goto('/games.html');
  await ready(rp);
  await rp.mouse.move(400, 400);
  await rp.mouse.wheel(0, 600);
  await rp.waitForTimeout(200);
  expect(await rp.locator('.cursor').count()).toBe(0);
  expect(await rp.locator('#grid').evaluate((g) => g.style.transform)).toBe('');
  await reduced.close();
});

test('สีพื้นหลังตามเกม: ชี้การ์ดแล้วทั้งหน้าเป็นสีของเกมนั้น, เลิกชี้แล้วกลับ; โฟกัสด้วยคีย์บอร์ดก็เปลี่ยน', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' }); // ไม่มี transition → อ่านสีได้ทันที (และยืนยันว่าทำงานแม้ขอลดการเคลื่อนไหว)
  await page.goto('/games.html');
  await ready(page);
  const cards = page.locator('#grid .card');
  const c1 = await cards.nth(1).getAttribute('data-c1');
  expect(c1).toMatch(/^#[0-9a-f]{6}$/i);
  const ambient = page.locator('.ambient');
  await cards.nth(1).hover();
  await expect(ambient).toHaveClass(/\bon\b/);
  expect(await ambient.evaluate((a) => getComputedStyle(a).color)).toBe(toRgb(c1));
  await page.mouse.move(5, 5);
  await expect(ambient).not.toHaveClass(/\bon\b/);
  const c2 = await cards.nth(2).getAttribute('data-c1');
  await cards.nth(2).locator('a.title').focus();
  await expect.poll(() => ambient.evaluate((a) => getComputedStyle(a).color)).toBe(toRgb(c2));
});

test('แถวการ์ดเอียงตามความเร็วการเลื่อน (ไม่เกิน 3°) แล้วกลับตรงเมื่อหยุด', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/games.html');
  await ready(page);
  test.skip(!(await finePointer(page)), 'เฉพาะอุปกรณ์ที่มีเมาส์');
  await page.mouse.move(640, 500);
  const seen = [];
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(30);
    seen.push(await page.locator('#grid').evaluate((g) => g.style.transform));
  }
  const angles = seen.map((s) => Number(/skewY\((-?[\d.]+)deg\)/.exec(s)?.[1] ?? 0));
  expect(angles.some((a) => Math.abs(a) > 0.1), seen.join(' | ')).toBe(true);
  expect(angles.every((a) => Math.abs(a) <= 3)).toBe(true);
  await expect.poll(() => page.locator('#grid').evaluate((g) => g.style.transform), { timeout: 5000 }).toBe('');
});

test('หน้าเกมเต็มจอ: โลกของเกมอยู่หลังเนื้อหา สีทั้งหน้าเป็นสีของเกม จางเมื่อเลื่อนลง ไม่บังปุ่มซื้อ และ axe ผ่าน', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/game/dragon-realm');
  await ready(page);
  const world = page.locator('#gameWorld');
  await expect(world).toHaveClass(/ready/);
  const info = await world.evaluate((w) => ({ pos: getComputedStyle(w).position, z: getComputedStyle(w).zIndex, pe: getComputedStyle(w).pointerEvents, far: getComputedStyle(w.querySelector('.gw-far')).backgroundImage }));
  expect(info).toMatchObject({ pos: 'fixed', z: '-1', pe: 'none' });
  expect(info.far).toContain('/api/games/dragon-realm/scene.svg');
  await expect(page.locator('.ambient')).toHaveClass(/\bon\b/); // โทนสีของเกมทั้งหน้า
  const btn = await page.locator('#addBtn').boundingBox();
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [btn.x + btn.width / 2, btn.y + btn.height / 2])).toBe('addBtn');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  // รอเนื้อหา hero ปรากฏเต็ม (ชื่อเกมลอยขึ้นทีละคำ) ก่อนตรวจคอนทราสต์
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('#gameTitle .kt-word')].every((el) => getComputedStyle(el).opacity === '1'))).toBe(true);
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(serious(res).map((v) => v.id), serious(res).map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`).join('\n')).toEqual([]);
  await page.evaluate(() => scrollTo({ top: innerHeight * 1.2, behavior: 'instant' }));
  await expect(world).toHaveClass(/is-past/);
});

test('เปิดหน้าเกมจากการ์ด: หน้าใหม่ขยายเป็นวงกลมจากจุดที่กด (เบราว์เซอร์ที่รองรับ view transition ข้ามหน้า)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    window.addEventListener('pagereveal', (e) => {
      // ลงทะเบียนก่อน theme-init.js → อ่านค่าใน task ถัดไป (หลัง handler ของ theme-init ทำงานแล้ว)
      setTimeout(() => { window.__vt = { has: Boolean(e.viewTransition), mode: document.documentElement.dataset.vt ?? null, x: document.documentElement.style.getPropertyValue('--vt-x') }; }, 0);
    });
  });
  await page.goto('/games.html');
  await ready(page);
  const card = page.locator('#grid .card').first();
  const box = await card.locator('a.title').boundingBox();
  await card.locator('a.title').click();
  await page.waitForURL(/\/game\//);
  const vt = await page.evaluate(() => window.__vt);
  test.skip(!vt?.has, 'เบราว์เซอร์นี้ไม่มี view transition ข้ามหน้า');
  expect(vt.mode).toBe('circle');
  expect(Number(vt.x.replace('%', ''))).toBeCloseTo(((box.x + box.width / 2) / 1280) * 100, -1);
  expect(await page.evaluate(() => sessionStorage.getItem('vtOrigin'))).toBeNull(); // ใช้แล้วลบทันที
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.vt ?? null)).toBeNull(); // จบแล้วเอาออก
});
