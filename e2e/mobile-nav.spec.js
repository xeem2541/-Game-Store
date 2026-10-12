import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { registerAndVerify } from './helpers.mjs';

// มือถือ (UI เฟส 17): แถบเมนูล่างจอ + กองปกเกมแนะนำใน hero หน้าแรก
const ready = (page) => page.waitForSelector('body.ready', { state: 'attached' });
const serious = async (page) => {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
};

test('แถบเมนูล่างจอ: 5 ปุ่ม, บอกหน้าปัจจุบัน, ปุ่มซ้ำใน header ซ่อน, ค้นหาโฟกัสช่องค้นหาและแถบหลบคีย์บอร์ด; จอกว้างไม่มีแถบ', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await ready(page);
  const bar = page.locator('nav.tabbar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.tab')).toHaveCount(5);
  await expect(bar.locator('[aria-current="page"]')).toHaveAttribute('data-nav', 'home');
  await expect(page.locator('#cartBtn')).toBeHidden();
  await expect(page.locator('.topbar .actions > .btn.login')).toBeHidden();
  const box = await bar.boundingBox();
  expect(Math.round(box.y + box.height)).toBe(812);

  await page.locator('#tabSearch').click();
  await expect(page.locator('#search')).toBeFocused();
  await expect(bar).toBeHidden(); // คีย์บอร์ดเปิด → แถบซ่อน
  await page.locator('#search').blur();
  await expect(bar).toBeVisible();

  await bar.locator('[data-nav="games"]').click();
  await expect(page).toHaveURL(/\/games\.html$/);
  await expect(page.locator('nav.tabbar [aria-current="page"]')).toHaveAttribute('data-nav', 'games');
  expect(await serious(page)).toEqual([]);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('nav.tabbar')).toBeHidden();
  await expect(page.locator('#cartBtn')).toBeVisible();
});

test('แถบเมนูล่างจอ: ตัวเลขตะกร้าอัปเดต, แถบซื้อลอยของหน้าเกมอยู่เหนือแถบเมนู, หน้ายืนยันสั่งซื้อไม่มีแถบ, ออกจากระบบจากหน้าบัญชี', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await registerAndVerify(page);
  await page.goto('/game/dragon-realm');
  await ready(page);
  const badge = page.locator('#tabCartCount');
  await expect(badge).toBeEmpty();
  await page.click('#addBtn');
  await expect(badge).toHaveText('1');

  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  const cta = page.locator('.sticky-cta');
  await expect(cta).toHaveClass(/is-shown/);
  await expect.poll(async () => {
    const [c, b] = [await cta.boundingBox(), await page.locator('nav.tabbar').boundingBox()];
    return Math.round(c.y + c.height - b.y);
  }).toBeLessThanOrEqual(1);

  await page.locator('nav.tabbar [data-nav="cart"]').click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.locator('nav.tabbar [aria-current="page"]')).toHaveAttribute('data-nav', 'cart');
  await page.goto('/checkout');
  await page.waitForSelector('#placeBtn');
  await expect(page.locator('nav.tabbar')).toHaveCount(0);

  await page.goto('/profile');
  await expect(page.locator('nav.tabbar [aria-current="page"]')).toHaveAttribute('data-nav', 'account');
  await page.click('#profileLogout');
  await page.waitForURL((u) => u.pathname === '/');
  await expect(page.locator('nav.tabbar [data-nav="account"]')).toHaveAttribute('href', '/login');
});

test('กองปกเกมใน hero (มือถือ): การ์ดแรกอยู่กลางจอ, ปัดแล้วจุดบอกตำแหน่งเปลี่ยน, การ์ดข้างเอียง 3D, axe ผ่าน; จอกว้างไม่แสดง', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await ready(page);
  const cards = page.locator('#deckTrack .deck-card:not(.sk)');
  const n = await cards.count();
  expect(n).toBeGreaterThan(1);
  await expect(page.locator('#deckDots span')).toHaveCount(n);
  // ระยะจากกึ่งกลางการ์ดถึงกึ่งกลางแถว ตามตำแหน่ง layout (ไม่นับการเอียง 3D ที่แต่ละเบราว์เซอร์คำนวณกรอบต่างกันเล็กน้อย)
  const offCenter = (i) => page.locator('#deckTrack').evaluate((t, j) => {
    const c = t.children[j];
    return Math.abs(c.offsetLeft - t.scrollLeft + c.offsetWidth / 2 - t.clientWidth / 2);
  }, i);
  expect(await offCenter(0)).toBeLessThan(2);
  await expect(page.locator('#deckDots span').first()).toHaveClass(/on/);

  await page.locator('#deckTrack').evaluate((el) => el.scrollTo({ left: el.children[1].offsetLeft - (el.clientWidth - el.children[1].offsetWidth) / 2 }));
  await expect(page.locator('#deckDots span').nth(1)).toHaveClass(/on/);
  await expect.poll(() => offCenter(1)).toBeLessThan(2);
  // เบราว์เซอร์ที่รองรับ scroll-driven animation: การ์ดข้าง ๆ หมุน (การ์ดกลางตรง)
  const supported = await page.evaluate(() => CSS.supports('animation-timeline: view()'));
  if (supported) {
    // ค่า scaleX (ตัวแรกของ matrix): การ์ดกลาง ≈ 1, การ์ดข้างที่หมุนและย่อ < 0.95
    const sx = (i) => cards.nth(i).evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    expect(await sx(0)).toBeLessThan(0.95);
    expect(await sx(1)).toBeGreaterThan(0.99);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(cards.first()).toHaveAttribute('href', /^\/game\//);
  expect(await serious(page)).toEqual([]);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#heroDeck')).toBeHidden();
});

test('ขอลดการเคลื่อนไหว: การ์ดใน hero ไม่เอียง/ไม่มีแอนิเมชัน', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await ready(page);
  const first = page.locator('#deckTrack .deck-card:not(.sk)').nth(1);
  await expect(first).toBeVisible();
  expect(await first.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  expect(await first.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
});
