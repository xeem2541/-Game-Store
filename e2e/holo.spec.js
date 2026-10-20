import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// UI เฟส 27: การ์ดโฮโลแกรม + ความลึกในการ์ด, ขอบเรืองแสงหมุน, พรีวิวภาพในเกมบนการ์ด, ตัวอักษรถอดรหัส
const ready = (page) => page.waitForSelector('body.ready', { state: 'attached' });
const serious = (r) => r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
const finePointer = (page) => page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches);

test('การ์ดโฮโลแกรม: เฉพาะเกมลด 30% ขึ้นไป, ฟอยล์อยู่บนภาพปกไม่รับคลิก, ชี้แล้วฟอยล์เข้มขึ้นและชื่อเกมลอยตามมุม, axe ผ่าน', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/games.html');
  await ready(page);
  const cards = await page.locator('#grid .card').evaluateAll((els) => els.map((c) => ({
    holo: c.classList.contains('holo'), foil: Boolean(c.querySelector('.cover .holo-foil[aria-hidden="true"]')),
    off: Number(c.querySelector('.badge')?.textContent.replace(/\D/g, '') || 0),
  })));
  expect(cards.some((c) => c.holo)).toBe(true);
  for (const c of cards) { expect(c.holo).toBe(c.off >= 30); expect(c.foil).toBe(c.holo); }

  const holo = page.locator('#grid .card.holo').first();
  await holo.evaluate((c) => c.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const foil = holo.locator('.holo-foil');
  expect(await foil.evaluate((f) => getComputedStyle(f).pointerEvents)).toBe('none');
  if (await finePointer(page)) {
    const box = await holo.boundingBox();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2, { steps: 4 });
    await expect.poll(() => foil.evaluate((f) => Number(getComputedStyle(f).opacity))).toBeGreaterThan(0.4);
    await expect.poll(() => holo.locator('.title').evaluate((t) => getComputedStyle(t).translate)).not.toMatch(/^(none|0px)$/);
  }
  const add = await holo.locator('[data-add]').boundingBox();
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-add]') !== null, [add.x + add.width / 2, add.y + add.height / 2])).toBe(true);
  const res = await new AxeBuilder({ page }).include('#grid').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(serious(res).map((v) => v.id)).toEqual([]);
});

test('ขอบเรืองแสงหมุน: ปุ่มหลักขนาดใหญ่และช่องดีลแรงสุดหมุน, ขอลดการเคลื่อนไหว = นิ่ง', async ({ browser }) => {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion });
    const page = await ctx.newPage();
    await page.goto('/');
    await ready(page);
    const anim = (sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).animationName);
    const expected = reducedMotion === 'reduce' ? 'none' : 'glow-spin';
    expect(await anim('.hero-actions .btn.primary.big')).toBe(expected);
    expect(await anim('.tile-deal')).toBe(expected);
    await ctx.close();
  }
});

test('พรีวิวภาพในเกม: ชี้ค้างที่ปก → ภาพในเกมเปลี่ยนทีละภาพพร้อมแถบ, เลิกชี้ → กลับเป็นปก; เกมที่ไม่มีภาพไม่มีพรีวิว', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // เซิร์ฟเวอร์ทดสอบไม่มีภาพในเกม → ให้ API ตอบภาพฉากของเกมอื่น (ไฟล์มีจริง) ยกเว้นเกม "no-shots"
  let noShots = '';
  await page.route(/\/api\/games\/[a-z0-9-]+$/, async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.images = json.slug === noShots ? [] : ['/api/games/neon-racer-2077/scene.svg', '/api/games/zombie-outbreak/scene.svg', '/api/games/cozy-farm-life/scene.svg'];
    await route.fulfill({ response: res, json });
  });
  await page.goto('/games.html');
  await ready(page);
  test.skip(!(await finePointer(page)), 'เฉพาะอุปกรณ์ที่มีเมาส์');
  const card = page.locator('#grid .card').first();
  await card.evaluate((c) => c.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const cover = await card.locator('.cover').boundingBox();
  await page.mouse.move(cover.x + cover.width / 2, cover.y + cover.height / 2, { steps: 3 });
  const preview = card.locator('.cover-preview');
  await expect(preview).toHaveAttribute('aria-hidden', 'true');
  await expect(preview.locator('img')).toHaveCount(3);
  await expect(preview.locator('.cover-preview-bar i')).toHaveCount(3);
  const shown = () => preview.locator('img').evaluateAll((imgs) => imgs.findIndex((i) => i.classList.contains('on')));
  expect(await shown()).toBe(0);
  await expect.poll(shown, { timeout: 4000 }).toBe(1); // เปลี่ยนภาพเอง
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('a.cover') !== null, [cover.x + cover.width / 2, cover.y + cover.height / 2])).toBe(true); // ยังกดเข้าหน้าเกมได้
  await page.mouse.move(5, 5);
  await expect(preview).toHaveCount(0);

  const other = page.locator('#grid .card').nth(1);
  noShots = await other.getAttribute('data-slug');
  const ob = await other.locator('.cover').boundingBox();
  await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2, { steps: 3 });
  await page.waitForTimeout(1200);
  await expect(other.locator('.cover-preview')).toHaveCount(0);
});

test('ตัวอักษรถอดรหัส: หัวข้อขึ้นเป็นตัวสุ่มแล้วจบที่ข้อความจริง, ระหว่างนั้น screen reader ได้ชื่อหัวข้อเต็ม; ขอลดการเคลื่อนไหว = ไม่เปลี่ยน', async ({ browser }) => {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion });
    const page = await ctx.newPage();
    await page.goto('/');
    await ready(page);
    const span = page.locator('#bestsellers').locator('xpath=..').locator('h2.sec > span').first();
    const real = await span.textContent();
    await span.evaluate((el) => {
      window.__sc = [];
      new MutationObserver(() => window.__sc.push([el.textContent, el.closest('h2').getAttribute('aria-label')])).observe(el, { childList: true, subtree: true, characterData: true });
    });
    await span.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(1300);
    // เครื่อง CI ที่ช้า (WebKit) เฟรมแอนิเมชันมาช้า — รอจนจบจริงแทนการกำหนดเวลาตายตัว
    await expect.poll(() => span.textContent(), { timeout: 8000 }).toBe(real);
    await expect.poll(() => span.evaluate((el) => el.closest('h2').hasAttribute('aria-label'))).toBe(false); // คืนค่าเดิมหลังจบ
    const seen = await page.evaluate(() => window.__sc);
    if (reducedMotion === 'reduce') {
      expect(seen).toEqual([]);
    } else {
      const mid = seen.filter(([t]) => t !== real);
      expect(mid.length).toBeGreaterThan(0);
      for (const [, label] of mid) expect(label).toContain(real.trim()); // ระหว่างถอดรหัส ชื่อหัวข้อสำหรับ screen reader เป็นข้อความจริง
    }
    await ctx.close();
  }
});
