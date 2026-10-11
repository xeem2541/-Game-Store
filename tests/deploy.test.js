import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkProductionEnv } from '../server/envcheck.js';
import { validProdEnv } from './prodenv.js';

const root = process.cwd();
// เปิดฐานข้อมูลใน process ลูก (ค่าตั้งค่าอ่านตอน import) คืน { status, out }
const openDb = (env) => {
  const r = spawnSync(process.execPath, ['-e', "import('./server/db/index.js').then(() => console.log('DB_OK'))"], { cwd: root, env, encoding: 'utf8', timeout: 20000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gs-deploy-'));

// ---------- render.yaml ----------
const yaml = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
const value = (key) => yaml.match(new RegExp(`- key: ${key}\\s*\\r?\\n\\s+value: "?([^"\\r\\n]+)"?`))?.[1];

test('render.yaml: มี persistent disk ที่ตรงกับ DATABASE_PATH/BACKUP_DIR และไม่ใช้ plan ฟรี', () => {
  assert.doesNotMatch(yaml, /^\s*plan:\s*free\b/m, 'plan ฟรีไม่มี persistent disk → ข้อมูลหายทุกครั้งที่ deploy');
  const mount = yaml.match(/^\s*mountPath:\s*(\S+)/m)?.[1];
  assert.equal(mount, '/app/data');
  for (const key of ['DATABASE_PATH', 'BACKUP_DIR']) {
    assert.ok(value(key)?.startsWith(`${mount}/`), `${key} ต้องอยู่บน disk (${mount})`);
  }
  assert.match(yaml, /^\s*numInstances:\s*1\b/m, 'แอปเก็บ rate limit/คิวอีเมลในหน่วยความจำ → instance เดียว');
  assert.match(yaml, /^\s*healthCheckPath:\s*\/healthz\b/m);
});

test('render.yaml: ประกาศตัวแปรครบ — ค่าที่ Render สุ่ม + ค่าที่ต้องกรอก ทำให้ผ่านการตรวจ production ได้โดยไม่ต้องมี APP_URL', () => {
  const declared = [...yaml.matchAll(/- key: (\w+)/g)].map((m) => m[1]);
  for (const key of ['NODE_ENV', 'JWT_SECRET', 'KEY_ENCRYPTION_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SMTP_HOST', 'SHOP_NAME', 'SHOP_ADDRESS', 'SHOP_TAX_ID', 'TRUST_PROXY', 'REQUIRE_EXISTING_DB']) {
    assert.ok(declared.includes(key), `render.yaml ต้องประกาศ ${key}`);
  }
  assert.equal(value('NODE_ENV'), 'production');
  // จำลองสิ่งที่ Render ส่งให้แอป: ค่าคงที่จาก yaml + ความลับ + RENDER_EXTERNAL_URL (ไม่มี APP_URL)
  const env = { ...validProdEnv(), APP_URL: '', RENDER: 'true', RENDER_EXTERNAL_URL: 'https://game-store.onrender.com', REQUIRE_EXISTING_DB: '1' };
  for (const key of declared) if (value(key)) env[key] = value(key);
  assert.deepEqual(checkProductionEnv(env).errors, []);
});

// ---------- APP_URL ----------
test('envcheck: ใช้ RENDER_EXTERNAL_URL แทน APP_URL ได้, ไม่มีทั้งคู่ = error, APP_URL มาก่อน', () => {
  const base = { ...validProdEnv(), APP_URL: '' };
  assert.ok(checkProductionEnv(base).errors.some((e) => e.includes('APP_URL')));
  assert.deepEqual(checkProductionEnv({ ...base, RENDER_EXTERNAL_URL: 'https://x.onrender.com' }).errors, []);
  const both = checkProductionEnv({ ...base, APP_URL: 'http://localhost:3000', RENDER_EXTERNAL_URL: 'https://x.onrender.com' });
  assert.ok(both.errors.some((e) => e.includes('https')), 'ตรวจ APP_URL ที่ตั้งไว้ ไม่ใช่ค่าสำรอง');
  assert.ok(checkProductionEnv({ ...base, RENDER: 'true', RENDER_EXTERNAL_URL: 'https://x.onrender.com' }).warnings.some((w) => w.includes('REQUIRE_EXISTING_DB')));
});

test('envcheck: ALLOW_DEMO_SEED=1 ใน production มีคำเตือน (โค้ดเกมปลอมขายด้วยเงินจริงได้)', () => {
  assert.ok(!checkProductionEnv(validProdEnv()).warnings.some((w) => w.includes('ALLOW_DEMO_SEED')));
  assert.ok(checkProductionEnv(validProdEnv({ ALLOW_DEMO_SEED: '1' })).warnings.some((w) => w.includes('ALLOW_DEMO_SEED') && w.includes('FAKE')));
});

// ---------- โหมดตัวอย่าง (DEMO_MODE=1, เช่น Render plan ฟรี) ----------
test('envcheck: โหมดตัวอย่างสตาร์ทได้โดยไม่มี Stripe/SMTP/ความลับ แต่ยังตรวจ APP_URL, ความลับที่ตั้งเอง และห้ามคีย์ live', () => {
  const demo = { NODE_ENV: 'production', DEMO_MODE: '1', RENDER: 'true', RENDER_EXTERNAL_URL: 'https://gs-demo.onrender.com' };
  const r = checkProductionEnv(demo);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.includes('DEMO_MODE')));
  assert.ok(!r.warnings.some((w) => w.includes('REQUIRE_EXISTING_DB') || w.includes('SMTP')), 'plan ฟรีไม่มี disk/SMTP อยู่แล้ว ไม่ต้องเตือน');
  assert.ok(checkProductionEnv({ ...demo, RENDER_EXTERNAL_URL: '' }).errors.some((e) => e.includes('APP_URL')));
  assert.ok(checkProductionEnv({ ...demo, JWT_SECRET: 'short' }).errors.some((e) => e.includes('JWT_SECRET')));
  assert.ok(checkProductionEnv({ ...demo, STRIPE_SECRET_KEY: 'sk_live_abcdefghijklmnop1234' }).errors.some((e) => e.includes('live')));
  // ไม่ได้อยู่ในโหมดตัวอย่าง: ยังบังคับ Stripe และห้าม DEV_PAY ตามเดิม
  const real = checkProductionEnv({ ...demo, DEMO_MODE: '', DEV_PAY: '1' }).errors;
  assert.ok(real.some((e) => e.includes('STRIPE_SECRET_KEY')) && real.some((e) => e.includes('DEV_PAY')));
});

test('โหมดตัวอย่าง: เซิร์ฟเวอร์ production สตาร์ทได้ ใส่เกมตัวอย่าง จ่ายแบบจำลอง ยืนยันอีเมลเอง และไม่ให้ search engine เก็บ', async () => {
  const dir = tmpDir();
  const port = 3290 + Math.floor(Math.random() * 50);
  const env = { PATH: process.env.PATH, NODE_ENV: 'production', DEMO_MODE: '1', PORT: String(port), RENDER_EXTERNAL_URL: 'https://gs-demo.onrender.com',
    DATABASE_PATH: path.join(dir, 'd.db'), BACKUP_DIR: path.join(dir, 'b'), LOG_REQUESTS: '0' };
  const { spawn } = await import('node:child_process');
  const base = `http://127.0.0.1:${port}`;
  let child;
  let out = '';
  const boot = async () => {
    child = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    let health;
    for (let i = 0; i < 80 && !health?.ok; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      health = await fetch(`${base}/healthz`).catch(() => null);
    }
    assert.ok(health?.ok, `เซิร์ฟเวอร์ไม่สตาร์ท:\n${out}`);
  };
  const shutdown = async () => { child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r)); };
  try {
    await boot();
    const home = await fetch(`${base}/`);
    assert.equal(home.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match(home.headers.get('set-cookie') ?? '', /demo=1/);
    const cfg = await (await fetch(`${base}/api/config`)).json();
    assert.equal(cfg.demo, true);
    assert.equal(cfg.devPay, true);
    const games = await (await fetch(`${base}/api/games?limit=10`)).json();
    const paidGame = games.items.find((g) => g.finalPrice > 0); // เกมฟรีจ่ายสำเร็จทันทีตอนสั่ง
    assert.ok(paidGame, 'ต้องมีเกมตัวอย่างที่มีราคา');

    // สมัคร → ยืนยันอีเมลแล้วทันที (ไม่มี SMTP) → สั่งซื้อ → จ่ายแบบจำลอง → ได้โค้ด
    const jar = new Map();
    const call = async (url, opts = {}) => {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(`${base}${url}`, { ...opts, headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': jar.get('csrf') ?? '', origin: base, ...opts.headers } });
      for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
      return res;
    };
    await call('/api/health');
    const reg = await (await call('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'demo@example.com', password: 'demo-password-123', name: 'Demo' }) })).json();
    assert.equal(reg.user.emailVerified ?? reg.user.email_verified, true, JSON.stringify(reg));
    await call('/api/cart', { method: 'PUT', body: JSON.stringify({ slugs: [paidGame.slug] }) });
    const ord = await call('/api/orders', { method: 'POST', body: JSON.stringify({ idempotencyKey: 'demo-order-1' }) });
    assert.equal(ord.status, 201, await ord.clone().text());
    const { order } = await ord.json();
    assert.equal(order.status, 'pending');
    const paid = await (await call(`/api/orders/${order.id}/dev-pay`, { method: 'POST', body: '{}' })).json();
    assert.equal(paid.order.status, 'paid');

    // รีสตาร์ทโดยข้อมูลยังอยู่: ความลับที่สุ่มไว้ต้องเหมือนเดิม (ล็อกอินค้างอยู่ และถอดรหัสโค้ดเกมเดิมได้)
    await shutdown();
    await boot();
    const again = await call(`/api/orders/${order.id}`);
    assert.equal(again.status, 200, await again.clone().text());
    const { order: o2 } = await again.json();
    assert.match(JSON.stringify(o2), /FAKE-/);
  } finally {
    await shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- กันข้อมูลหายตอนสตาร์ท ----------
test('REQUIRE_EXISTING_DB=1: ไม่พบไฟล์ฐานข้อมูล → ไม่ยอมเริ่ม (ไม่สร้างฐานข้อมูลว่างใหม่); มีไฟล์แล้ว → เริ่มได้', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 'store.db');
  const env = validProdEnv({ DATABASE_PATH: dbPath, REQUIRE_EXISTING_DB: '1' });
  const refused = openDb(env);
  assert.notEqual(refused.status, 0);
  assert.match(refused.out, /REQUIRE_EXISTING_DB/);
  assert.equal(fs.existsSync(dbPath), false, 'ต้องไม่สร้างไฟล์ว่างทิ้งไว้');

  assert.equal(openDb({ ...env, REQUIRE_EXISTING_DB: '' }).status, 0); // ติดตั้งครั้งแรก
  const again = openDb(env);
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /DB_OK/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('production สร้างฐานข้อมูลใหม่ → เตือนดัง ๆ ใน log (ครั้งถัดไปไม่เตือน)', () => {
  const dir = tmpDir();
  const env = validProdEnv({ DATABASE_PATH: path.join(dir, 'store.db') });
  assert.match(openDb(env).out, /สร้างฐานข้อมูลใหม่/);
  assert.doesNotMatch(openDb(env).out, /สร้างฐานข้อมูลใหม่/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('โฟลเดอร์ข้อมูลเขียนไม่ได้ → error บอกตำแหน่งและสาเหตุที่น่าจะเป็น', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'not-a-dir');
  fs.writeFileSync(file, '');
  const r = openDb(validProdEnv({ DATABASE_PATH: path.join(file, 'store.db') })); // พาเรนต์เป็นไฟล์ → สร้างโฟลเดอร์ไม่ได้ (root ก็ทำไม่ได้)
  assert.notEqual(r.status, 0);
  assert.match(r.out, /เขียนโฟลเดอร์ข้อมูล .*not-a-dir/);
  assert.match(r.out, /mount/);
  fs.rmSync(dir, { recursive: true, force: true });
});
