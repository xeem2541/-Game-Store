// วัดหน่วยความจำของ WebKit ต่อหน้า (ใช้ชั่วคราวบน CI): runner ของ WebKit หน่วยความจำเต็มตั้งแต่เฟส 13–14
// เปิดแต่ละหน้าใน context ใหม่ รอ 4 วินาที แล้ววัด RSS รวมของโปรเซส WPE* และ load — ทำซ้ำโดยปิดเอฟเฟกต์ทีละแบบเพื่อหาตัวการ
// รัน: node scripts/build.js && node e2e/memprobe.mjs   (เริ่มเซิร์ฟเวอร์ e2e เอง)
import { spawn, execSync } from 'node:child_process';
import { webkit } from '@playwright/test';

const BASE = 'http://localhost:3199';
const server = spawn(process.execPath, ['e2e/server.mjs'], { stdio: 'ignore' });
for (let i = 0; i < 60; i += 1) {
  try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch { /* ยังไม่พร้อม */ }
  await new Promise((r) => setTimeout(r, 500));
}

const wpe = () => {
  const rows = execSync('ps -eo rss,comm').toString().split('\n').filter((l) => /WPE|WebKit/.test(l));
  const mb = rows.reduce((s, l) => s + parseInt(l, 10) / 1024, 0);
  return `${Math.round(mb)}MB/${rows.length}p load=${execSync('cut -d" " -f1 /proc/loadavg').toString().trim()}`;
};
const PAGES = [['home', '/'], ['games', '/games.html'], ['game', '/game/dragon-realm'], ['login', '/login']];
const VARIANTS = {
  base: '',
  noFilter: '*,*::before,*::after,*::backdrop{filter:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
  noMask: '*{mask-image:none!important;-webkit-mask-image:none!important}',
  flat3d: '*{transform-style:flat!important}',
  noAnim: '*,*::before,*::after{animation:none!important;transition:none!important}',
  noBgLayers: '.game-backdrop,.game-glow,.hero-canvas,canvas{display:none!important}',
};

const browser = await webkit.launch();
console.log(`[probe] start ${wpe()}`);
for (const [variant, css] of Object.entries(VARIANTS)) {
  for (const [name, url] of PAGES) {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 720 }, bypassCSP: true });
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(url, { timeout: 30_000 }).catch((e) => console.log(`[probe] goto ${e.message.split('\n')[0]}`));
    if (css) await page.addStyleTag({ content: css }).catch(() => {});
    await page.waitForTimeout(4000);
    const open = wpe();
    await ctx.close();
    await new Promise((r) => setTimeout(r, 1500));
    console.log(`[probe] ${variant.padEnd(10)} ${name.padEnd(6)} load ${Date.now() - t0}ms  open=${open}  closed=${wpe()}`);
  }
}
await browser.close();
server.kill('SIGTERM');
