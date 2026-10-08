import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { registerAndVerify, setRole } from './helpers.mjs';
import { PUBLIC_PAGES, VIEWPORTS } from './pages.js';

test.setTimeout(240_000);
const shotDir = (project) => { const d = path.join('e2e', 'screenshots', project); fs.mkdirSync(d, { recursive: true }); return d; };
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const settle = async (page) => { await page.waitForLoadState('networkidle'); await page.waitForSelector('body.ready, body:not([data-async])', { state: 'attached' }); };

test.describe('responsive (375 / 768 / 1280)', () => {
  for (const [w, h] of VIEWPORTS) {
    test(`ร้านค้าที่ ${w}px: ไม่มีแถบเลื่อนแนวนอน + จับภาพหน้าจอ`, async ({ page }, info) => {
      await page.setViewportSize({ width: w, height: h });
      for (const [name, url] of PUBLIC_PAGES) {
        await page.goto(url);
        await settle(page);
        expect(await noOverflow(page), `${name} @${w}px มีแถบเลื่อนแนวนอน`).toBe(true);
        await page.screenshot({ path: path.join(shotDir(info.project.name), `${name}-${w}.png`), fullPage: name !== 'games' });
      }
    });

    test(`หลังบ้านและหน้าลูกค้าหลังล็อกอินที่ ${w}px`, async ({ page, browser }, info) => {
      await page.setViewportSize({ width: w, height: h });
      const u = await registerAndVerify(page);
      for (const [name, url] of [['profile', '/profile'], ['profile-orders', '/profile#orders']]) {
        await page.goto(url);
        await settle(page);
        expect(await noOverflow(page), `${name} @${w}px`).toBe(true);
        await page.screenshot({ path: path.join(shotDir(info.project.name), `${name}-${w}.png`), fullPage: true });
      }
      setRole(u.email, 'admin');
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const ap = await ctx.newPage();
      await ap.goto('/admin/login');
      await ap.fill('input[name=email]', u.email);
      await ap.fill('input[name=password]', u.password);
      await ap.click('button[type=submit]');
      await ap.waitForURL('**/admin/');
      for (const route of ['dashboard', 'games', 'games/1', 'stock', 'orders', 'users', 'coupons', 'reviews', 'reports', 'audit']) {
        await ap.goto(`/admin/#/${route}`);
        await ap.waitForLoadState('networkidle');
        await ap.waitForTimeout(700);
        expect(await noOverflow(ap), `admin/${route} @${w}px มีแถบเลื่อนแนวนอน`).toBe(true);
        await ap.screenshot({ path: path.join(shotDir(info.project.name), `admin-${route.replace('/', '-')}-${w}.png`), fullPage: true });
      }
      await ctx.close();
    });
  }
});
