import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PUBLIC_PAGES } from './pages.js';

test.setTimeout(240_000);

// ตรวจ accessibility ด้วย axe (WCAG 2 A/AA: alt, label, คอนทราสต์สี, ชื่อปุ่ม ฯลฯ) ทุกหน้า × 2 ภาษา × 2 ธีม
const serious = (r) => r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
const fmt = (vs) => vs.map((v) => `${v.id} (${v.impact}):\n${v.nodes.slice(0, 4).map((n) => `   ${n.target.join(' ')} — ${(n.any[0]?.message ?? n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 150)}`).join('\n')}`).join('\n');

for (const lang of ['th', 'en']) {
  for (const theme of ['dark', 'light']) {
    test(`a11y: ${lang} / ${theme}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(([l, t]) => { localStorage.setItem('lang', l); localStorage.setItem('theme', t); }, [lang, theme]);
      for (const [name, url] of PUBLIC_PAGES) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        await page.waitForSelector('body.ready, body:not([data-async])', { state: 'attached' });
        const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        const bad = serious(res);
        if (bad.length) throw new Error(`${name} [${lang}/${theme}]\n${fmt(bad)}`);
        expect(await page.evaluate(() => document.documentElement.lang)).toBe(lang);
      }
    });
  }
}

test('การใช้คีย์บอร์ด: Tab ไปถึงปุ่มสำคัญและเห็นกรอบ focus', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('body.ready', { state: 'attached' });
  const seen = new Set();
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = el ? getComputedStyle(el) : null;
      return el && el !== document.body ? { tag: el.tagName, id: el.id, outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 } : null;
    });
    expect(info, 'ต้องมี element ที่โฟกัสได้').not.toBeNull();
    expect(info.outline, `${info.tag}#${info.id} ไม่มีกรอบ focus ที่มองเห็น`).toBe(true);
    seen.add(`${info.tag}#${info.id}`);
  }
  expect([...seen].some((s) => s.includes('#langBtn') || s.includes('#cartBtn') || s.includes('#search'))).toBe(true);
});

test('ภาษา/ธีม: ไม่มี key แปลหลุดเป็นข้อความดิบ และสลับภาษาได้', async ({ page }) => {
  const RAW = /\b(?:nav|cart|cartpage|order|profile|auth|home|hero|filter|sort|game|reviews|catalog|common|footer|header|checkout|coupon|summary|nf|wish)\.[A-Za-z][A-Za-z.]*\b/;
  for (const lang of ['th', 'en']) {
    await page.addInitScript((l) => localStorage.setItem('lang', l), lang);
    for (const [name, url] of PUBLIC_PAGES) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      const text = await page.evaluate(() => document.body.innerText);
      expect(text.match(RAW)?.[0] ?? null, `${name} [${lang}] มี key แปลหลุด`).toBeNull();
    }
  }
  // หน้าใหม่ (ไม่มี init script ที่บังคับภาษา): เริ่มที่ไทย → กดปุ่มภาษา → เป็นอังกฤษและจำค่าไว้หลังรีโหลด
  const p2 = await page.context().newPage();
  await p2.goto('/');
  await p2.evaluate(() => localStorage.setItem('lang', 'th'));
  await p2.reload();
  await expect(p2.locator('h1').first()).toContainText('เกมแท้');
  await p2.click('#langBtn');
  await expect(p2.locator('h1').first()).toContainText('Genuine games');
  await p2.reload();
  await expect(p2.locator('h1').first()).toContainText('Genuine games');
  expect(await p2.evaluate(() => document.documentElement.lang)).toBe('en');
});
