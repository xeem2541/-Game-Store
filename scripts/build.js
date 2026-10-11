// npm run build — สร้างโฟลเดอร์ dist/ สำหรับ production (ไม่ต้องย้ายเป็น framework):
//  • bundle + minify JS/CSS ด้วย esbuild (แชร์ chunk ระหว่างหน้า, รองรับ top-level await)
//  • ใส่ hash ของเนื้อหาในชื่อไฟล์ (home-3FA9C2D1.js) → แคชได้ 1 ปีและเปลี่ยนเมื่อแก้ไฟล์เท่านั้น
//  • เขียนอ้างอิงในไฟล์ HTML ใหม่ให้ชี้ไปไฟล์ที่มี hash
//  • บีบอัดล่วงหน้า (.br / .gz) ให้เซิร์ฟเวอร์ส่งได้ทันที
import { build } from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const hash8 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, 'X');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
const map = new Map(); // URL เดิม → URL ที่มี hash (ใช้เขียน HTML ใหม่)

// ---------- ร้านค้า (public/) ----------
const pubJs = ['home', 'catalog', 'game', 'auth-pages', 'profile', 'cart-page', 'checkout', 'order', 'notfound'];
// เวอร์ชันของไฟล์แปล (ถูกฝังเข้าโค้ดเพื่อ cache-bust เมื่อไฟล์แปลเปลี่ยน)
const i18nVersion = hash8(Buffer.concat(['th', 'en'].map((l) => fs.readFileSync(path.join(ROOT, `public/i18n/${l}.json`)))));

async function bundleJs(entries, outdir, urlBase, define = {}) {
  const r = await build({
    entryPoints: entries.map((e) => path.join(ROOT, e)), outdir, bundle: true, splitting: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'none',
    entryNames: '[name]-[hash]', chunkNames: 'chunks/[name]-[hash]', metafile: true, define, logLevel: 'warning',
  });
  for (const [out, info] of Object.entries(r.metafile.outputs)) {
    if (info.entryPoint) map.set(info.entryPoint.startsWith('public/') ? `/${info.entryPoint.slice('public/'.length)}` : `/${info.entryPoint}`, `${urlBase}${path.basename(out)}`);
  }
  return r.metafile;
}

const pubMeta = await bundleJs(pubJs.map((n) => `public/js/${n}.js`), path.join(DIST, 'public/js'), '/js/', { __I18N_VERSION__: JSON.stringify(i18nVersion) });

// ---------- งบขนาด JS ต่อหน้า (gzip) ----------
// นับเฉพาะ JS ที่หน้าโหลดทันที (entry + chunk ที่ import แบบ static) — chunk ที่โหลดด้วย import() เช่นฉาก 3D ไม่นับ
const JS_BUDGET_GZ = 150 * 1024;
const gz = (file) => zlib.gzipSync(fs.readFileSync(path.join(ROOT, file)), { level: 9 }).length;
const initialJs = (out, seen = new Set()) => {
  if (seen.has(out)) return seen;
  seen.add(out);
  for (const imp of pubMeta.outputs[out].imports) if (imp.kind === 'import-statement') initialJs(imp.path, seen);
  return seen;
};
const lazyJs = Object.keys(pubMeta.outputs).filter((o) => o.endsWith('.js') && Object.values(pubMeta.outputs).some((x) => x.imports.some((i) => i.path === o && i.kind === 'dynamic-import')));
const overBudget = [];
console.log('JS ต่อหน้า (gzip, โหลดทันที):');
for (const [out, info] of Object.entries(pubMeta.outputs)) {
  if (!info.entryPoint || lazyJs.includes(out)) continue;
  const size = [...initialJs(out)].reduce((s, f) => s + gz(f), 0);
  console.log(`  ${path.basename(info.entryPoint, '.js').padEnd(12)} ${(size / 1024).toFixed(1).padStart(6)} KB`);
  if (size > JS_BUDGET_GZ) overBudget.push(info.entryPoint);
}
for (const f of lazyJs) console.log(`  (lazy) ${path.basename(f).padEnd(24)} ${(gz(f) / 1024).toFixed(1).padStart(6)} KB`);
if (overBudget.length) {
  console.error(`✘ เกินงบ JS ${JS_BUDGET_GZ / 1024} KB gzip: ${overBudget.join(', ')} — ย้ายโค้ดหนักไปโหลดแบบ import() หรือลดขนาด`);
  process.exit(1);
}

// theme-init.js ต้องรันแบบ sync ใน <head> (ไม่ใช่ module) → bundle แยกเป็น iife
const themeOut = await build({ entryPoints: [path.join(ROOT, 'public/js/theme-init.js')], outdir: path.join(DIST, 'public/js'), bundle: true, format: 'iife', minify: true, entryNames: '[name]-[hash]', metafile: true, logLevel: 'warning' });
for (const out of Object.keys(themeOut.metafile.outputs)) map.set('/js/theme-init.js', `/js/${path.basename(out)}`);

const cssOut = await build({ entryPoints: [path.join(ROOT, 'public/style.css')], outdir: path.join(DIST, 'public/css'), bundle: true, minify: true, entryNames: '[name]-[hash]', metafile: true, logLevel: 'warning', external: ['/fonts/*'] });
for (const out of Object.keys(cssOut.metafile.outputs)) map.set('/style.css', `/css/${path.basename(out)}`);

