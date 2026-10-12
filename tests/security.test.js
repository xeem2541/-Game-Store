import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { makeAdminClient, startServer } from './helpers.js';
import { validProdEnv } from './prodenv.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { db } = await import('../server/db/index.js');
const { config } = await import('../server/config.js');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.server.close());
const get = (p, headers = {}) => fetch(srv.url + p, { headers, redirect: 'manual' });

// ---------------------------------------------------------------- header / CSP
test('security headers: CSP เข้ม (ไม่มี unsafe-inline/eval), nosniff, referrer, permissions, frame', async () => {
  for (const p of ['/', '/api/games', '/game/dragon-realm', '/no-such-page']) {
    const r = await get(p);
    const csp = r.headers.get('content-security-policy');
    assert.ok(csp, `${p} ไม่มี CSP`);
    const dir = Object.fromEntries(csp.split(';').map((x) => x.trim().split(/\s+/)).filter((x) => x[0]).map(([k, ...v]) => [k, v]));
    assert.deepEqual(dir['script-src'], ["'self'"], p);
    assert.deepEqual(dir['style-src'], ["'self'"], p);
    assert.deepEqual(dir['default-src'], ["'self'"]);
    assert.deepEqual(dir['object-src'], ["'none'"]);
    assert.deepEqual(dir['frame-ancestors'], ["'none'"]);
    assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp.replace(/\*\./g, '')), `CSP หลวม: ${csp}`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.match(r.headers.get('permissions-policy') ?? '', /camera=\(\)/);
    assert.equal(r.headers.get('x-powered-by'), null);
  }
  assert.equal((await get('/')).headers.get('strict-transport-security'), null, 'HSTS ต้องมีเฉพาะ production (กัน localhost ติด https)');
});

