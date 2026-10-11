import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { eachPage } from './pages.js';

test.setTimeout(240_000);

// ตรวจ accessibility ด้วย axe (WCAG 2 A/AA: alt, label, คอนทราสต์สี, ชื่อปุ่ม ฯลฯ) ทุกหน้า × 2 ภาษา (ธีมมืดอย่างเดียว)
const serious = (r) => r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
const fmt = (vs) => vs.map((v) => `${v.id} (${v.impact}):\n${v.nodes.slice(0, 4).map((n) => `   ${n.target.join(' ')} — ${(n.any[0]?.message ?? n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 150)}`).join('\n')}`).join('\n');

for (const lang of ['th', 'en']) {
  test(`a11y: ${lang}`, async ({ context }) => {
    const setup = async (page) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((l) => { localStorage.setItem('lang', l); }, lang);
    };
    await eachPage(context, { setup, label: `a11y ${lang}` }, async (page, name) => {
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('body.ready, body:not([data-async])', { state: 'attached' });
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const bad = serious(res);
      if (bad.length) throw new Error(`${name} [${lang}]\n${fmt(bad)}`);
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(lang);
    });
  });
}

test('การใช้คีย์บอร์ด: Tab ไปถึงปุ่มสำคัญและเห็นกรอบ focus', async ({ page, browserName }) => {
  // Safari/WebKit: Tab ข้ามลิงก์โดยค่าตั้งต้น ผู้ใช้คีย์บอร์ดบน Safari ใช้ Option+Tab เพื่อไปทุกจุด
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.goto('/');
  await page.waitForSelector('body.ready', { state: 'attached' });
  const seen = new Set();
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press(tab);
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

test('ภาษา/ธีม: ไม่มี key แปลหลุดเป็นข้อความดิบ และสลับภาษาได้', async ({ page, context }) => {
  const RAW = /\b(?:nav|cart|cartpage|order|profile|auth|home|hero|filter|sort|game|reviews|catalog|common|footer|header|checkout|coupon|summary|nf|wish)\.[A-Za-z][A-Za-z.]*\b/;
  for (const lang of ['th', 'en']) {
    const setup = (p) => p.addInitScript((l) => localStorage.setItem('lang', l), lang);
    await eachPage(context, { setup, label: `i18n ${lang}` }, async (p, name) => {
      await p.waitForLoadState('networkidle');
      const text = await p.evaluate(() => document.body.innerText);
      expect(text.match(RAW)?.[0] ?? null, `${name} [${lang}] มี key แปลหลุด`).toBeNull();
    });
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

test('Kinetic typography: screen reader อ่านหัวข้อเต็มประโยค และคำไทยไม่ถูกตัดกลางคำ', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('lang', 'th'); });
  await page.goto('/');
  await page.waitForSelector('body.ready', { state: 'attached' });
  await expect(page.getByRole('heading', { level: 1, name: 'เกมแท้ ราคาโดนใจ', exact: true })).toBeVisible();
  const words = await page.locator('#heroTitle .kt-word').allTextContents();
  expect(words.length).toBeGreaterThan(1);
  expect(words.join('')).toBe('เกมแท้ราคาโดนใจ');
  // คำต้องไม่ขึ้นต้นด้วยสระบน/ล่าง/วรรณยุกต์ (แปลว่าถูกตัดกลางพยางค์)
  for (const w of words) expect(w, `ตัดคำผิด: "${w}"`).not.toMatch(/^[ัิ-ฺ็-๎]/);
  await expect(page.locator('#heroTitle .kt')).toHaveAttribute('aria-hidden', 'true');
});

test('ซื้อยังไง 3 ขั้น: ภาพประกอบเปลี่ยนตามขั้นที่เลื่อนถึง (desktop) และทำงานเมื่อขอลดการเคลื่อนไหว', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  // บันทึกไว้ช่วยวิเคราะห์เมื่อเทสต์ล้ม: จำนวน scroll event ที่หน้าได้รับ และประวัติค่า data-step ของภาพประกอบ
  await page.addInitScript(() => {
    window.__scrolls = 0;
    window.__steps = [];
    addEventListener('scroll', () => { window.__scrolls += 1; }, { passive: true });
    new MutationObserver((ms) => { for (const m of ms) window.__steps.push(m.target.dataset.step); })
      .observe(document, { subtree: true, attributes: true, attributeFilter: ['data-step'] });
  });
  await page.goto('/');
  await page.waitForSelector('body.ready', { state: 'attached' });
  const visual = page.locator('.howto-visual');
  for (const n of ['1', '2', '3']) {
    // เลื่อนซ้ำจนกว่าจะตรง: รายการเกมด้านบนอาจโหลดเสร็จทีหลังแล้วดันตำแหน่งลง (Safari ไม่ยึดตำแหน่งการเลื่อนไว้)
    await expect(async () => {
      await page.locator(`.howto-step[data-step="${n}"]`).evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - innerHeight / 2 + el.offsetHeight / 2, behavior: 'instant' }));
      // WebKit แบบ headless ไม่ส่ง scroll event หลังสคริปต์เลื่อนหน้า (บันทึกจาก CI: scrollY เลื่อนถึงแล้ว แต่หน้าได้ scroll event
      // ครั้งเดียวทั้งเทสต์ แม้บังคับวาดหน้าใหม่) — ส่ง scroll event เองหลังเลื่อน เบราว์เซอร์จริงส่งให้ทุกครั้งที่เลื่อนอยู่แล้ว
      // สิ่งที่ทดสอบยังเหมือนเดิม: หน้าเลือกขั้นจากตำแหน่งจริงบนจอเมื่อได้ scroll event
      await page.evaluate(() => dispatchEvent(new Event('scroll')));
      const state = await page.evaluate(() => JSON.stringify({ y: scrollY, scrolls: window.__scrolls, history: window.__steps,
        steps: [...document.querySelectorAll('.howto-step')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; }) }));
      await expect(visual, `ขั้น ${n}: ${state}`).toHaveAttribute('data-step', n, { timeout: 1000 });
    }).toPass({ timeout: 10000 });
    await expect(page.locator(`.howto-step[data-step="${n}"]`)).toHaveClass(/is-active/);
  }
  await expect(page.getByRole('link', { name: 'เริ่มเลือกเกม' })).toBeVisible();
});
