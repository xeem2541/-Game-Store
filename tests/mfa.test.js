import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { Client, makeAdminClient, makeUser, startServer, totpNow } from './helpers.js';

const { db } = await import('../server/db/index.js');
const { config } = await import('../server/config.js');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.server.close());

const login = (c) => c.post('/api/admin/auth/login', { email: c.email, password: c.password });
const auditCount = (action, userId) => db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND user_id = ?').get(action, userId).n;
async function staffWithoutMfa(role = 'staff') {
  const c = await makeUser(srv.url, { prefix: role });
  db.prepare('UPDATE users SET role = ? WHERE email = ?').run(role, c.email);
  c.userId = db.prepare('SELECT id FROM users WHERE email = ?').get(c.email).id;
  return c;
}
// ล็อกอินใหม่ด้วยรหัสผ่าน + รหัสจากแอป (ช่วงเวลาถัดไปที่ยังไม่ถูกใช้)
async function reloginTotp(c) {
  const pw = await login(c);
  assert.equal(pw.data.mfaRequired, true);
  return c.post('/api/admin/auth/mfa/verify', { code: await totpNow(c.totpSecret, c.totpOffset++) });
}

test('ตั้งค่า 2FA ครั้งแรก: ก่อนตั้งใช้หลังบ้านไม่ได้ (เข้าได้แค่หน้าตั้งค่า), QR + secret, รหัสผิดไม่เปิด, เปิดแล้วได้รหัสกู้คืน 8 ชุด', async () => {
  const c = await staffWithoutMfa();
  const r = await login(c);
  assert.equal(r.status, 200);
  assert.equal(r.data.mfaSetupRequired, true);

  const me = (await c.get('/api/admin/auth/me')).data;
  assert.deepEqual({ enabled: me.mfa.enabled, setupRequired: me.mfa.setupRequired }, { enabled: false, setupRequired: true });
  for (const p of ['/api/admin/dashboard', '/api/admin/orders', '/api/admin/stock']) {
    const blocked = await c.get(p);
    assert.equal(blocked.status, 403, p);
    assert.equal(blocked.data.code, 'MFA_SETUP_REQUIRED');
  }

  assert.equal((await c.post('/api/admin/auth/mfa/enable', { code: '123456' })).data.code, 'MFA_SETUP_FIRST');
  const setup = (await c.post('/api/admin/auth/mfa/setup')).data;
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.ok(setup.otpauthUrl.startsWith('otpauth://totp/') && setup.otpauthUrl.includes(`secret=${setup.secret}`));
  assert.ok(setup.qrSvg.trim().startsWith('<svg'));
  const row = db.prepare('SELECT totp_secret_enc, totp_enabled FROM users WHERE id = ?').get(c.userId);
  assert.ok(row.totp_secret_enc.startsWith('v1:') && !row.totp_secret_enc.includes(setup.secret), 'secret ต้องเข้ารหัสในฐานข้อมูล');
  assert.equal(row.totp_enabled, 0);

  assert.equal((await c.post('/api/admin/auth/mfa/enable', { code: '000000' })).status, 400);
  const en = await c.post('/api/admin/auth/mfa/enable', { code: await totpNow(setup.secret) });
  assert.equal(en.status, 200);
  assert.equal(en.data.recoveryCodes.length, 8);
  assert.equal(new Set(en.data.recoveryCodes).size, 8);
  assert.ok(en.data.recoveryCodes.every((x) => /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(x)));
  assert.equal((await c.get('/api/admin/dashboard')).status, 200, 'เปิด 2FA แล้วเซสชันนี้ใช้งานได้ทันที');
  assert.equal((await c.post('/api/admin/auth/mfa/setup')).data.code, 'MFA_ALREADY_ENABLED', 'เปลี่ยน secret ทับไม่ได้ถ้าไม่ reset');
  assert.equal(auditCount('admin.mfa_enabled', c.userId), 1);
  assert.equal((await c.get('/api/admin/auth/me')).data.mfa.recoveryCodesLeft, 8);
});

