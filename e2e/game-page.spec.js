import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { db } from './helpers.mjs';

// หน้าเกม (UI เฟส 14): กล่องเกม 3 มิติ, ชื่อเกม kinetic, ภาพในเกมแบบเล่าเรื่อง + ดูภาพเต็ม, แถบซื้อลอย, สถานะ "อยู่ในตะกร้าแล้ว"
// ฐานข้อมูล e2e ไม่มีภาพตัวอย่าง → ใส่ 3 ภาพให้เกมหนึ่งเกมก่อน (ไฟล์จริงในโฟลเดอร์อัปโหลดของเซิร์ฟเวอร์ทดสอบ)
const SLUG = 'sky-kingdoms';
const uploads = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp', 'uploads', 'games');

test.beforeAll(async () => {
  const d = db();
  const g = d.prepare('SELECT id FROM games WHERE slug = ?').get(SLUG);
  if (!d.prepare("SELECT 1 FROM game_images WHERE game_id = ? AND kind = 'screenshot'").get(g.id)) {
    fs.mkdirSync(uploads, { recursive: true });
    for (const [i, color] of ['#c0392b', '#2980b9', '#27ae60'].entries()) {
      const file = `e2e-shot-${i}.webp`;
      await sharp({ create: { width: 640, height: 360, channels: 3, background: color } }).webp().toFile(path.join(uploads, file));
      d.prepare("INSERT INTO game_images (game_id, filename, kind, position) VALUES (?, ?, 'screenshot', ?)").run(g.id, file, i + 1);
    }
  }
  d.close();
});

const open = async (page) => {
  await page.goto(`/game/${SLUG}`);
  await page.waitForSelector('body.ready', { state: 'attached' });
};
// เลื่อนแล้วส่ง scroll event เอง (WebKit แบบไม่มีหน้าจอไม่ส่ง scroll event หลังสคริปต์เลื่อนหน้า — ดู a11y.spec.js)
const scrollToEl = (page, sel) => page.locator(sel).evaluate((el) => {
  window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - innerHeight / 2 + el.offsetHeight / 2, behavior: 'instant' });
  dispatchEvent(new Event('scroll'));
});

test('hero: กล่องเกม 3 มิติ, ชื่อเกมอ่านครบสำหรับ screen reader, ป้ายแนวเกม/แพลตฟอร์มเป็นลิงก์กรอง', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await expect(page.locator('#gameBox .box-front')).toBeVisible();
  await expect(page.locator('#gameBox .box-spine')).toHaveCount(1);
  expect(await page.locator('#gameBox').evaluate((el) => getComputedStyle(el).transformStyle)).toBe('preserve-3d');
  await expect(page.locator('#gameTitle')).toHaveClass(/kt-in/);
  await expect(page.locator('#gameTitle .sr-only')).toHaveText('Sky Kingdoms');
  await expect(page.locator('#gameTitle .kt')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.meta-chips a').first()).toHaveAttribute('href', /\/games\.html\?genre=/);
});

test('เล่าเรื่องด้วยภาพในเกม (desktop): ภาพใหญ่เปลี่ยนตามบทที่เลื่อนถึง + ดูภาพเต็ม (ลูกศร/Esc/คืนโฟกัส) + axe', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await expect(page.locator('.shot-step')).toHaveCount(3);
  for (const [i, label] of [[1, '02'], [2, '03'], [0, '01']]) {
    await expect(async () => {
      await scrollToEl(page, `.shot-step[data-i="${i}"]`);
      await expect(page.locator('.stage-img').nth(i)).toHaveClass(/is-active/, { timeout: 1000 });
    }).toPass({ timeout: 10000 });
    await expect(page.locator('#shotNow')).toHaveText(label);
  }

  const opener = page.locator('.shot-open').first();
  await opener.click();
  const dlg = page.locator('dialog.lightbox');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('figcaption')).toHaveText(/1/);
  await page.keyboard.press('ArrowRight');
  await expect(dlg.locator('figcaption')).toHaveText(/2/);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft'); // วนไปภาพสุดท้าย
  await expect(dlg.locator('figcaption')).toHaveText(/3/);
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(opener).toBeFocused();
});

test('แถบซื้อลอย: โผล่เมื่อปุ่มซื้อใน hero พ้นจอ, กดซื้อแล้วทั้งสองปุ่มเป็น "อยู่ในตะกร้าแล้ว" และพาไปหน้าตะกร้า', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  const bar = page.locator('#stickyCta');
  await expect(bar).not.toHaveClass(/is-shown/);
  await expect(bar).toHaveAttribute('aria-hidden', 'true');
  await expect(async () => {
    await scrollToEl(page, '#reviews');
    await expect(bar).toHaveClass(/is-shown/, { timeout: 1000 });
  }).toPass({ timeout: 10000 });
  await expect(bar).toHaveAttribute('aria-hidden', 'false');
  await page.locator('#stickyAddBtn').click();
  await expect(page.locator('#cartCount')).toHaveText('1');
  await expect(page.locator('#stickyAddBtn')).toHaveClass(/in-cart/);
  await expect(page.locator('#addBtn')).toHaveClass(/in-cart/);
  await page.locator('#stickyAddBtn').click();
  await expect(page).toHaveURL(/\/cart$/);
});

test('มือถือ: ภาพในเกมเป็นแถวปัดแนวนอน ไม่มีภาพใหญ่ติดจอ และทั้งหน้าไม่เลื่อนแนวนอน', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  await expect(page.locator('.shots-stage')).toBeHidden();
  const list = page.locator('.shots-steps');
  expect(await list.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
  expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('ขอลดการเคลื่อนไหว: กล่องไม่ลอย ชื่อเกมไม่แยกคำ (แสดงทันที) แต่ยังใช้งานได้ครบ', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  expect(await page.locator('.box-float').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await expect(page.locator('#gameTitle')).not.toHaveClass(/kt-in/);
  await expect(page.locator('#gameTitle')).toHaveText('Sky Kingdoms');
  await page.locator('.shot-open').first().click();
  await expect(page.locator('dialog.lightbox')).toBeVisible();
});
