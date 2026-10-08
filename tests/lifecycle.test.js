import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { validProdEnv } from './prodenv.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('production + ฐานข้อมูลใหม่: ไม่สร้างผู้ใช้/เกม/โค้ด/คูปองทดสอบ (ทั้งตอนเริ่มระบบและ npm run seed)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-seed-'));
  const dbFile = path.join(dir, 'store.db');
  const env = validProdEnv({ DATABASE_PATH: dbFile });
  // เริ่มระบบ production แล้วปิดเอง (เรียก start/stop ผ่าน node -e)
  const boot = spawnSync(process.execPath, ['--input-type=module', '-e',
    "const { start } = await import('./server/index.js'); const a = start({ port: 0 }); await new Promise((r) => a.server.once('listening', r)); await a.stop();"],
  { cwd: root, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(boot.status, 0, boot.stderr + boot.stdout);
  const seed = spawnSync(process.execPath, ['server/db/seed.js'], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(seed.status, 0, 'seed ใน production ต้องถูกปฏิเสธ (ยกเว้น ALLOW_DEMO_SEED)');

  const d = new Database(dbFile, { readonly: true });
  for (const t of ['users', 'games', 'game_keys', 'coupons', 'orders']) assert.equal(d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, `${t} ต้องว่างใน production`);
  d.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('graceful shutdown: stop() ปิดเซิร์ฟเวอร์ รอคำขอที่ค้าง และปิดฐานข้อมูลเรียบร้อย', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-stop-'));
  Object.assign(process.env, {
    NODE_ENV: 'test', DATABASE_PATH: path.join(dir, 'x.db'), JWT_SECRET: 'test-secret-test-secret-test-secret-0000', KEY_ENCRYPTION_SECRET: 'test-key-encryption-secret-0123456789abcdef',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_secret_for_unit_tests', STRIPE_SECRET_KEY: '', SMTP_HOST: '', API_RATE_LIMIT: '1000000',
  });
  const { start } = await import('../server/index.js');
  const { db } = await import('../server/db/index.js');
  const app = start({ port: 0 });
  await new Promise((r) => app.server.once('listening', r));
  const port = app.server.address().port;
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
  const inflight = fetch(`http://127.0.0.1:${port}/api/games`).then((r) => r.status);
  await new Promise((r) => setTimeout(r, 30)); // ให้คำขอถึงเซิร์ฟเวอร์ก่อน
  await app.stop();
  assert.equal(await inflight, 200, 'คำขอที่เข้ามาก่อน stop ต้องทำให้เสร็จ');
  await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`), 'ปิดแล้วต้องไม่รับ connection ใหม่');
  assert.equal(db.open, false, 'ฐานข้อมูลต้องถูกปิด');
  await app.stop(); // เรียกซ้ำได้ ไม่พัง
  fs.rmSync(dir, { recursive: true, force: true });
});