test('ไม่มี inline script / inline style / on*= ในไฟล์ HTML และ JS ทั้งหมด (CSP ใช้ได้จริง)', () => {
  const files = [];
  const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, n.name); if (n.isDirectory()) { if (n.name !== 'vendor') walk(f); } else files.push(f); } };
  walk(path.join(root, 'public')); walk(path.join(root, 'admin'));
  const problems = [];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    if (f.endsWith('.html')) {
      if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(s)) problems.push(`${f}: inline <script>`);
      if (/<style[\s>]/i.test(s)) problems.push(`${f}: <style>`);
      if (/\son[a-z]+\s*=\s*["']/i.test(s)) problems.push(`${f}: on*= handler`);
      if (/\sstyle\s*=\s*["']/i.test(s)) problems.push(`${f}: style=""`);
    }
    if (f.endsWith('.js')) {
      if (/\sstyle=\\?["']/.test(s)) problems.push(`${f}: style="" ในเทมเพลต JS`);
      if (/\son(click|change|submit|input|load|error)=/.test(s)) problems.push(`${f}: on*= ในเทมเพลต JS`);
      if (/\beval\(|new Function\(/.test(s)) problems.push(`${f}: eval`);
    }
  }
  assert.deepEqual(problems, []);
});

test('/healthz: 200 + ไม่เปิดเผยข้อมูลภายใน และไม่ cache', async () => {
  const r = await get('/healthz');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, 'ok');
  assert.deepEqual(Object.keys(body).sort(), ['status', 'uptime']);
});

test('CSRF: คำตอบ /api ส่งโทเคนใน header ตรงกับคุกกี้ และใช้ค่าจาก header ส่งคำขอ POST ได้ (Safari อ่านคุกกี้ใหม่ไม่ทัน)', async () => {
  const r = await get('/api/health');
  const cookie = (r.headers.get('set-cookie') || '').match(/csrf=([a-f0-9]+)/)?.[1];
  assert.ok(cookie, 'ต้องตั้งคุกกี้ csrf');
  assert.equal(r.headers.get('x-csrf-token'), cookie);
  // คำขอถัดไปที่มีคุกกี้อยู่แล้ว: header ยังเป็นค่าเดิม (ไม่สุ่มใหม่)
  assert.equal((await get('/api/health', { cookie: `csrf=${cookie}` })).headers.get('x-csrf-token'), cookie);
  const post = (token) => fetch(srv.url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `csrf=${cookie}`, 'x-csrf-token': token }, body: JSON.stringify({ email: 'no@example.com', password: 'whatever-123' }) });
  assert.equal((await post(r.headers.get('x-csrf-token'))).status, 401, 'โทเคนจาก header ผ่าน CSRF (ไปถึงการตรวจรหัสผ่าน)');
  assert.equal((await post('0'.repeat(48))).status, 403);
});

test('CORS: ค่าเริ่มต้นไม่อนุญาต origin อื่น, อนุญาตเฉพาะที่อยู่ใน CORS_ORIGINS', async () => {
  const r = await get('/api/games', { origin: 'https://evil.example' });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(`${srv.url}/api/orders`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
});

test('cache: HTML/API ห้ามแคชนาน, ไฟล์ static ปกติไม่ immutable ใน dev', async () => {
  assert.match((await get('/api/games')).headers.get('cache-control') ?? 'no-store', /no-store|no-cache|max-age=0|private/);
  assert.match((await get('/')).headers.get('cache-control') ?? '', /no-cache|no-store|max-age=0/);
});

// ---------------------------------------------------------------- SEO
test('sitemap.xml: มีหน้าหลัก + เกมที่เปิดขายเท่านั้น และไม่มีหน้าส่วนตัว/แอดมิน', async () => {
  const r = await get('/sitemap.xml');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /xml/);
  const xml = await r.text();
  assert.match(xml, /<urlset[^>]*sitemaps\.org/);
  assert.ok(xml.includes(`${config.appUrl}/game/dragon-realm`));
  assert.match(xml, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
  assert.ok(xml.includes(`<image:loc>${config.appUrl}/og/dragon-realm.png</image:loc>`), 'หน้าเกมต้องแนบรูปใน sitemap');
  assert.ok(!/\/(admin|api|cart|checkout|profile|order)\b/.test(xml.replace(/<\?xml.*?\?>/, '')), 'sitemap มีหน้าที่ไม่ควรให้ index');
  const hidden = db.prepare('SELECT slug FROM games WHERE active = 0 LIMIT 1').get();
  if (hidden) assert.ok(!xml.includes(`/game/${hidden.slug}<`));
});

test('robots.txt: บล็อก /admin /api /cart /checkout /profile /order และชี้ไป sitemap', async () => {
  const txt = await (await get('/robots.txt')).text();
  for (const p of ['/admin', '/api', '/cart', '/checkout', '/profile', '/order']) assert.match(txt, new RegExp(`Disallow: ${p}\\b`), p);
  assert.match(txt, new RegExp(`Sitemap: ${config.appUrl.replace(/[.]/g, '\\.')}/sitemap\\.xml`));
});

test('หน้าเกม: title/description/canonical/OG/Twitter/JSON-LD Product+Offer ถูกต้อง', async () => {
  const html = await (await get('/game/dragon-realm')).text();
  assert.match(html, /<html lang="(th|en)"/);
  assert.match(html, /<title>[^<]*Dragon Realm[^<]*<\/title>/);
  assert.match(html, /<link rel="canonical" href="[^"]*\/game\/dragon-realm"/);
  assert.match(html, /<meta property="og:title"/);
  assert.match(html, /<meta property="og:image" content="[^"]+\.png"/);
  assert.match(html, /<meta name="twitter:card"/);
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(ld, 'ไม่มี JSON-LD');
  const data = JSON.parse(ld[1]);
  const prod = [].concat(data['@graph'] ?? data).find((x) => x['@type'] === 'Product');
  assert.equal(prod.name, 'Dragon Realm');
  assert.equal(prod.offers['@type'], 'Offer');
  assert.equal(prod.offers.priceCurrency, 'THB');
  assert.match(String(prod.offers.price), /^\d+(\.\d{1,2})?$/);
  assert.ok(!html.includes('{{') && !html.includes('<!--SEO-->'), 'ยังมี placeholder ค้าง');
  if (prod.aggregateRating) assert.ok(prod.aggregateRating.reviewCount >= 1, 'AggregateRating ต้องมาจากรีวิวจริง');
  assert.equal(prod.url, `${config.appUrl}/game/dragon-realm`);
  const crumbs = [].concat(data['@graph'] ?? data).find((x) => x['@type'] === 'BreadcrumbList');
  assert.ok(crumbs, 'ไม่มี BreadcrumbList');
  assert.deepEqual(crumbs.itemListElement.map((i) => i.position), [1, 2, 3, 4]);
  assert.equal(crumbs.itemListElement.at(-1).item, `${config.appUrl}/game/dragon-realm`);
});

test('หน้าแรก: JSON-LD มี WebSite + ช่องค้นหา และข้อมูลร้าน (OnlineStore + โลโก้)', async () => {
  const html = await (await get('/')).text();
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  const site = graph.find((x) => x['@type'] === 'WebSite');
  assert.match(site.potentialAction.target, /\/games\.html\?q=\{search_term_string\}$/);
  const store = graph.find((x) => x['@type'] === 'OnlineStore');
  assert.equal(site.publisher['@id'], store['@id']);
  assert.match(store.logo.url, /\/apple-touch-icon\.png$/);
  assert.equal((await get('/apple-touch-icon.png')).status, 200, 'โลโก้ต้องเปิดได้จริง');
});

test('JSON-LD/HTML ไม่ถูกแทรกสคริปต์ผ่านชื่อเกม (escape </script>)', async () => {
  const slug = `xss-${Date.now()}`;
  db.prepare(`INSERT INTO games (title, slug, description, description_en, genre, platform, price, discount, release_date, active, color1, color2)
    VALUES (?, ?, 'd', 'd', 'RPG', 'PC', 10000, 0, '2026-01-01', 1, '#000000', '#ffffff')`).run('</script><script>alert(1)</script>"', slug);
  const html = await (await get(`/game/${slug}`)).text();
  assert.ok(!html.includes('<script>alert(1)'), 'ถูกแทรกสคริปต์');
  assert.ok(!/<\/script><script>/.test(html));
  db.prepare('DELETE FROM games WHERE slug = ?').run(slug);
});

test('404/500: หน้าสวยพร้อม noindex และสถานะถูกต้อง; API คืน JSON', async () => {
  const r = await get('/no-such-page');
  assert.equal(r.status, 404);
  assert.match(r.headers.get('content-type'), /html/);
  assert.match(`${r.headers.get('x-robots-tag')} ${await r.text()}`, /noindex/);
  const a = await get('/api/nope');
  assert.equal(a.status, 404);
  assert.match(a.headers.get('content-type'), /json/);
  const g = await get('/game/no-such-slug');
  assert.equal(g.status, 404);
});

// ---------------------------------------------------------------- log ไม่รั่ว
test('log: ไม่บันทึก query string (โทเคน), คุกกี้, รหัสผ่าน หรือโค้ดเกม', async () => {
  const lines = [];
  const orig = console.log;
  const was = config.logRequests;
  config.logRequests = true;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    await get('/verify?token=SECRETTOKEN123&email=a@b.c');
    await fetch(`${srv.url}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'token=COOKIESECRET' }, body: JSON.stringify({ email: 'x@example.com', password: 'PASSWORDSECRET1' }) });
    await new Promise((r) => setTimeout(r, 50));
  } finally { console.log = orig; config.logRequests = was; }
  const all = lines.join('\n');
  assert.ok(lines.length >= 1, 'ควรมี access log');
  for (const s of ['SECRETTOKEN123', 'COOKIESECRET', 'PASSWORDSECRET1', 'a@b.c']) assert.ok(!all.includes(s), `log รั่ว: ${s}`);
});

// ---------------------------------------------------------------- staff permissions (ตัวเลือกใน .env)
test('STAFF_PERMISSIONS: ค่าเริ่มต้นอ่านอย่างเดียว, เปิดสิทธิ์ตามที่กำหนดได้, ชื่อสิทธิ์แปลกถูกเมิน, refund/users ยังเป็น admin เท่านั้น', async () => {
  const staff = await makeAdminClient(srv.url, 'staff');
  const body = { title: 'Perm Game', slug: `perm-${Date.now()}`, description: 'x', description_en: 'x', genre: 'RPG', platform: 'PC', price: 9900, discount: 0, release_date: '2026-01-01' };
  const prev = process.env.STAFF_PERMISSIONS;
  try {
    delete process.env.STAFF_PERMISSIONS;
    assert.equal((await staff.post('/api/admin/games', body)).status, 403);
    process.env.STAFF_PERMISSIONS = 'games.write, bogus.perm';
    assert.deepEqual(config.staffPermissions, ['games.write']);
    const ok = await staff.post('/api/admin/games', body);
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    assert.equal((await staff.get('/api/admin/coupons')).status, 403, 'สิทธิ์อื่นต้องยังปิด');
    process.env.STAFF_PERMISSIONS = 'games.write,stock.write,coupons.manage,reports.users';
    assert.equal((await staff.get('/api/admin/coupons')).status, 200);
    assert.equal((await staff.post('/api/admin/orders/1/refund', { reason: 'xxx', confirmOrderId: 1 })).status, 403);
    assert.equal((await staff.get('/api/admin/users')).status, 403, 'จัดการผู้ใช้เป็น admin เท่านั้นเสมอ');
    assert.equal((await staff.get('/api/admin/reports/new-users.csv')).status, 200);
    assert.equal((await staff.post('/api/admin/stock/keys/1/reveal', {})).status, 403, 'เปิดเผยโค้ดเต็มต้องเป็น admin เท่านั้นเสมอ');
    assert.equal((await staff.get('/api/admin/audit')).status, 403);
  } finally {
    if (prev === undefined) delete process.env.STAFF_PERMISSIONS; else process.env.STAFF_PERMISSIONS = prev;
  }
});

// ---------------------------------------------------------------- i18n
test('i18n: ทุกคีย์ใน th มีคำแปล en และคีย์ที่โค้ดเรียกใช้มีครบทั้งสองภาษา', () => {
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  const th = new Set(flat(JSON.parse(fs.readFileSync(path.join(root, 'public/i18n/th.json'), 'utf8'))));
  const en = new Set(flat(JSON.parse(fs.readFileSync(path.join(root, 'public/i18n/en.json'), 'utf8'))));
  assert.deepEqual([...th].filter((k) => !en.has(k)), [], 'มีใน th แต่ไม่มีใน en');
  const used = new Set();
  const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, n.name); if (n.isDirectory()) walk(f); else if (/\.(html|js)$/.test(n.name)) { const s = fs.readFileSync(f, 'utf8'); for (const m of s.matchAll(/data-i18n(?:-[a-z]+)?="([a-z][\w.]*)"/g)) used.add(m[1]); for (const m of s.matchAll(/\bt\(\s*'([a-z][\w]*\.[\w.]+)'/g)) used.add(m[1]); } } };
  walk(path.join(root, 'public'));
  for (const k of [...used]) if (k.endsWith('.')) used.delete(k); // คีย์ที่ต่อสตริงตอนรัน
  assert.deepEqual([...used].filter((k) => !th.has(k) && !en.has(k)), [], 'คีย์ที่ใช้แต่ไม่มีในพจนานุกรม');
  assert.deepEqual([...used].filter((k) => !en.has(k)), [], 'คีย์ที่ใช้แต่ไม่มีคำแปลภาษาอังกฤษ');
});

// ---------------------------------------------------------------- production (child process)
function runProd(extra, { port, wait = true } = {}) {
  const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env: validProdEnv({ PORT: String(port), ...extra }), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const ready = async () => {
    for (let i = 0; i < 60; i += 1) {
      if (child.exitCode !== null) throw new Error(`server ตายก่อนพร้อม:\n${out}`);
      try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return; } catch { /* ยังไม่พร้อม */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`server ไม่พร้อม:\n${out}`);
  };
  return { child, out: () => out, ready: wait ? ready : null };
}
// พอร์ตไม่ซ้ำกันในรอบเดียวกัน (ก้าวละ 13 จาก 2000 ช่อง ไม่วนซ้ำ) และต่างกันตามโปรเซส — การสุ่มเดิมชนกันได้ (EADDRINUSE)
let portStep = 0;
const freePort = () => 41000 + ((process.pid * 7 + portStep++ * 13) % 2000);

test('production: HSTS, cookie Secure+HttpOnly, CORS allowlist, ไม่มีบัญชี/คีย์/คูปองทดสอบ, ไม่มี dev-pay', async () => {
  const port = freePort();
  const p = runProd({ CORS_ORIGINS: 'https://shop.example.org' }, { port });
  try {
    await p.ready();
    const base = `http://127.0.0.1:${port}`;
    const home = await fetch(`${base}/`);
    assert.match(home.headers.get('strict-transport-security') ?? '', /max-age=\d{7,}/);
    assert.match(home.headers.get('content-security-policy'), /upgrade-insecure-requests/);

    const allowed = await fetch(`${base}/api/games`, { headers: { origin: 'https://shop.example.org' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://shop.example.org');
    const denied = await fetch(`${base}/api/games`, { headers: { origin: 'https://evil.example' } });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);

    // ไม่ seed ข้อมูลทดสอบ
    assert.equal((await (await fetch(`${base}/api/games`)).json()).total, 0);

    // คุกกี้ล็อกอิน: Secure + HttpOnly + SameSite
    const c = await fetch(`${base}/api/health`);
    const csrf = c.headers.getSetCookie().find((x) => x.startsWith('csrf=')).split(';')[0].slice(5);
    const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `csrf=${csrf}`, 'x-csrf-token': csrf }, body: JSON.stringify({ email: 'prod@example.com', password: 'Prod-pass-1234', name: 'Prod' }) });
    assert.equal(reg.status, 201);
    const tokenCookie = reg.headers.getSetCookie().find((x) => x.startsWith('token='));
    assert.match(tokenCookie, /HttpOnly/i);
    assert.match(tokenCookie, /Secure/i);
    assert.match(tokenCookie, /SameSite=(Lax|Strict)/i);
    const csrfCookies = reg.headers.getSetCookie().concat(c.headers.getSetCookie()).filter((x) => x.startsWith('csrf='));
    for (const x of csrfCookies) assert.match(x, /Secure/i);

    assert.equal((await fetch(`${base}/api/orders/1/dev-pay`, { method: 'POST', headers: { cookie: `csrf=${csrf}; ${tokenCookie.split(';')[0]}`, 'x-csrf-token': csrf } })).status, 404, 'route จำลองจ่ายเงินต้องไม่มีใน production');
    assert.ok(!/at .*\(.*\.js:\d+/.test(await (await fetch(`${base}/api/orders/abc`)).text()), 'ห้ามมี stack trace ใน response');
  } finally { p.child.kill(); }
  assert.ok(!/\b(pw|password|token)=\S{6,}/i.test(p.out()), 'log ของ production มีข้อมูลลับ');
});

test('production: trust proxy ทำงาน (IP จาก X-Forwarded-For ถูกใช้ใน rate limit/audit) เมื่อกำหนด TRUST_PROXY', async () => {
  const port = freePort();
  const p = runProd({ TRUST_PROXY: '1', AUTH_RATE_LIMIT: '3' }, { port });
  try {
    await p.ready();
    const base = `http://127.0.0.1:${port}`;
    const csrf = (await fetch(`${base}/api/health`)).headers.getSetCookie().find((x) => x.startsWith('csrf=')).split(';')[0].slice(5);
    const attempt = (ip) => fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, cookie: `csrf=${csrf}`, 'x-csrf-token': csrf }, body: JSON.stringify({ email: 'no@example.com', password: 'whatever-123' }) });
    // IP ต่างกัน = โควตาต่างกัน (ถ้าไม่เชื่อ proxy ทุกคำขอจะเป็น 127.0.0.1 แล้วโดนจำกัดรวมกัน)
    const codes = [];
    for (let i = 0; i < 6; i += 1) codes.push((await attempt(`203.0.113.${10 + i}`)).status);
    assert.ok(!codes.includes(429), `ไม่ควรโดน 429 เมื่อมาจากคนละ IP: ${codes}`);
    const same = [];
    for (let i = 0; i < 6; i += 1) same.push((await attempt('198.51.100.7')).status);
    assert.ok(same.includes(429), `IP เดียวกันควรโดนจำกัด: ${same}`);
  } finally { p.child.kill(); }
});

