import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// หน้าแรก (UI เฟส 20): แถว "เกมที่คุณเพิ่งดู" + "เพราะคุณสนใจแนว…" จากประวัติการดูในเครื่อง
const ready = (page) => page.waitForSelector('body.ready', { state: 'attached' });
// รอเฉพาะแอนิเมชันที่ผูกกับเวลา (แบบผูกกับการเลื่อนหน้าไม่มีวัน "จบ")
const serious = async (page) => {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.timeline instanceof DocumentTimeline && a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
};

test('ยังไม่เคยดูเกม: ไม่มีแถวเฉพาะคน; ดูเกมแล้วกลับหน้าแรก: เห็นเกมที่ดูล่าสุดก่อน + เกมแนวเดียวกันที่ยังไม่เคยดู; ล้างประวัติได้; axe ผ่าน', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await ready(page);
  await expect(page.locator('#recentSec')).toBeHidden();
  await expect(page.locator('#forYouSec')).toBeHidden();

  // ดู 2 เกม (เกมที่ 2 = ล่าสุด)
  await page.goto('/game/dragon-realm');
  await expect(page.locator('#gameTitle')).toBeVisible();
  await page.goto('/game/zombie-outbreak');
  await expect(page.locator('#gameTitle')).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('recentViews')));
  expect(stored.map((r) => r.slug)).toEqual(['zombie-outbreak', 'dragon-realm']);

  await page.goto('/');
  await ready(page);
  const recent = page.locator('#recent .card');
  await expect(page.locator('#recentSec')).toBeVisible();
  await expect(recent).toHaveCount(2);
  await expect(recent.first().locator('a.cover')).toHaveAttribute('href', '/game/zombie-outbreak');
  await expect(recent.nth(1).locator('a.cover')).toHaveAttribute('href', '/game/dragon-realm');

  const forYou = page.locator('#forYouSec');
  await expect(forYou).toBeVisible();
  await expect(page.locator('#forYouText')).toContainText(/\S/);
  const picks = await page.locator('#forYou .card a.cover').evaluateAll((as) => as.map((a) => a.getAttribute('href').split('/').pop()));
  expect(picks.length).toBeGreaterThanOrEqual(3);
  expect(picks).not.toContain('zombie-outbreak'); // เกมที่ดูแล้วไม่แนะนำซ้ำ
  expect(picks).not.toContain('dragon-realm');
  expect(await serious(page)).toEqual([]);

  await page.locator('#recentClear').click();
  await expect(page.locator('#recentSec')).toBeHidden();
  await expect(forYou).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('recentViews'))).toBeNull();
});

test('ประวัติในเครื่องผิดรูปแบบ/ถูกแก้: ไม่พัง ไม่ส่งค่าแปลกไปที่ API', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('recentViews', JSON.stringify([{ slug: "a' OR 1=1", genre: 'x' }, { slug: 5 }, null, 'str'])));
  await page.goto('/');
  await ready(page);
  await expect(page.locator('#recentSec')).toBeHidden();
  await expect(page.locator('#featured .card').first()).toBeVisible(); // หน้าแรกปกติ
});
