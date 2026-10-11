import { test } from '@playwright/test';

// รายการหน้าที่ใช้ตรวจ responsive / a11y / ภาษา+ธีม
export const PUBLIC_PAGES = [
  ['home', '/'], ['games', '/games.html'], ['game', '/game/dragon-realm'], ['login', '/login'], ['register', '/register'],
  ['forgot', '/forgot'], ['cart', '/cart'], ['privacy', '/privacy'], ['terms', '/terms'], ['refund', '/refund-policy'], ['notfound', '/no-such-page'],
];
export const VIEWPORTS = [[375, 812], [768, 1024], [1280, 800]];

// เปิดทุกหน้าในรายการ โดยใช้ browser context ใหม่ต่อหน้าแล้วปิดทิ้ง: แต่ละหน้าเริ่มจากสถานะสะอาด และหน่วยความจำถูกคืนทุกหน้า
// (เคยมีปัญหา WebKit บน CI หน่วยความจำเต็มจาก backdrop-filter บนหัวใจของทุกการ์ด — แก้ที่ CSS แล้ว ดู layout.css)
// context ที่สร้างเองไม่ได้รับค่า use ของโปรเจกต์ (baseURL, ขนาดจอ, user agent) จึงคัดลอกมาเอง
const CONTEXT_KEYS = ['baseURL', 'viewport', 'screen', 'userAgent', 'deviceScaleFactor', 'isMobile', 'hasTouch', 'locale', 'colorScheme'];
export async function eachPage(browser, { setup, label } = {}, fn) {
  const use = test.info().project.use;
  const options = Object.fromEntries(CONTEXT_KEYS.filter((k) => use[k] !== undefined).map((k) => [k, use[k]]));
  for (const [name, url] of PUBLIC_PAGES) {
    if (label) console.log(`[trace] ${new Date().toISOString().slice(11, 19)} ${label} → ${name}`);
    const context = await browser.newContext(options);
    try {
      const page = await context.newPage();
      await setup?.(page);
      await page.goto(url);
      await fn(page, name);
    } finally {
      await context.close();
    }
  }
}