test('ล็อกอินที่เปิด 2FA แล้ว: รหัสผ่านอย่างเดียวไม่ได้เซสชัน, รหัสผิด 401 + audit, รหัสเดิมใช้ซ้ำไม่ได้, คุกกี้รอยืนยันใช้แทนเซสชันไม่ได้', async () => {
  const a = await makeAdminClient(srv.url);
  await a.post('/api/admin/auth/logout');
  const pw = await login(a);
  assert.equal(pw.data.mfaRequired, true);
  assert.ok(a.cookies.admin_mfa && !a.cookies.admin_token);
  assert.equal((await a.get('/api/admin/dashboard')).status, 401, 'คุกกี้รอยืนยันไม่ใช่เซสชันแอดมิน');
  assert.equal((await a.get('/api/admin/auth/me')).status, 401);

  const bad = await a.post('/api/admin/auth/mfa/verify', { code: '000000' });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.code, 'MFA_INVALID');
  assert.equal(auditCount('admin.mfa_failed', a.userId), 1);

  const code = await totpNow(a.totpSecret, a.totpOffset++);
  assert.equal((await a.post('/api/admin/auth/mfa/verify', { code })).status, 200);
  assert.ok(a.cookies.admin_token && !a.cookies.admin_mfa);
  assert.equal((await a.get('/api/admin/dashboard')).status, 200);

  // ดักรหัสไปใช้ซ้ำ (เช่น จากหน้าจอ/ฟิชชิง) ไม่ได้ แม้ยังอยู่ในช่วงเวลาเดียวกัน
  const thief = await new Client(a.url).init();
  thief.email = a.email; thief.password = a.password;
  assert.equal((await login(thief)).data.mfaRequired, true);
  assert.equal((await thief.post('/api/admin/auth/mfa/verify', { code })).status, 401);

  // ไม่มีคุกกี้รอยืนยัน (ข้ามขั้นรหัสผ่าน) → ใช้ไม่ได้
  const direct = await (await new Client(a.url).init()).post('/api/admin/auth/mfa/verify', { code: await totpNow(a.totpSecret, a.totpOffset) });
  assert.equal(direct.data.code, 'MFA_SESSION_EXPIRED');
});

test('รหัสกู้คืน: ใช้แทนรหัสจากแอปได้ครั้งเดียว (ไม่สนตัวพิมพ์/ขีด), จำนวนที่เหลือลดลง', async () => {
  const a = await makeAdminClient(srv.url);
  const code = a.recoveryCodes[0];
  await a.post('/api/admin/auth/logout');
  await login(a);
  const ok = await a.post('/api/admin/auth/mfa/verify', { code: code.toLowerCase().replace('-', ' ') });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.recoveryCodesLeft, 7);
  assert.equal((await a.get('/api/admin/auth/me')).data.mfa.recoveryCodesLeft, 7);

  await a.post('/api/admin/auth/logout');
  await login(a);
  assert.equal((await a.post('/api/admin/auth/mfa/verify', { code })).status, 401, 'รหัสกู้คืนที่ใช้แล้วใช้ซ้ำไม่ได้');
  const other = await makeAdminClient(srv.url);
  assert.equal((await a.post('/api/admin/auth/mfa/verify', { code: other.recoveryCodes[0] })).status, 401, 'รหัสกู้คืนของคนอื่นใช้ไม่ได้');
});