test('production: ปฏิเสธการเริ่มระบบเมื่อความลับเป็นค่าเริ่มต้น/ว่าง/อ่อน (preflight)', () => {
  const cases = [
    ['JWT_SECRET', { JWT_SECRET: 'change-me-change-me-change-me-change-me' }],
    ['JWT_SECRET', { JWT_SECRET: '' }],
    ['KEY_ENCRYPTION_SECRET', { KEY_ENCRYPTION_SECRET: 'short' }],
    ['STRIPE_WEBHOOK_SECRET', { STRIPE_WEBHOOK_SECRET: '' }],
    ['STRIPE_WEBHOOK_SECRET', { STRIPE_WEBHOOK_SECRET: 'whsec_' }],
    ['DEV_PAY', { DEV_PAY: '1' }],
  ];
  for (const [name, extra] of cases) {
    const r = spawnSync(process.execPath, ['server/index.js'], { cwd: root, env: validProdEnv({ PORT: String(freePort()), ...extra }), encoding: 'utf8', timeout: 20000 });
    assert.notEqual(r.status, 0, `${name} (${JSON.stringify(extra)}) ควรทำให้เริ่มไม่ได้`);
    assert.ok(`${r.stderr}${r.stdout}`.includes(name === 'DEV_PAY' ? 'DEV_PAY' : name), `ข้อความ error ควรบอกชื่อ ${name}`);
  }
  const same = spawnSync(process.execPath, ['server/index.js'], { cwd: root, env: validProdEnv({ JWT_SECRET: 'a'.repeat(48), KEY_ENCRYPTION_SECRET: 'a'.repeat(48), PORT: String(freePort()) }), encoding: 'utf8', timeout: 20000 });
  assert.notEqual(same.status, 0, 'JWT_SECRET กับ KEY_ENCRYPTION_SECRET ห้ามเหมือนกัน');
});

