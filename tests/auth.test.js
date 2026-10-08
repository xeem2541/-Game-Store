import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, outbox, startServer, tokenFrom } from './helpers.js';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.server.close());

const newClient = () => new Client(srv.url).init();
const creds = { email: 'somchai@example.com', password: 'secret-pass-1', name: 'สมชาย' };

test('สมัครสมาชิก: สำเร็จ, ล็อกอินอัตโนมัติ, ส่งอีเมลยืนยัน', async () => {
  const c = await newClient();
  const r = await c.post('/api/auth/register', creds);
  assert.equal(r.status, 201);
  assert.equal(r.data.user.email, creds.email);
  assert.equal(r.data.user.emailVerified, false);
  assert.equal(r.data.user.password_hash, undefined);
  assert.equal((await c.get('/api/auth/me')).data.user.email, creds.email);
  assert.ok(outbox.some((m) => m.to === creds.email && m.subject.includes('ยืนยัน')));
});

test('สมัครสมาชิก: ตรวจข้อมูลไม่ผ่าน / อีเมลซ้ำ', async () => {
  const c = await newClient();
  assert.equal((await c.post('/api/auth/register', { ...creds, email: 'bad' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { ...creds, email: 'x@example.com', password: 'short' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { ...creds, email: 'x@example.com', name: '' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { ...creds, email: 'SomChai@Example.com' })).status, 409); // ไม่สนตัวพิมพ์
});

test('login: สำเร็จ / ผิดรหัส / ไม่มีผู้ใช้ ตอบข้อความเดียวกัน', async () => {
  const c = await newClient();
  const ok = await c.post('/api/auth/login', { email: creds.email, password: creds.password });
  assert.equal(ok.status, 200);
  assert.ok(c.cookies.token);

  const wrong = await (await newClient()).post('/api/auth/login', { email: creds.email, password: 'wrong-password' });
  const missing = await (await newClient()).post('/api/auth/login', { email: 'nobody@example.com', password: 'wrong-password' });
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.equal(wrong.data.error, missing.data.error);
});

test('logout: ล้างคุกกี้และออกจากระบบ', async () => {
  const c = await newClient();
  await c.post('/api/auth/login', { email: creds.email, password: creds.password });
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/auth/me')).data.user, null);
});

test('CSRF: คำขอแก้ข้อมูลที่ไม่มี token ถูกปฏิเสธ', async () => {
  const c = await newClient();
  const r = await c.req('POST', '/api/auth/login', { email: creds.email, password: creds.password }, { 'x-csrf-token': 'wrong' });
  assert.equal(r.status, 403);
});

test('ยืนยันอีเมล: โทเคนใช้ได้ครั้งเดียว', async () => {
  const c = await newClient();
  await c.post('/api/auth/login', { email: creds.email, password: creds.password });
  const mail = [...outbox].reverse().find((m) => m.to === creds.email && m.subject.includes('ยืนยัน'));
  const token = tokenFrom(mail);
  assert.equal((await c.get('/api/auth/verify?token=' + token)).status, 200);
  assert.equal((await c.get('/api/auth/me')).data.user.emailVerified, true);
  assert.equal((await c.get('/api/auth/verify?token=' + token)).status, 400); // ใช้ซ้ำไม่ได้
  assert.equal((await c.get('/api/auth/verify?token=deadbeef')).status, 400);
});

test('ลืมรหัสผ่าน/รีเซ็ต: ตอบเหมือนกันทุกกรณี, โทเคนใช้ได้ครั้งเดียว, รหัสเก่าใช้ไม่ได้', async () => {
  const c = await newClient();
  const before = outbox.length;
  const known = await c.post('/api/auth/forgot', { email: creds.email });
  const unknown = await c.post('/api/auth/forgot', { email: 'ghost@example.com' });
  assert.deepEqual(known, unknown);
  assert.equal(outbox.length, before + 1); // ส่งเฉพาะอีเมลที่มีอยู่จริง

  const token = tokenFrom(outbox.at(-1));
  assert.equal((await c.post('/api/auth/reset', { token, password: 'short' })).status, 400);
  assert.equal((await c.post('/api/auth/reset', { token, password: 'brand-new-pass-2' })).status, 200);
  assert.equal((await c.post('/api/auth/reset', { token, password: 'another-pass-3' })).status, 400); // ใช้ซ้ำไม่ได้

  assert.equal((await c.post('/api/auth/login', { email: creds.email, password: creds.password })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: creds.email, password: 'brand-new-pass-2' })).status, 200);
  creds.password = 'brand-new-pass-2';
});

test('endpoint ที่ต้องล็อกอิน ตอบ 401 เมื่อไม่ล็อกอิน', async () => {
  const c = await newClient();
  for (const [m, p] of [['GET', '/api/me'], ['GET', '/api/me/orders'], ['GET', '/api/me/library'], ['GET', '/api/wishlist'], ['GET', '/api/cart']]) {
    assert.equal((await c.req(m, p)).status, 401, `${m} ${p}`);
  }
  assert.equal((await c.post('/api/wishlist', { gameId: 1 })).status, 401);
  assert.equal((await c.post('/api/games/1/reviews', { rating: 5 })).status, 401);
});

test('โปรไฟล์: แก้ชื่อ/อีเมล, เปลี่ยนรหัสผ่านต้องใส่รหัสเดิม', async () => {
  const c = await newClient();
  await c.post('/api/auth/login', { email: creds.email, password: creds.password });
  const upd = await c.put('/api/me', { name: 'สมชาย ใจดี', email: creds.email });
  assert.equal(upd.data.user.name, 'สมชาย ใจดี');

  assert.equal((await c.post('/api/me/password', { currentPassword: 'nope-nope', newPassword: 'whatever-pass-9' })).status, 400);
  assert.equal((await c.post('/api/me/password', { currentPassword: creds.password, newPassword: 'whatever-pass-9' })).status, 200);
  creds.password = 'whatever-pass-9';

  // เปลี่ยนอีเมล → ต้องยืนยันใหม่ ; อีเมลชนกับคนอื่น → 409
  const other = await newClient();
  await other.post('/api/auth/register', { email: 'other@example.com', password: 'other-pass-123', name: 'อื่น' });
  assert.equal((await c.put('/api/me', { name: 'x', email: 'other@example.com' })).status, 409);
  const ch = await c.put('/api/me', { name: 'x', email: 'new-somchai@example.com' });
  assert.equal(ch.data.user.emailVerified, false);
  creds.email = 'new-somchai@example.com';
});

test('wishlist: เพิ่ม/ซ้ำ/ลบ', async () => {
  const c = await newClient();
  await c.post('/api/auth/login', { email: creds.email, password: creds.password });
  assert.equal((await c.post('/api/wishlist', { gameId: 1 })).status, 201);
  assert.equal((await c.post('/api/wishlist', { gameId: 1 })).status, 201); // ซ้ำได้ ไม่พัง
  assert.equal((await c.post('/api/wishlist', { gameId: 99999 })).status, 404);
  assert.equal((await c.get('/api/wishlist')).data.items.length, 1);
  await c.del('/api/wishlist/1');
  assert.equal((await c.get('/api/wishlist')).data.items.length, 0);
});

test('ตะกร้าบนเซิร์ฟเวอร์: บันทึก/อ่าน/ข้าม slug ที่ไม่มี', async () => {
  const c = await newClient();
  await c.post('/api/auth/login', { email: creds.email, password: creds.password });
  const r = await c.put('/api/cart', { slugs: ['dragon-realm', 'kart-mania', 'not-exist'] });
  assert.equal(r.data.items.length, 2);
  assert.equal((await c.get('/api/cart')).data.items.length, 2);
  assert.equal((await c.put('/api/cart', { slugs: [] })).data.items.length, 0);
});

test('รีวิว: 1 คน/1 เกม, แก้ไข, ลบ, คะแนนเฉลี่ยคำนวณจากรีวิวจริง', async () => {
  const c = await newClient();
  await c.post('/api/auth/login', { email: creds.email, password: creds.password });
  const game = (await c.get('/api/games/dragon-realm')).data;
  const base = game.rating; // คะแนนตั้งต้นก่อนมีรีวิว
  assert.equal(game.review_count, 0);

  assert.equal((await c.post(`/api/games/${game.id}/reviews`, { rating: 6 })).status, 400);
  assert.equal((await c.post(`/api/games/${game.id}/reviews`, { rating: 2, body: 'พอใช้' })).status, 201);
  assert.equal((await c.post(`/api/games/${game.id}/reviews`, { rating: 5 })).status, 409);

  let g = (await c.get('/api/games/dragon-realm')).data;
  assert.equal(g.rating, 2);
  assert.equal(g.review_count, 1);

  assert.equal((await c.put(`/api/games/${game.id}/reviews`, { rating: 4, body: 'ดีขึ้น' })).status, 200);
  const list = (await c.get(`/api/games/${game.id}/reviews`)).data;
  assert.equal(list.items[0].rating, 4);
  assert.equal(list.items[0].mine, true);
  assert.equal(list.average, 4);

  const anon = await newClient();
  assert.equal((await anon.get(`/api/games/${game.id}/reviews`)).data.items[0].mine, false);
  assert.equal((await anon.del(`/api/games/${game.id}/reviews`)).status, 401);

  await c.del(`/api/games/${game.id}/reviews`);
  g = (await c.get('/api/games/dragon-realm')).data;
  assert.equal(g.rating, base); // กลับไปใช้คะแนนตั้งต้น
  assert.equal((await c.get('/api/games/99999/reviews')).status, 404);
});