test('เซสชันแอดมินที่ออกก่อนผ่าน 2FA (ไม่มี mfa ใน token) ใช้งานไม่ได้เมื่อบัญชีเปิด 2FA แล้ว', async () => {
  const a = await makeAdminClient(srv.url);
  const u = db.prepare('SELECT token_version FROM users WHERE id = ?').get(a.userId);
  const legacy = jwt.sign({ sub: a.userId, tv: u.token_version, aud: 'admin' }, process.env.JWT_SECRET, { expiresIn: 3600 });
  const c = Object.assign(new Client(srv.url), { cookies: { ...a.cookies, admin_token: legacy } });
  const r = await c.get('/api/admin/dashboard');
  assert.equal(r.status, 401);
  assert.equal(r.data.code, 'MFA_REQUIRED');
});

test('แอดมินล้าง 2FA ของคนอื่น (ทำโทรศัพท์หาย): เซสชันเดิมถูกเพิกถอน, ล็อกอินครั้งถัดไปต้องตั้งใหม่; ล้างของตัวเอง/staff ทำไม่ได้', async () => {
  const admin = await makeAdminClient(srv.url);
  const staff = await makeAdminClient(srv.url, 'staff');
  assert.equal((await staff.get('/api/admin/dashboard')).status, 200);
  assert.equal((await admin.get(`/api/admin/users/${staff.userId}`)).data.user.mfaEnabled, 1);

  assert.equal((await staff.post(`/api/admin/users/${admin.userId}/mfa/reset`)).status, 403);
  assert.equal((await admin.post(`/api/admin/users/${admin.userId}/mfa/reset`)).data.code, 'SELF_CHANGE');
  assert.equal((await admin.post(`/api/admin/users/${staff.userId}/mfa/reset`)).status, 200);
  assert.equal(auditCount('user.mfa_reset', admin.userId), 1);

  assert.equal((await staff.get('/api/admin/dashboard')).status, 401, 'เซสชันเดิมของคนที่ถูกล้างต้องใช้ไม่ได้');
  const again = await login(staff);
  assert.equal(again.data.mfaSetupRequired, true);
  assert.equal((await staff.get('/api/admin/dashboard')).data.code, 'MFA_SETUP_REQUIRED');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admin_recovery_codes WHERE user_id = ?').get(staff.userId).n, 0);
});

test('ADMIN_MFA_REQUIRED=0: บัญชีที่ยังไม่เปิด 2FA ใช้งานได้ด้วยรหัสผ่าน แต่บัญชีที่เปิดแล้วยังต้องใช้รหัส', async () => {
  const before = config.adminMfaRequired;
  config.adminMfaRequired = false;
  try {
    const c = await staffWithoutMfa();
    assert.equal((await login(c)).data.mfaSetupRequired, false);
    assert.equal((await c.get('/api/admin/dashboard')).status, 200);
    assert.equal((await c.get('/api/admin/auth/me')).data.mfa.setupRequired, false);

    const a = await makeAdminClient(srv.url);
    await a.post('/api/admin/auth/logout');
    assert.equal((await login(a)).data.mfaRequired, true);
    assert.equal((await reloginTotp(a)).status, 200);
  } finally {
    config.adminMfaRequired = before;
  }
});

test('TOTP ตรงกับ test vector ของ RFC 6238 (SHA-1) และยอมรับเวลาคลาดได้ ±1 ช่วง', async () => {
  const { base32Encode, totpCode, verifyTotp } = await import('../server/services/totp.js');
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  for (const [t, code] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']]) {
    assert.equal(totpCode(secret, Math.floor(t / 30)), code, `T=${t}`);
  }
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 30_000);
  assert.equal(verifyTotp(secret, totpCode(secret, step - 1), { now }), step - 1);
  assert.equal(verifyTotp(secret, totpCode(secret, step + 1), { now }), step + 1);
  assert.equal(verifyTotp(secret, totpCode(secret, step + 2), { now }), null, 'คลาดเกิน 1 ช่วงไม่รับ');
  assert.equal(verifyTotp(secret, totpCode(secret, step), { now, lastStep: step }), null, 'ช่วงที่ใช้ไปแล้วไม่รับ');
  assert.equal(verifyTotp(secret, '12345', { now }), null);
});
