import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, makeUser, startServer } from './helpers.js';

const { db } = await import('../server/db/index.js');
const { ensureEnvAdmin } = await import('../server/services/envAdmin.js');
const { checkProductionEnv } = await import('../server/envcheck.js');
const { validProdEnv } = await import('./prodenv.js');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.server.close());

const quiet = { log: () => {} };
const row = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email);
const adminLogin = async (email, password) => (await new Client(srv.url).init()).post('/api/admin/auth/login', { email, password });

test('ADMIN_EMAIL/ADMIN_PASSWORD: ไม่ได้ตั้ง = ไม่ทำอะไร, ตั้งครั้งแรก = สร้างแอดมินที่ยืนยันอีเมลแล้ว และเข้าหลังบ้านได้', async () => {
  assert.equal(await ensureEnvAdmin({}, quiet), null);
  const env = { ADMIN_EMAIL: 'Owner@Shop.test', ADMIN_PASSWORD: 'correct-horse-battery-staple' };
  const r = await ensureEnvAdmin(env, quiet);
  assert.equal(r.created, true);
  const u = row('owner@shop.test');
  assert.equal(u.role, 'admin');
  assert.equal(u.email_verified, 1);
  assert.notEqual(u.password_hash, env.ADMIN_PASSWORD, 'เก็บเป็นแฮช ไม่เก็บรหัสผ่านจริง');
  assert.equal((await adminLogin('owner@shop.test', env.ADMIN_PASSWORD)).status, 200);
  assert.equal((await adminLogin('owner@shop.test', 'wrong-password-123')).status, 401);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'user.admin_env_created' AND entity_id = ?").get(String(u.id)));

  // สตาร์ทซ้ำด้วยค่าเดิม: ไม่เปลี่ยนอะไร (เซสชันเดิมยังใช้ได้)
  const again = await ensureEnvAdmin(env, quiet);
  assert.equal(again.passwordChanged, false);
  assert.equal(row('owner@shop.test').token_version, u.token_version);
});

test('ADMIN_EMAIL เป็นบัญชีที่สมัครไว้แล้ว: เลื่อนเป็นแอดมิน, รหัสผ่านใหม่จาก env ใช้แทน และออกจากระบบทุกเซสชันเดิม', async () => {
  const c = await makeUser(srv.url, { prefix: 'envadmin' });
  db.prepare("UPDATE users SET status = 'suspended' WHERE email = ?").run(c.email);
  const before = row(c.email);
  const r = await ensureEnvAdmin({ ADMIN_EMAIL: c.email, ADMIN_PASSWORD: 'a-brand-new-long-password' }, quiet);
  assert.equal(r.passwordChanged, true);
  const after = row(c.email);
  assert.equal(after.role, 'admin');
  assert.equal(after.status, 'active');
  assert.equal(after.token_version, before.token_version + 1);
  assert.equal((await adminLogin(c.email, 'a-brand-new-long-password')).status, 200);
  assert.equal((await adminLogin(c.email, c.password)).status, 401, 'รหัสผ่านเดิมใช้ไม่ได้แล้ว');
});

test('ADMIN_PASSWORD สั้นเกินไป/ไม่มีอีเมล: ไม่สร้างบัญชี และ production ไม่ยอมสตาร์ท', async () => {
  const logs = [];
  assert.equal(await ensureEnvAdmin({ ADMIN_EMAIL: 'weak@shop.test', ADMIN_PASSWORD: 'short' }, { log: (m) => logs.push(m) }), null);
  assert.equal(row('weak@shop.test'), undefined);
  assert.match(logs[0], /12/);

  assert.deepEqual(checkProductionEnv(validProdEnv({ ADMIN_EMAIL: 'owner@shop.test', ADMIN_PASSWORD: 'correct-horse-battery-staple' })).errors, []);
  const errs = (extra) => checkProductionEnv(validProdEnv(extra)).errors.join('\n');
  assert.match(errs({ ADMIN_EMAIL: 'owner@shop.test', ADMIN_PASSWORD: 'short' }), /ADMIN_PASSWORD/);
  assert.match(errs({ ADMIN_EMAIL: 'owner@shop.test', ADMIN_PASSWORD: 'change-me-change-me-change-me' }), /ADMIN_PASSWORD/);
  assert.match(errs({ ADMIN_PASSWORD: 'correct-horse-battery-staple' }), /ADMIN_EMAIL/);
});