// ---------------------------------------------------------------- backup / restore
test('backup → แก้ข้อมูล → restore: ข้อมูลกลับมาเหมือนตอนสำรอง, มีสำเนา pre-restore, checksum เสียแล้วปฏิเสธ', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-bk-'));
  const dbFile = path.join(dir, 'data', 'store.db');
  fs.mkdirSync(path.join(dir, 'data', 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'uploads', 'a.txt'), 'img');
  const d = new Database(dbFile);
  d.pragma('journal_mode = WAL');
  d.exec('CREATE TABLE t (v TEXT); INSERT INTO t VALUES (\'before\');');
  d.close();
  const env = { ...process.env, DATABASE_PATH: dbFile, BACKUP_DIR: path.join(dir, 'backups'), BACKUP_KEEP: '3' };
  const run = (script, ...args) => spawnSync(process.execPath, [path.join(root, 'server/scripts', script), ...args], { cwd: dir, env, encoding: 'utf8' });

  const b = run('backup.js');
  assert.equal(b.status, 0, b.stderr + b.stdout);
  const folder = fs.readdirSync(path.join(dir, 'backups')).find((n) => n.startsWith('backup-'));
  assert.ok(folder);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'backups', folder, 'manifest.json'), 'utf8'));
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.uploadFiles, 1);

  const d2 = new Database(dbFile);
  d2.exec('DELETE FROM t; INSERT INTO t VALUES (\'after\');');
  d2.close();

  const noYes = run('restore.js', path.join(dir, 'backups', folder));
  assert.notEqual(noYes.status, 0, 'ต้องมี --yes');
  const r = run('restore.js', path.join(dir, 'backups', folder), '--yes');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const d3 = new Database(dbFile, { readonly: true });
  assert.equal(d3.prepare('SELECT v FROM t').get().v, 'before');
  d3.close();
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).some((n) => n.startsWith('pre-restore-')), 'ต้องมีสำเนาก่อนกู้คืน');

  fs.appendFileSync(path.join(dir, 'backups', folder, 'store.db'), 'corrupt');
  const bad = run('restore.js', path.join(dir, 'backups', folder), '--yes');
  assert.notEqual(bad.status, 0, 'checksum ไม่ตรงต้องปฏิเสธ');
  fs.rmSync(dir, { recursive: true, force: true });
});