// ---------- แอดมิน (admin/) : แยกโฟลเดอร์ เสิร์ฟเฉพาะผู้ล็อกอินแอดมิน ----------
await bundleJs(['admin/js/main.js'], path.join(DIST, 'admin/js'), '/admin/js/');
const adminLogin = await build({ entryPoints: [path.join(ROOT, 'admin/login.js')], outdir: path.join(DIST, 'admin'), bundle: true, format: 'iife', minify: true, entryNames: '[name]-[hash]', metafile: true, logLevel: 'warning' });
for (const out of Object.keys(adminLogin.metafile.outputs)) map.set('/admin/login.js', `/admin/${path.basename(out)}`);
// admin.css import token ของหน้าร้านด้วย URL '/css/tokens.css' (ตอนพัฒนาเบราว์เซอร์โหลดจาก public/ ตรง ๆ) → ตอน build ชี้ไปไฟล์ใน public/
const publicCss = { name: 'public-css', setup(b) { b.onResolve({ filter: /^\/css\// }, (a) => ({ path: path.join(ROOT, 'public', a.path) })); } };
const adminCss = await build({ entryPoints: [path.join(ROOT, 'admin/admin.css')], outdir: path.join(DIST, 'admin'), bundle: true, minify: true, entryNames: '[name]-[hash]', metafile: true, logLevel: 'warning', external: ['/fonts/*'], plugins: [publicCss] });
for (const out of Object.keys(adminCss.metafile.outputs)) map.set('/admin/admin.css', `/admin/${path.basename(out)}`);
// Chart.js: ใช้ไฟล์ minified ที่โฮสต์เอง (ไม่โหลดจาก CDN)
const chart = fs.readFileSync(path.join(ROOT, 'node_modules/chart.js/dist/chart.umd.min.js'));
const chartName = `chart-${hash8(chart)}.js`;
fs.mkdirSync(path.join(DIST, 'admin/vendor'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'admin/vendor', chartName), chart);
map.set('/admin/vendor/chart.umd.js', `/admin/vendor/${chartName}`);

// ---------- HTML / JSON / อื่นๆ ----------
const htmlCopy = (srcDir, dstDir) => {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const f of fs.readdirSync(srcDir).filter((n) => n.endsWith('.html'))) {
    let h = fs.readFileSync(path.join(srcDir, f), 'utf8');
    h = h.replace(/(["'])\/admin\/(admin\.css|login\.js)\1/g, (m, q, n) => `${q}${map.get('/admin/' + n)}${q}`);
    h = h.replace(/(["'])\/admin\/vendor\/chart\.umd\.js\1/g, (m, q) => `${q}${map.get('/admin/vendor/chart.umd.js')}${q}`);
    h = h.replace(/(["'])\/admin\/js\/main\.js\1/g, (m, q) => `${q}${map.get('/admin/js/main.js')}${q}`);
    h = h.replace(/(["'])\/(style\.css|js\/[\w-]+\.js)\1/g, (m, q, u) => (map.has('/' + u) ? `${q}${map.get('/' + u)}${q}` : m));
    fs.writeFileSync(path.join(dstDir, f), h);
  }
};
htmlCopy(path.join(ROOT, 'public'), path.join(DIST, 'public'));
htmlCopy(path.join(ROOT, 'admin'), path.join(DIST, 'admin'));

// ไฟล์แปล: minify JSON
fs.mkdirSync(path.join(DIST, 'public/i18n'), { recursive: true });
for (const l of ['th', 'en']) fs.writeFileSync(path.join(DIST, `public/i18n/${l}.json`), JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, `public/i18n/${l}.json`), 'utf8'))));

// คัดลอก Fonts และ Icons
if (fs.existsSync(path.join(ROOT, 'public/fonts'))) {
  fs.mkdirSync(path.join(DIST, 'public/fonts'), { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'public/fonts'))) {
    fs.copyFileSync(path.join(ROOT, 'public/fonts', f), path.join(DIST, 'public/fonts', f));
  }
}
// ไอคอนเว็บ + ภาพประกอบ (ไฟล์คงที่ ไม่ต้อง hash)
for (const f of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png']) {
  if (fs.existsSync(path.join(ROOT, 'public', f))) fs.copyFileSync(path.join(ROOT, 'public', f), path.join(DIST, 'public', f));
}
if (fs.existsSync(path.join(ROOT, 'public/img'))) fs.cpSync(path.join(ROOT, 'public/img'), path.join(DIST, 'public/img'), { recursive: true });
if (fs.existsSync(path.join(ROOT, 'public/icons.svg'))) {
  fs.copyFileSync(path.join(ROOT, 'public/icons.svg'), path.join(DIST, 'public/icons.svg'));
}

// ---------- บีบอัดล่วงหน้า ----------
let files = 0; let raw = 0; let br = 0;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(DIST)) {
  if (!/\.(js|css|json|html|svg|xml|txt)$/.test(f)) continue;
  const buf = fs.readFileSync(f);
  const b = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
  fs.writeFileSync(`${f}.br`, b);
  fs.writeFileSync(`${f}.gz`, zlib.gzipSync(buf, { level: 9 }));
  files += 1; raw += buf.length; br += b.length;
}
fs.writeFileSync(path.join(DIST, 'build-manifest.json'), JSON.stringify({ builtAt: new Date().toISOString(), i18nVersion, assets: Object.fromEntries(map) }, null, 2));
console.log(`✓ build เสร็จ: ${files} ไฟล์ (ขนาดรวม ${(raw / 1024).toFixed(0)} KB → brotli ${(br / 1024).toFixed(0)} KB) → ${rel(DIST)}/`);
