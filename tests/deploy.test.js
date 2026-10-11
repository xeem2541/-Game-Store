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
