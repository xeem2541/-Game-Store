import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// UI เฟส 18: ค้นหาเต็มจอ ("/", Ctrl+K, ปุ่มในแถบเมนูมือถือ) + เปลี่ยนหน้าแบบ view transition (การ์ด → หน้าเกม)
const ready = (page) => page.waitForSelector('body.ready', { state: 'attached' });
const serious = async (page) => {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
};

test('ค้นหาเต็มจอ: เปิดด้วย "/", เห็นปกเกมขณะพิมพ์ + ไฮไลต์คำ, ลูกศร/Enter เปิดเกม, จำคำค้นล่าสุด, Esc ปิดแล้วโฟกัสกลับที่เดิม, axe ผ่าน', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/games.html');
  await ready(page);
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('/');
  const dlg = page.locator('dialog.search-dlg');
  await expect(dlg).toBeVisible();
  const input = page.locator('#sdInput');
  await expect(input).toBeFocused();
  // ก่อนพิมพ์: แนวเกม + เกมขายดี
  await expect(dlg.locator('.sd-top-card')).toHaveCount(4);
  expect(await dlg.locator('#sdIdle .sd-chip').count()).toBeGreaterThan(0);
  expect(await serious(page)).toEqual([]);

  await input.pressSequentially('dragon');
  const items = dlg.locator('.sd-item');
  await expect(items.first()).toBeVisible();
  await expect(items.first().locator('img')).toHaveAttribute('src', /cover\.svg/);
  await expect(items.first().locator('mark')).toHaveText(/dragon/i);
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#sdStatus')).not.toBeEmpty();
  expect(await serious(page)).toEqual([]);

  await page.keyboard.press('ArrowDown');
  await expect(items.first()).toHaveAttribute('aria-selected', 'true');
  await expect(input).toHaveAttribute('aria-activedescendant', 'sd-o-0');
  const href = await items.first().getAttribute('data-href');
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => u.pathname === href);

  // คำค้นล่าสุดถูกจำไว้: เปิดอีกครั้งด้วย Ctrl+K เห็นชิป "dragon" กดแล้วค้นซ้ำ
  await ready(page);
  await page.keyboard.press('Control+k');
  await expect(dlg).toBeVisible();
  const recent = dlg.locator('[data-recent="dragon"]');
  await expect(recent).toBeVisible();
  await recent.click();
  await expect(input).toHaveValue('dragon');
  await expect(items.first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(page.locator('html')).not.toHaveClass(/search-open/);

  // ไม่พบ: บอกผู้ใช้ และยังมีแนวเกมให้เลือกต่อ
  await page.keyboard.press('Control+k');
  await input.fill('zzzzqqq');
  await expect(page.locator('#sdStatus')).toContainText('zzzzqqq');
  await expect(dlg.locator('#sdIdle')).toBeVisible();
  await page.keyboard.press('Enter'); // Enter โดยไม่เลือกรายการ = ไปหน้าผลค้นหาทั้งหมด
  await page.waitForURL(/\/games\.html\?q=zzzzqqq$/);
});

test('ค้นหาเต็มจอบนมือถือ: ปุ่มค้นหาในแถบเมนูเปิดแบบเต็มจอ, กดผลลัพธ์ไปหน้าเกม; พิมพ์ "/" ในช่องค้นหาของ header ไม่เปิด', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await ready(page);
  await page.locator('#tabSearch').click();
  const dlg = page.locator('dialog.search-dlg');
  await expect(dlg).toBeVisible();
  await dlg.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished))); // ขนาดหลังแอนิเมชันเปิด (ย่อ 98%) จบ
  const box = await dlg.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(374);
  expect(box.height).toBeGreaterThanOrEqual(811);
  await page.locator('#sdInput').fill('farm');
  await dlg.locator('.sd-item').first().click();
  await page.waitForURL(/\/game\//);

  await ready(page);
  await page.locator('#search').fill('a/b');
  await expect(page.locator('#search')).toHaveValue('a/b');
  await expect(dlg).toHaveCount(0);
});

test('เปลี่ยนหน้า: กดการ์ดเกมแล้วเกิด view transition (เบราว์เซอร์ที่รองรับ) และหน้าเกมแสดงภาพปกตั้งแต่ก่อนข้อมูลมา; ขอลดการเคลื่อนไหว = ไม่มี transition', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // หน้าเกมก่อน JS ทำงาน: skeleton มีภาพปกจริงของเกม (ปลายทางของภาพที่ขยายมา)
  const raw = await (await page.request.get('/game/dragon-realm')).text();
  expect(raw).toContain('class="detail-cover sk-hero-cover" src="/api/games/dragon-realm/cover.svg"');

  await page.goto('/games.html');
  await ready(page);
  const supported = await page.evaluate(() => 'onpagereveal' in window && CSS.supports('view-transition-name: a'));
  const card = page.locator('#grid .card').first();
  const slug = (await card.locator('a.cover').getAttribute('href')).split('/').pop();
  await card.locator('a.cover').click();
  await page.waitForURL(`**/game/${slug}`);
  await expect(page.locator('#gameTitle')).toBeVisible();
  if (supported) expect(await page.evaluate(() => window.__revealTransition !== null && window.__revealTransition !== undefined)).toBe(true);

  const ctx = await browser.newContext({ reducedMotion: 'reduce', baseURL: test.info().project.use.baseURL });
  const p2 = await ctx.newPage();
  await p2.goto('/games.html');
  await ready(p2);
  await p2.locator('#grid .card a.cover').first().click();
  await p2.waitForURL('**/game/**');
  await expect(p2.locator('#gameTitle')).toBeVisible();
  expect(await p2.evaluate(() => window.__revealTransition ?? null)).toBeNull();
  await ctx.close();
});
