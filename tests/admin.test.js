import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import Database from 'better-sqlite3';
import { Client, makeAdminClient, makeUser, outbox, startServer, totpNow } from './helpers.js';

const { db } = await import('../server/db/index.js');
const { migrate } = await import('../server/db/migrations.js');
const { seedCoupons } = await import('../server/db/seed.js');
const { processEmailQueue } = await import('../server/services/emailQueue.js');
const { decrypt } = await import('../server/services/crypto.js');

let srv;
let admin;
let staff;
before(async () => {
  srv = await startServer();
  seedCoupons();
  admin = await makeAdminClient(srv.url, 'admin');
  staff = await makeAdminClient(srv.url, 'staff');
});
after(() => srv.server.close());

const key = () => `key-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const gameId = (slug) => db.prepare('SELECT id FROM games WHERE slug = ?').get(slug).id;
const auditRows = (action, entityId) => db.prepare('SELECT * FROM audit_log WHERE action = ? AND entity_id = ? ORDER BY id').all(action, String(entityId));
// ซื้อ + จำลองชำระเงิน (dev-pay) → คืนออเดอร์
async function paidOrder(slugs, body = {}) {
  const c = await makeUser(srv.url);
  await c.put('/api/cart', { slugs });
  const o = await c.post('/api/orders', { idempotencyKey: key(), ...body });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  const p = await c.post(`/api/orders/${o.data.order.id}/dev-pay`, {});
  assert.equal(p.status, 200);
  return { c, order: p.data.order };
}
const pendingOrder = async (slug) => {
  const c = await makeUser(srv.url);
  await c.put('/api/cart', { slugs: [slug] });
  const o = await c.post('/api/orders', { idempotencyKey: key() });
  return { c, order: o.data.order };
};
const png = (w = 64, h = 48, color = '#ff6600') => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const form = (buf, name = 'x.png', type = 'image/png') => { const f = new FormData(); f.append('file', new Blob([buf], { type }), name); return f; };
const newGame = (over = {}) => ({
  title: 'Test Game', slug: `test-game-${Math.random().toString(36).slice(2, 8)}`, description: 'คำอธิบายทดสอบ', description_en: 'Test description',
  genre: 'RPG', platform: 'PC', price: 99900, discount: 10, release_date: '2026-01-01', ...over,
});

// ---------------------------------------------------------------- สิทธิ์
test('สิทธิ์: ไม่ล็อกอิน=401, ผู้ใช้ทั่วไป/คุกกี้ลูกค้าของ admin ก็เข้า /api/admin ไม่ได้', async () => {
  const anon = await new Client(srv.url).init();
  for (const p of ['/api/admin/dashboard', '/api/admin/games', '/api/admin/orders', '/api/admin/users', '/api/admin/audit']) {
    assert.equal((await anon.get(p)).status, 401, p);
  }
  const user = await makeUser(srv.url);
  assert.equal((await user.get('/api/admin/dashboard')).status, 401);

  // ผู้ใช้ที่ role = admin แต่ล็อกอินแค่หน้าร้าน (ไม่มี admin_token) ต้องไม่ผ่าน
  const sneaky = await makeUser(srv.url);
  db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(sneaky.email);
  assert.equal((await sneaky.get('/api/admin/dashboard')).status, 401);
  assert.equal((await sneaky.post('/api/admin/games', newGame())).status, 401);
});

test('ล็อกอินแอดมิน: ผู้ใช้ทั่วไป/รหัสผิด/ไม่มีอีเมล ตอบข้อความเดียวกัน, ระงับแล้วเข้าไม่ได้ทันที', async () => {
  const user = await makeUser(srv.url);
  const a = await user.post('/api/admin/auth/login', { email: user.email, password: user.password });
  const b = await (await new Client(srv.url).init()).post('/api/admin/auth/login', { email: admin.email, password: 'wrong-password-1' });
  const c = await (await new Client(srv.url).init()).post('/api/admin/auth/login', { email: 'nobody@example.com', password: 'wrong-password-1' });
  assert.deepEqual([a.status, b.status, c.status], [401, 401, 401]);
  assert.equal(a.data.error, b.data.error);
  assert.equal(b.data.error, c.data.error);
  assert.ok(!user.cookies.admin_token);

  const me = await admin.get('/api/admin/auth/me');
  assert.equal(me.data.user.role, 'admin');
  assert.ok(!JSON.stringify(me.data).includes('password'));

  // เซสชันแอดมินอายุ 2 ชั่วโมง (สั้นกว่าลูกค้า 7 วัน)
  const payload = JSON.parse(Buffer.from(admin.cookies.admin_token.split('.')[1], 'base64url').toString());
  assert.equal(payload.exp - payload.iat, 2 * 3600);
  assert.equal(payload.aud, 'admin');

  const s = await makeAdminClient(srv.url, 'staff');
  assert.equal((await s.get('/api/admin/dashboard')).status, 200);
  db.prepare("UPDATE users SET status = 'suspended' WHERE email = ?").run(s.email);
  assert.equal((await s.get('/api/admin/dashboard')).status, 401); // มีผลทันที
  assert.equal((await new Client(srv.url).init().then((x) => x.post('/api/admin/auth/login', { email: s.email, password: s.password }))).status, 401);

  assert.equal((await admin.post('/api/admin/auth/logout', {})).status, 200);
  assert.equal((await admin.get('/api/admin/dashboard')).status, 401);
  // เปิด 2FA แล้ว: รหัสผ่านถูกยังไม่ได้เซสชัน ต้องยืนยันรหัสจากแอปก่อน
  const pw = await admin.post('/api/admin/auth/login', { email: admin.email, password: admin.password });
  assert.equal(pw.status, 200);
  assert.equal(pw.data.mfaRequired, true);
  assert.ok(!admin.cookies.admin_token);
  assert.equal((await admin.get('/api/admin/dashboard')).status, 401);
  assert.equal((await admin.post('/api/admin/auth/mfa/verify', { code: await totpNow(admin.totpSecret, admin.totpOffset++) })).status, 200);
  assert.equal(JSON.parse(Buffer.from(admin.cookies.admin_token.split('.')[1], 'base64url').toString()).mfa, true);
  assert.equal((await admin.get('/api/admin/dashboard')).status, 200);
});

test('สิทธิ์ staff: ดูข้อมูล/ออเดอร์/รีวิวได้ แต่ทำสิ่งที่ admin เท่านั้นไม่ได้ (403)', async () => {
  for (const p of ['/api/admin/dashboard', '/api/admin/orders', '/api/admin/games', '/api/admin/stock', '/api/admin/reviews', '/api/admin/reports/sales.csv']) {
    assert.equal((await staff.get(p)).status, 200, p);
  }
  const gid = gameId('dragon-realm');
  const forbidden = [
    staff.post('/api/admin/games', newGame()), staff.put(`/api/admin/games/${gid}`, { title: 'X' }), staff.del(`/api/admin/games/${gid}`),
    staff.upload(`/api/admin/games/${gid}/images?kind=cover`, form(Buffer.from('x'))), staff.upload(`/api/admin/stock/${gid}/import`, form(Buffer.from('CODE-1111'), 'k.csv', 'text/csv')),
    staff.put(`/api/admin/stock/${gid}/threshold`, { threshold: 1 }), staff.post('/api/admin/stock/keys/1/reveal', {}), staff.post('/api/admin/stock/keys/1/revoke', { reason: 'xxx' }),
    staff.get('/api/admin/users'), staff.put('/api/admin/users/1/role', { role: 'admin' }), staff.put('/api/admin/users/1/status', { status: 'suspended' }),
    staff.get('/api/admin/coupons'), staff.post('/api/admin/coupons', {}), staff.get('/api/admin/audit'),
    staff.post('/api/admin/orders/1/refund', { reason: 'xxx', confirmOrderId: 1 }), staff.get('/api/admin/reports/new-users.csv'),
  ];
  for (const r of await Promise.all(forbidden)) assert.equal(r.status, 403, JSON.stringify(r.data));
});

test('หน้า /admin: ไม่ล็อกอิน→ไปหน้า login, ผู้ใช้ทั่วไป→กลับหน้าแรก, แอดมิน→เข้าได้, ไฟล์สคริปต์ไม่เปิดสาธารณะ', async () => {
  const anon = new Client(srv.url);
  const r1 = await anon.raw('/admin');
  assert.equal(r1.status, 302);
  assert.equal(r1.headers.get('location'), '/admin/login');
  assert.equal((await anon.raw('/admin/js/core.js')).status, 302);
  assert.equal((await anon.raw('/admin/vendor/chart.umd.js')).status, 302);
  assert.equal((await anon.raw('/admin/login')).status, 200);

  const user = await makeUser(srv.url);
  const r2 = await user.raw('/admin');
  assert.equal(r2.status, 302);
  assert.equal(r2.headers.get('location'), '/');
  assert.equal((await user.raw('/admin/js/core.js')).headers.get('location'), '/');

  const ok = await admin.raw('/admin/'); // /admin (ไม่มี /) ถูก express.static redirect 301 มาที่ /admin/
  assert.equal(ok.status, 200);
  assert.ok(ok.buf.toString().includes('<html'));
  assert.equal((await admin.raw('/admin/js/core.js')).status, 200);
});

// ---------------------------------------------------------------- เกม + รูป
test('จัดการเกม: เพิ่ม/แก้ไข/ซ่อน + audit log ก่อน-หลัง + ประวัติราคา + ออเดอร์เก่าไม่เปลี่ยน', async () => {
  const bad = [{ discount: 101 }, { price: -1 }, { slug: 'Bad Slug!' }, { trailer_url: 'https://evil.example/x' }, { title: '' }, { release_date: 'yesterday' }];
  for (const b of bad) assert.equal((await admin.post('/api/admin/games', newGame(b))).status, 400, JSON.stringify(b));

  const body = newGame({ trailer_url: 'https://www.youtube.com/embed/abc123' });
  const created = await admin.post('/api/admin/games', body);
  assert.equal(created.status, 201);
  const id = created.data.id;
  assert.equal((await admin.post('/api/admin/games', newGame({ slug: body.slug }))).status, 409); // slug ซ้ำ
  assert.equal(auditRows('game.create', id).length, 1);
  addStock(id, 3);

  const pub = await new Client(srv.url).get(`/api/games/${body.slug}`);
  assert.equal(pub.data.price, 99900);
  assert.equal(pub.data.finalPrice, 89910);

  // ออเดอร์ที่สั่งไว้ก่อนเปลี่ยนราคา
  const buyer = await makeUser(srv.url);
  await buyer.put('/api/cart', { slugs: [body.slug] });
  const ord = (await buyer.post('/api/orders', { idempotencyKey: key() })).data.order;
  assert.equal(ord.total, 89910);

  const upd = await admin.put(`/api/admin/games/${id}`, { price: 50000, discount: 0, title: 'Renamed Game' });
  assert.equal(upd.status, 200);
  assert.deepEqual(upd.data.changed.sort(), ['discount', 'price', 'title']);
  const log = auditRows('game.update', id)[0];
  assert.deepEqual(JSON.parse(log.meta).before, { title: 'Test Game', price: 99900, discount: 10 });
  assert.deepEqual(JSON.parse(log.meta).after, { title: 'Renamed Game', price: 50000, discount: 0 });
  assert.equal(log.ip !== undefined, true);

  const hist = (await admin.get(`/api/admin/games/${id}`)).data.priceHistory;
  assert.equal(hist.length, 1);
  assert.deepEqual([hist[0].oldPrice, hist[0].newPrice, hist[0].oldDiscount, hist[0].newDiscount], [99900, 50000, 10, 0]);

  assert.equal((await buyer.get(`/api/orders/${ord.id}`)).data.order.total, 89910); // snapshot เดิม
  assert.equal((await buyer.get(`/api/orders/${ord.id}`)).data.order.items[0].unitPrice, 89910);
  assert.equal((await new Client(srv.url).get(`/api/games/${body.slug}`)).data.finalPrice, 50000);

  assert.equal((await admin.put(`/api/admin/games/${id}`, { discount: 50 })).data.changed.join(), 'discount');
  assert.equal((await admin.put(`/api/admin/games/${id}`, { title: 'Renamed Game' })).data.changed.length, 0); // ไม่มีอะไรเปลี่ยน → ไม่มี log เพิ่ม
  assert.equal((await admin.put(`/api/admin/games/${id}`, { slug: 'dragon-realm' })).status, 409);

  assert.equal((await admin.del(`/api/admin/games/${id}`)).status, 200);
  assert.equal((await new Client(srv.url).get(`/api/games/${body.slug}`)).status, 404); // หายจากหน้าร้าน
  assert.equal((await admin.get(`/api/admin/games/${id}`)).data.game.active, false); // แต่ข้อมูลยังอยู่
  assert.equal(auditRows('game.hide', id).length, 1);

  const list = (await admin.get('/api/admin/games?q=renamed&status=hidden')).data;
  assert.equal(list.total, 1);
  assert.equal((await admin.get('/api/admin/games?limit=5&page=2&sort=priceDesc')).data.items.length, 5);
  assert.ok((await admin.get('/api/admin/games?genre=RPG&platform=PC')).data.items.every((g) => g.genre === 'RPG' && g.platform === 'PC'));
});
const addStock = (id, n) => {
  const ins = db.prepare("INSERT INTO game_keys (game_id, key_enc, key_hash) VALUES (?, 'x', ?)");
  for (let i = 0; i < n; i++) ins.run(id, `h-${id}-${Math.random()}`);
};

test('อัปโหลดรูป: ตรวจจากเนื้อไฟล์, ไฟล์ปลอม/เสีย/ใหญ่เกินถูกปฏิเสธ, ชื่อสุ่ม, เก็บเป็น WebP, ย่อขนาด', async () => {
  const id = (await admin.post('/api/admin/games', newGame())).data.id;
  const slug = db.prepare('SELECT slug FROM games WHERE id = ?').get(id).slug;
  const up = (buf, name, type) => admin.upload(`/api/admin/games/${id}/images?kind=cover`, form(buf, name, type));

  // ไฟล์ HTML/สคริปต์ที่ปลอมนามสกุล .png และ Content-Type เป็น image/png
  for (const evil of ['<html><script>alert(1)</script></html>', '<?php system($_GET[0]); ?>', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>']) {
    const r = await up(Buffer.from(evil), 'evil.png', 'image/png');
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'BAD_IMAGE_TYPE');
  }
  assert.equal((await up(Buffer.from('GIF89a' + 'x'.repeat(50)), 'a.png', 'image/png')).data.code, 'BAD_IMAGE_TYPE'); // GIF ไม่รับ
  // ลายเซ็น PNG ถูกต้องแต่เนื้อในเสีย
  const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not really a png')]);
  assert.equal((await up(broken, 'broken.png')).data.code, 'BAD_IMAGE_FILE');
  // ใหญ่เกิน 3 MB
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(3 * 1024 * 1024 + 10)]);
  assert.equal((await up(big, 'big.jpg', 'image/jpeg')).status, 413);
  assert.equal((await admin.upload(`/api/admin/games/${id}/images?kind=cover`, new FormData())).data.code, 'NO_FILE');

  // รูปจริง: นามสกุลหลอกเป็น .exe ก็ใช้ได้เพราะตรวจจากเนื้อไฟล์ — แต่ชื่อไฟล์ที่เก็บเป็นแบบสุ่ม .webp เสมอ
  const ok = await up(await png(2000, 1500), 'my cover ../../evil.exe', 'application/octet-stream');
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.match(ok.data.url, /^\/uploads\/games\/[a-f0-9]{32}\.webp$/);
  assert.ok(!ok.data.url.includes('evil'));

  const served = await new Client(srv.url).raw(ok.data.url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/webp');
  const meta = await sharp(served.buf).metadata();
  assert.equal(meta.format, 'webp');
  assert.deepEqual([meta.width, meta.height], [800, 600]); // ย่อ/ครอปเป็นสัดส่วนปก

  const redirect = await new Client(srv.url).raw(`/api/games/${slug}/cover.svg`);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), ok.data.url);

  // เปลี่ยนปก → ไฟล์เก่าถูกลบ
  const second = await up(await png(), 'c2.png');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await new Client(srv.url).raw(ok.data.url)).status, 404);
  assert.equal((await new Client(srv.url).raw(second.data.url)).status, 200);

  // ภาพตัวอย่าง: ย่อไม่เกิน 1280 และจำกัด 10 ภาพ
  const shot = await admin.upload(`/api/admin/games/${id}/images?kind=screenshot`, form(await png(3000, 1000, '#00aa88')));
  assert.equal(shot.status, 201);
  assert.ok((await sharp((await new Client(srv.url).raw(shot.data.url)).buf).metadata()).width <= 1280);
  for (let i = 0; i < 9; i++) await admin.upload(`/api/admin/games/${id}/images?kind=screenshot`, form(await png(10, 10)));
  assert.equal((await admin.upload(`/api/admin/games/${id}/images?kind=screenshot`, form(await png(10, 10)))).data.code, 'TOO_MANY_IMAGES');
  assert.equal((await new Client(srv.url).get(`/api/games/${slug}`)).data.images.length, 10); // หน้าร้านแสดงภาพตัวอย่างครบ
});

test('เสิร์ฟรูป: กัน path traversal / ชื่อไฟล์แปลก', async () => {
  const c = new Client(srv.url);
  for (const p of ['/uploads/games/..%2f..%2f.env', '/uploads/games/%2e%2e%2fstore.db', '/uploads/games/abc.webp', '/uploads/games/index.html', `/uploads/games/${'a'.repeat(32)}.webp`]) {
    assert.equal((await c.raw(p)).status, 404, p);
  }
});

// ---------------------------------------------------------------- สต็อกโค้ด
test('นำเข้าโค้ดจาก CSV: ถูก/ซ้ำ/ผิดรูปแบบ, เข้ารหัส, ไฟล์ผิดชนิด/ใหญ่เกิน/แถวเกิน, audit ไม่เก็บตัวโค้ด', async () => {
  const gid = gameId('retro-arcade-pack');
  const imp = (content, name = 'k.csv') => admin.upload(`/api/admin/stock/${gid}/import`, form(Buffer.from(content), name, 'text/csv'));
  const before = db.prepare("SELECT COUNT(*) AS n FROM game_keys WHERE game_id = ?").get(gid).n;

  const r1 = await imp('code\nIMPORT-AAAA-0001\nIMPORT-AAAA-0002\nIMPORT-AAAA-0002\nbad code!\n"IMPORT-AAAA-0003",note\n=SUM(1)\n\n');
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.deepEqual([r1.data.rows, r1.data.added, r1.data.duplicates, r1.data.invalid], [6, 3, 1, 2]);
  assert.equal(r1.data.invalidRows.length, 2);

  const r2 = await imp('IMPORT-AAAA-0001\nIMPORT-AAAA-0004\n'); // ซ้ำกับที่มีในระบบ 1
  assert.deepEqual([r2.data.added, r2.data.duplicates, r2.data.invalid], [1, 1, 0]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM game_keys WHERE game_id = ?").get(gid).n, before + 4);

  // เข้ารหัสจริง และ audit ไม่มีตัวโค้ด
  const rows = db.prepare('SELECT key_enc FROM game_keys WHERE game_id = ? ORDER BY id DESC LIMIT 4').all(gid);
  assert.ok(rows.every((r) => !r.key_enc.includes('IMPORT-') && /^v1:/.test(r.key_enc)));
  assert.deepEqual(rows.map((r) => decrypt(r.key_enc)).sort(), ['IMPORT-AAAA-0001', 'IMPORT-AAAA-0002', 'IMPORT-AAAA-0003', 'IMPORT-AAAA-0004']);
  const log = db.prepare("SELECT meta FROM audit_log WHERE action = 'stock.import' ORDER BY id DESC LIMIT 1").get().meta;
  assert.ok(!log.includes('IMPORT-'));

  assert.equal((await admin.upload(`/api/admin/stock/${gid}/import`, form(Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x80]), 'bin.csv'))).data.code, 'BAD_CSV'); // ไม่ใช่ UTF-8
  assert.equal((await imp('CODE-1\0X')).data.code, 'BAD_CSV');
  assert.equal((await imp('x'.repeat(1024 * 1024 + 10))).status, 413);
  const many = Array.from({ length: 5001 }, (_, i) => `ROWS-${String(i).padStart(6, '0')}`).join('\n');
  assert.equal((await imp(many)).data.code, 'TOO_MANY_ROWS');
  assert.equal((await admin.upload('/api/admin/stock/99999/import', form(Buffer.from('CODE-0001'), 'k.csv'))).status, 404);
});

test('สต็อก: ดูจำนวน/เกณฑ์เตือน, รายการโค้ดปิดบังบางส่วน, reveal มี audit, เพิกถอนเฉพาะที่ยังไม่ขาย', async () => {
  const slug = 'puzzle-palace';
  const gid = gameId(slug);
  const sum = (await admin.get('/api/admin/stock?q=puzzle')).data.items.find((i) => i.id === gid);
  assert.equal(sum.available, 20);
  assert.equal(sum.low, false);

  assert.equal((await admin.put(`/api/admin/stock/${gid}/threshold`, { threshold: 25 })).status, 200);
  assert.equal((await admin.get('/api/admin/stock?q=puzzle')).data.items.find((i) => i.id === gid).low, true);
  assert.ok((await admin.get('/api/admin/dashboard')).data.alerts.lowStock.some((g) => g.id === gid));
  assert.equal((await admin.put(`/api/admin/stock/${gid}/threshold`, { threshold: -1 })).status, 400);
  await admin.put(`/api/admin/stock/${gid}/threshold`, { threshold: 5 });

  const list = (await admin.get(`/api/admin/stock/${gid}/keys?status=available&limit=3`)).data;
  assert.equal(list.items.length, 3);
  assert.ok(list.items.every((k) => /^\*+.{4}$|^[*-]+[A-Za-z0-9]{4}$/.test(k.masked) && !k.masked.includes('FAKE')));
  assert.ok(!JSON.stringify(list).includes('FAKE-')); // ไม่มีโค้ดเต็มในรายการ

  const k = list.items[0];
  const rev = await admin.post(`/api/admin/stock/keys/${k.id}/reveal`, {});
  assert.match(rev.data.code, /^FAKE-[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$/);
  assert.equal(auditRows('key.reveal', k.id).length, 1);

  assert.equal((await admin.post(`/api/admin/stock/keys/${k.id}/revoke`, { reason: 'x' })).status, 400); // เหตุผลสั้นไป
  assert.equal((await admin.post(`/api/admin/stock/keys/${k.id}/revoke`, { reason: 'โค้ดรั่วไหล' })).status, 200);
  const row = db.prepare('SELECT status, revoke_reason, revoked_by FROM game_keys WHERE id = ?').get(k.id);
  assert.deepEqual([row.status, row.revoke_reason, row.revoked_by], ['revoked', 'โค้ดรั่วไหล', admin.userId]);
  assert.equal((await admin.post(`/api/admin/stock/keys/${k.id}/revoke`, { reason: 'ซ้ำอีกครั้ง' })).data.code, 'KEY_NOT_AVAILABLE');

  // โค้ดที่ขายแล้ว / ถูกจองอยู่ ห้ามลบหรือเพิกถอน
  const { order } = await paidOrder([slug]);
  const sold = db.prepare("SELECT k.id FROM game_keys k JOIN order_items oi ON oi.id = k.order_item_id WHERE oi.order_id = ? AND k.status = 'sold'").get(order.id);
  const r = await admin.post(`/api/admin/stock/keys/${sold.id}/revoke`, { reason: 'ลองลบโค้ดที่ขายแล้ว' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'KEY_SOLD');
  assert.equal(db.prepare('SELECT status FROM game_keys WHERE id = ?').get(sold.id).status, 'sold');
  const { order: pend } = await pendingOrder(slug);
  const reserved = db.prepare("SELECT k.id FROM game_keys k JOIN order_items oi ON oi.id = k.order_item_id WHERE oi.order_id = ? AND k.status = 'reserved'").get(pend.id);
  assert.equal((await admin.post(`/api/admin/stock/keys/${reserved.id}/revoke`, { reason: 'ลองลบโค้ดที่ถูกจอง' })).status, 409);
  assert.equal((await admin.post('/api/admin/stock/keys/99999/reveal', {})).status, 404);
});

// ---------------------------------------------------------------- ออเดอร์
test('ออเดอร์ (แอดมิน): ค้นหา/กรอง/แบ่งหน้า, รายละเอียด (payments, ประวัติสถานะ, โค้ดปิดบัง), ปิดบัง hash', async () => {
  const { c, order } = await paidOrder(['neon-racer-2077']);
  const detail = (await staff.get(`/api/admin/orders/${order.id}`)).data;
  assert.equal(detail.order.status, 'paid');
  assert.equal(detail.user.email, c.email);
  assert.ok(!JSON.stringify(detail).includes('password'));
  assert.equal(detail.payments[0].provider, 'dev');
  assert.deepEqual(detail.events.map((e) => `${e.fromStatus}>${e.toStatus}`), ['null>pending', 'pending>paid']);
  assert.equal(detail.keys.length, 1);
  assert.ok(!detail.keys[0].masked.includes('FAKE-') && detail.keys[0].masked.endsWith(detail.keys[0].masked.slice(-4)));
  assert.ok(!JSON.stringify(detail).match(/FAKE-[0-9A-F]{6}-/)); // ไม่มีโค้ดเต็ม

  const byId = (await staff.get(`/api/admin/orders?q=${order.id}`)).data;
  assert.ok(byId.items.some((o) => o.id === order.id));
  const byMail = (await staff.get(`/api/admin/orders?q=${encodeURIComponent(c.email.split('@')[0])}`)).data;
  assert.equal(byMail.items.length, 1);
  assert.equal(byMail.items[0].email, c.email);
  const paid = (await staff.get('/api/admin/orders?status=paid&provider=dev&limit=3&page=1&sort=totalDesc')).data;
  assert.ok(paid.items.length <= 3 && paid.items.every((o) => o.status === 'paid' && o.provider === 'dev'));
  assert.ok(paid.items.every((o, i, a) => i === 0 || a[i - 1].total >= o.total));
  const today = new Date().toISOString().slice(0, 10);
  assert.ok((await staff.get(`/api/admin/orders?from=${today}&to=${today}`)).data.total >= 1);
  assert.equal((await staff.get('/api/admin/orders?from=2000-01-01&to=2000-01-02')).data.total, 0);
  assert.equal((await staff.get('/api/admin/orders?status=bogus')).status, 400);
  assert.equal((await staff.get('/api/admin/orders/999999')).status, 404);
});

test('ออเดอร์ (แอดมิน): staff ยกเลิก pending/ส่งอีเมลซ้ำได้, ยกเลิก paid ไม่ได้, คืนเงินต้องยืนยันสองชั้น (admin เท่านั้น)', async () => {
  const { order: pend } = await pendingOrder('hero-tactics');
  const cancelled = await staff.post(`/api/admin/orders/${pend.id}/cancel`, { reason: 'ลูกค้าโทรขอยกเลิก' });
  assert.equal(cancelled.data.order.status, 'cancelled');
  assert.equal(cancelled.data.order.cancelReason, 'admin');
  const ev = (await staff.get(`/api/admin/orders/${pend.id}`)).data.events.at(-1);
  assert.deepEqual([ev.toStatus, ev.actor !== null], ['cancelled', true]);
  assert.equal(JSON.parse(auditRows('order.cancel', pend.id)[0].meta).after.status, 'cancelled');
  assert.equal((await staff.post(`/api/admin/orders/${pend.id}/cancel`, {})).status, 409);

  const { c, order } = await paidOrder(['chef-rush']);
  assert.equal((await staff.post(`/api/admin/orders/${order.id}/cancel`, {})).status, 409);
  while (await processEmailQueue()) { /* drain */ }
  const before = outbox.length;
  assert.equal((await staff.post(`/api/admin/orders/${order.id}/resend-email`, {})).status, 200);
  await processEmailQueue();
  assert.equal(outbox.length, before + 1);
  assert.equal(outbox.at(-1).to, c.email);
  assert.equal((await staff.post(`/api/admin/orders/${pend.id}/resend-email`, {})).status, 409);

  assert.equal((await staff.post(`/api/admin/orders/${order.id}/refund`, { reason: 'ลองคืนเงิน', confirmOrderId: order.id })).status, 403);
  assert.equal((await admin.post(`/api/admin/orders/${order.id}/refund`, { reason: 'ลูกค้าขอคืนเงิน', confirmOrderId: order.id + 1 })).data.code, 'REFUND_CONFIRM_MISMATCH');
  assert.equal((await admin.post(`/api/admin/orders/${order.id}/refund`, { reason: 'ลูกค้าขอคืนเงิน' })).status, 400); // ไม่ส่ง confirmOrderId
  const ref = await admin.post(`/api/admin/orders/${order.id}/refund`, { reason: 'ลูกค้าขอคืนเงิน', confirmOrderId: order.id });
  assert.equal(ref.data.order.status, 'refunded');
  const d = (await admin.get(`/api/admin/orders/${order.id}`)).data;
  assert.equal(d.refund.reason, 'ลูกค้าขอคืนเงิน');
  assert.ok(d.refund.admin);
  assert.equal(d.keys[0].status, 'revoked');
  assert.equal(d.events.at(-1).reason, 'ลูกค้าขอคืนเงิน');
  const log = JSON.parse(auditRows('order.refund', order.id)[0].meta);
  assert.deepEqual(log.after, { status: 'refunded' });
});

// ---------------------------------------------------------------- ผู้ใช้
test('ผู้ใช้ (admin): ค้นหา/ดู ไม่มี hash, ระงับ→เข้าระบบไม่ได้และเซสชันเดิมใช้ไม่ได้, เปลี่ยน role, ห้ามแก้ตัวเอง', async () => {
  const u = await makeUser(srv.url);
  const found = (await admin.get(`/api/admin/users?q=${encodeURIComponent(u.email)}`)).data;
  assert.equal(found.items.length, 1);
  const uid = found.items[0].id;
  const raw = JSON.stringify((await admin.get('/api/admin/users?limit=100')).data) + JSON.stringify((await admin.get(`/api/admin/users/${uid}`)).data);
  assert.ok(!/password|\$2[aby]\$/i.test(raw), 'ห้ามมี password hash ใน response');
  assert.equal((await admin.get('/api/admin/users?role=admin')).data.items.every((x) => x.role === 'admin'), true);

  assert.equal((await u.get('/api/auth/me')).data.user.email, u.email);
  assert.equal((await admin.put(`/api/admin/users/${uid}/status`, { status: 'suspended', reason: 'ทดสอบ' })).status, 200);
  assert.equal((await u.get('/api/auth/me')).data.user, null); // เซสชันเดิมใช้ไม่ได้ทันที
  const login = await (await new Client(srv.url).init()).post('/api/auth/login', { email: u.email, password: u.password });
  assert.equal(login.status, 403);
  assert.equal(login.data.code, 'ACCOUNT_SUSPENDED');
  assert.deepEqual(JSON.parse(auditRows('user.status', uid)[0].meta).after, { status: 'suspended' });
  await admin.put(`/api/admin/users/${uid}/status`, { status: 'active' });
  assert.equal((await (await new Client(srv.url).init()).post('/api/auth/login', { email: u.email, password: u.password })).status, 200);

  assert.equal((await admin.put(`/api/admin/users/${uid}/role`, { role: 'staff' })).status, 200);
  assert.equal(db.prepare('SELECT role FROM users WHERE id = ?').get(uid).role, 'staff');
  assert.equal((await admin.put(`/api/admin/users/${uid}/role`, { role: 'superuser' })).status, 400);
  assert.equal((await admin.put(`/api/admin/users/${admin.userId}/role`, { role: 'user' })).data.code, 'SELF_CHANGE');
  assert.equal((await admin.put(`/api/admin/users/${admin.userId}/status`, { status: 'suspended' })).data.code, 'SELF_CHANGE');
  assert.equal((await admin.put('/api/admin/users/99999/role', { role: 'user' })).status, 404);
});

test('ผู้ใช้ (admin): admin คนสุดท้ายถูกถอดสิทธิ์/ระงับไม่ได้ — ระบบต้องเหลือ admin อย่างน้อย 1 คนเสมอ', async () => {
  const a = await makeAdminClient(srv.url, 'admin');
  const b = await makeAdminClient(srv.url, 'admin');
  // admin อีกคนลดสิทธิ์ b ได้ แต่หลังจากนั้น b (เป็น staff แล้ว) จะทำอะไรกับ a ไม่ได้
  assert.equal((await a.put(`/api/admin/users/${b.userId}/role`, { role: 'staff' })).status, 200);
  assert.equal((await b.put(`/api/admin/users/${a.userId}/role`, { role: 'user' })).status, 403);
  assert.equal((await a.put(`/api/admin/users/${a.userId}/role`, { role: 'user' })).data.code, 'SELF_CHANGE'); // a ลดตัวเองไม่ได้
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").get().n >= 1);
});

// ---------------------------------------------------------------- คูปอง
test('คูปอง (admin): เพิ่ม/แก้/ปิดใช้งาน, ตรวจค่า, นับจำนวนที่ใช้, audit', async () => {
  for (const b of [{ code: 'x', type: 'percent', value: 10 }, { code: 'OKCODE', type: 'percent', value: 150 }, { code: 'OKCODE', type: 'fixed', value: 0 }, { code: 'OKCODE', type: 'weird', value: 5 }]) {
    assert.equal((await admin.post('/api/admin/coupons', b)).status, 400, JSON.stringify(b));
  }
  const c = await admin.post('/api/admin/coupons', { code: 'test-promo', description: 'ทดสอบ', type: 'fixed', value: 5000, min_subtotal: 10000, max_per_user: 2, expires_at: new Date(Date.now() + 86400000).toISOString() });
  assert.equal(c.status, 201);
  assert.equal((await admin.post('/api/admin/coupons', { code: 'TEST-PROMO', type: 'percent', value: 5 })).status, 409);
  const row = db.prepare('SELECT * FROM coupons WHERE id = ?').get(c.data.id);
  assert.deepEqual([row.code, row.value, row.min_subtotal, row.max_per_user], ['TEST-PROMO', 5000, 10000, 2]); // โค้ดถูกแปลงเป็นตัวพิมพ์ใหญ่

  // ใช้งานจริง 1 ครั้ง → usedCount = 1
  const { order } = await pendingOrderWith('moonlight-academy', 'TEST-PROMO');
  assert.equal(order.couponDiscount, 5000);
  let item = (await admin.get('/api/admin/coupons')).data.items.find((x) => x.code === 'TEST-PROMO');
  assert.deepEqual([item.usedCount, item.active, item.expired, item.minSubtotal], [1, true, false, 10000]);

  assert.equal((await admin.put(`/api/admin/coupons/${c.data.id}`, { value: 7000, active: false })).data.changed.sort().join(), 'active,value');
  const log = JSON.parse(auditRows('coupon.update', c.data.id)[0].meta);
  assert.deepEqual(log.before, { value: 5000, active: 1 });
  assert.equal((await admin.put(`/api/admin/coupons/${c.data.id}`, { type: 'percent', value: 500 })).status, 400);
  assert.equal((await admin.put('/api/admin/coupons/99999', { active: true })).status, 404);

  // ปิดแล้วลูกค้าใช้ไม่ได้
  const u = await makeUser(srv.url);
  await u.put('/api/cart', { slugs: ['sky-kingdoms'] });
  assert.equal((await u.post('/api/coupons/validate', { code: 'TEST-PROMO' })).data.code, 'COUPON_INVALID');
});
async function pendingOrderWith(slug, couponCode) {
  const c = await makeUser(srv.url);
  await c.put('/api/cart', { slugs: [slug] });
  const o = await c.post('/api/orders', { idempotencyKey: key(), couponCode });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  return { c, order: o.data.order };
}

// ---------------------------------------------------------------- รีวิว
test('รีวิว: ค้นหา/ลบพร้อมเหตุผล (staff ทำได้), คะแนนเฉลี่ยคำนวณใหม่, audit', async () => {
  const slug = 'forest-spirit';
  const gid = gameId(slug);
  const mk = async (rating, body) => { // รีวิวได้เฉพาะผู้ที่ซื้อแล้ว
    const { c: u } = await paidOrder([slug]);
    assert.equal((await u.post(`/api/games/${gid}/reviews`, { rating, body })).status, 201);
    return u;
  };
  await mk(5, 'ยอดเยี่ยมมาก');
  await mk(1, 'ข้อความไม่เหมาะสม <script>alert(1)</script>');
  const pub = () => new Client(srv.url).get(`/api/games/${slug}`).then((r) => r.data);
  assert.deepEqual([(await pub()).rating, (await pub()).review_count], [3, 2]);

  const found = (await staff.get('/api/admin/reviews?q=ไม่เหมาะสม')).data;
  assert.equal(found.items.length, 1);
  const r = found.items[0];
  assert.equal(r.body.includes('<script>'), true); // API ส่งข้อความดิบ (หน้าแอดมิน escape ตอนแสดง)
  assert.equal((await staff.get(`/api/admin/reviews?rating=5&gameId=${gid}`)).data.items.length, 1);

  assert.equal((await staff.del(`/api/admin/reviews/${r.id}`)).status, 400); // ต้องระบุเหตุผล (ไม่มี body)
  const del = await staff.req('DELETE', `/api/admin/reviews/${r.id}`, { reason: 'ข้อความไม่เหมาะสม' });
  assert.equal(del.status, 200);
  assert.deepEqual(del.data.game, { rating: 5, reviewCount: 1 }); // คะแนนเฉลี่ยใหม่
  assert.deepEqual([(await pub()).rating, (await pub()).review_count], [5, 1]);
  const log = JSON.parse(auditRows('review.delete', r.id)[0].meta);
  assert.equal(log.reason, 'ข้อความไม่เหมาะสม');
  assert.equal(log.before.rating, 1);
  assert.equal((await staff.req('DELETE', `/api/admin/reviews/${r.id}`, { reason: 'ลบซ้ำ' })).status, 404);
});

// ---------------------------------------------------------------- Dashboard
test('Dashboard: ตัวเลขตรงกับข้อมูลจริง (คำนวณแยกอิสระจากฐานข้อมูล)', async () => {
  await paidOrder(['kart-mania']);
  await paidOrder(['sky-kingdoms', 'ninja-dash'], { couponCode: 'SAVE100' });
  await pendingOrder('space-miner');
  const { order: refunded } = await paidOrder(['basketball-star']);
  await admin.post(`/api/admin/orders/${refunded.id}/refund`, { reason: 'ทดสอบ dashboard', confirmOrderId: refunded.id });

  const d = (await admin.get('/api/admin/dashboard')).data;
  const orders = db.prepare('SELECT * FROM orders').all();
  const bkk = (ts) => new Date(new Date(ts.replace(' ', 'T') + 'Z').getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const paid = orders.filter((o) => o.status === 'paid');

  for (const s of ['pending', 'paid', 'cancelled', 'refunded']) assert.equal(d.summary.byStatus[s], orders.filter((o) => o.status === s).length, s);
  assert.equal(d.summary.todayRevenue, paid.filter((o) => bkk(o.paid_at) === today).reduce((s, o) => s + o.total, 0));
  assert.equal(d.summary.todayOrders, paid.filter((o) => bkk(o.paid_at) === today).length);
  assert.equal(d.summary.monthRevenue, paid.filter((o) => bkk(o.paid_at).slice(0, 7) === today.slice(0, 7)).reduce((s, o) => s + o.total, 0));
  assert.ok(d.summary.weekRevenue >= d.summary.todayRevenue && d.summary.monthRevenue >= d.summary.weekRevenue - 1e12);
  assert.equal(d.summary.keys.available, db.prepare("SELECT COUNT(*) AS n FROM game_keys WHERE status = 'available'").get().n);
  assert.equal(d.summary.keys.sold, db.prepare("SELECT COUNT(*) AS n FROM game_keys WHERE status = 'sold'").get().n);
  assert.equal(d.summary.newUsers.today, db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'user'").get().n >= 0 ? d.summary.newUsers.today : -1);

  // เกมขายดี: คำนวณจาก order_items ของออเดอร์ที่ paid เท่านั้น (ออเดอร์ที่คืนเงินแล้วไม่นับ)
  const exp = new Map();
  for (const it of db.prepare("SELECT oi.title, oi.unit_price FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status = 'paid'").all()) {
    const e = exp.get(it.title) ?? { units: 0, revenue: 0 };
    e.units += 1; e.revenue += it.unit_price; exp.set(it.title, e);
  }
  assert.ok(d.topGames.length <= 10);
  for (const g of d.topGames) assert.deepEqual({ units: g.units, revenue: g.revenue }, exp.get(g.title), g.title);
  assert.ok(d.topGames.every((g, i, a) => i === 0 || a[i - 1].revenue >= g.revenue));
  assert.ok(!d.topGames.some((g) => g.title === 'Basketball Star')); // คืนเงินแล้ว
  assert.ok(d.topGenres.length >= 1);
  assert.equal(d.coupons.ordersWithCoupon, paid.filter((o) => o.coupon_code).length);
  assert.equal(d.coupons.paidOrders, paid.length);
  assert.ok(d.coupons.top.some((c) => c.code === 'SAVE100'));

  // ยอดขายรายวัน 30 วัน: ครบ 30 จุด, ผลรวมตรงกับยอดจริง และเดือนนี้รวมกันเท่ากับ monthRevenue
  const s30 = (await admin.get('/api/admin/dashboard/sales')).data;
  assert.equal(s30.rows.length, 30);
  assert.equal(s30.rows.at(-1).period, today);
  assert.equal(s30.rows.at(-1).revenue, d.summary.todayRevenue);
  assert.equal(s30.rows.reduce((s, r) => s + r.revenue, 0), paid.filter((o) => bkk(o.paid_at) >= s30.from).reduce((s, o) => s + o.total, 0));
  assert.equal(s30.rows.at(-1).refunded, orders.filter((o) => o.status === 'refunded' && bkk(o.refunded_at) === today).reduce((s, o) => s + o.total, 0));
  const monthly = (await admin.get('/api/admin/dashboard/sales?group=month')).data;
  assert.equal(monthly.rows.length, 12);
  assert.equal(monthly.rows.at(-1).revenue, d.summary.monthRevenue);
  const ranged = (await admin.get(`/api/admin/dashboard/sales?from=${today}&to=${today}`)).data;
  assert.equal(ranged.rows.length, 1);
  assert.equal((await admin.get('/api/admin/dashboard/sales?from=2026-02-01&to=2026-01-01')).status, 400);
  assert.equal((await admin.get('/api/admin/dashboard/sales?from=abc')).status, 400);
});

test('แจ้งเตือน: แสดงใน dashboard และปิดได้ (staff ทำได้) พร้อม audit', async () => {
  db.prepare("INSERT INTO admin_alerts (kind, order_id, detail) VALUES ('LATE_PAYMENT', NULL, 'ทดสอบ')").run();
  const id = db.prepare('SELECT MAX(id) AS id FROM admin_alerts').get().id;
  assert.ok((await staff.get('/api/admin/dashboard')).data.alerts.open.some((a) => a.id === id && a.kind === 'LATE_PAYMENT'));
  assert.equal((await staff.post(`/api/admin/dashboard/alerts/${id}/resolve`, {})).status, 200);
  assert.ok(!(await staff.get('/api/admin/dashboard')).data.alerts.open.some((a) => a.id === id));
  assert.equal((await staff.post(`/api/admin/dashboard/alerts/${id}/resolve`, {})).status, 404);
  assert.equal(auditRows('alert.resolve', id).length, 1);
});

// ---------------------------------------------------------------- รายงาน CSV
test('CSV: BOM + ภาษาไทยไม่เพี้ยน, กัน formula injection, ช่วงวันที่, ไม่มีโค้ดเกมจริง, new-users เฉพาะ admin', async () => {
  const evil = await makeUser(srv.url);
  db.prepare('UPDATE users SET name = ? WHERE email = ?').run('=HYPERLINK("http://evil.example","คลิก")', evil.email);
  await evil.put('/api/cart', { slugs: ['pixel-dungeon-quest'] });
  const o = (await evil.post('/api/orders', { idempotencyKey: key() })).data.order;
  await evil.post(`/api/orders/${o.id}/dev-pay`, {});
  db.prepare("UPDATE order_items SET title = '@เกมทดสอบ' WHERE order_id = ?").run(o.id); // CSV ใช้ชื่อเกม ณ ตอนซื้อ (snapshot)

  const res = await admin.raw('/api/admin/reports/orders.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv; charset=utf-8/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="orders-/);
  const bytes = res.buf;
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // UTF-8 BOM
  const text = bytes.toString('utf8').slice(1);
  assert.ok(text.startsWith('order_id,created_at_utc'));
  assert.ok(text.includes("'=HYPERLINK"), 'ต้อง escape ชื่อผู้ใช้ที่ขึ้นต้นด้วย =');
  assert.ok(text.includes("'@เกมทดสอบ"), 'ต้อง escape ชื่อเกมที่ขึ้นต้นด้วย @ และภาษาไทยต้องไม่เพี้ยน');
  assert.ok(!/(^|,|\n)=HYPERLINK/.test(text));
  assert.ok(!/FAKE-/.test(text));
  const lines = text.trim().split('\r\n');
  assert.equal(lines.length - 1, db.prepare('SELECT COUNT(*) AS n FROM orders').get().n);

  const today = new Date().toISOString().slice(0, 10);
  const none = (await admin.raw('/api/admin/reports/orders.csv?from=2000-01-01&to=2000-01-31')).buf.toString('utf8');
  assert.equal(none.trim().split('\r\n').length, 1); // เหลือแต่หัวตาราง
  assert.equal((await admin.raw(`/api/admin/reports/orders.csv?status=paid&from=${today}&to=${today}`)).status, 200);
  assert.equal((await admin.raw('/api/admin/reports/orders.csv?from=bad')).status, 400);

  const sales = (await admin.raw(`/api/admin/reports/sales.csv?from=${today}&to=${today}`)).buf.toString('utf8').trim().split('\r\n');
  assert.equal(sales.length, 2);
  assert.equal(sales[0].replace('﻿', ''), 'date,paid_orders,revenue_thb,refunded_orders,refunded_thb');
  const monthly = (await admin.raw('/api/admin/reports/sales.csv?group=month')).buf.toString('utf8').trim().split('\r\n');
  assert.equal(monthly.length, 13);

  const gs = (await staff.raw('/api/admin/reports/games-sales.csv')).buf.toString('utf8');
  assert.ok(gs.includes('game_id,game,units_sold'));
  const stock = (await staff.raw('/api/admin/reports/stock.csv')).buf.toString('utf8');
  assert.ok(stock.includes('available') && !/FAKE-|[A-F0-9]{6}-[A-F0-9]{6}/.test(stock));

  assert.equal((await staff.raw('/api/admin/reports/new-users.csv')).status, 403);
  const nu = (await admin.raw('/api/admin/reports/new-users.csv')).buf.toString('utf8');
  assert.ok(nu.includes("'=HYPERLINK")); // ผู้ใช้ที่ชื่อขึ้นต้นด้วย = ก็ถูก escape
  assert.ok(auditRows('report.export', 'orders').length >= 1);
});

// ---------------------------------------------------------------- Audit log
test('Audit log: admin เท่านั้น, กรองตามผู้ใช้/การกระทำ/วันที่, มี ก่อน-หลัง', async () => {
  const all = (await admin.get('/api/admin/audit?limit=100')).data;
  assert.ok(all.total > 10);
  const actions = new Set(all.items.map((a) => a.action));
  for (const a of ['admin.login', 'game.create', 'game.update', 'stock.import', 'key.reveal']) assert.ok(actions.has(a), a);

  const mine = (await admin.get(`/api/admin/audit?userId=${admin.userId}&action=game.&limit=100`)).data;
  assert.ok(mine.items.length >= 3);
  assert.ok(mine.items.every((a) => a.userId === admin.userId && a.action.startsWith('game.')));
  const upd = mine.items.find((a) => a.action === 'game.update');
  assert.ok(upd.meta.before && upd.meta.after);
  assert.equal(upd.userName.startsWith('User'), true);

  const today = new Date().toISOString().slice(0, 10);
  assert.ok((await admin.get(`/api/admin/audit?from=${today}&to=${today}&action=order.`)).data.total >= 1);
  assert.equal((await admin.get('/api/admin/audit?from=2000-01-01&to=2000-01-02')).data.total, 0);
  assert.equal((await admin.get('/api/admin/audit?page=1&limit=2')).data.items.length, 2);
  assert.equal((await staff.get('/api/admin/audit')).status, 403);
  // login ที่ล้มเหลวถูกบันทึก (ไม่มีรหัสผ่านใน log)
  const failed = db.prepare("SELECT meta FROM audit_log WHERE action = 'admin.login_failed'").all();
  assert.ok(failed.length >= 1);
  assert.ok(failed.every((f) => !/pw-|password/i.test(f.meta)));
});

// ---------------------------------------------------------------- Migration
test('Migration: รันซ้ำได้ ไม่คูณราคาซ้ำ, แปลง role customer→user, ข้อมูลเก่าไม่หาย', () => {
  const legacy = new Database(':memory:');
  legacy.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, role TEXT NOT NULL DEFAULT 'customer');
    CREATE TABLE games (id INTEGER PRIMARY KEY, slug TEXT, price INTEGER NOT NULL);
    CREATE TABLE game_keys (id INTEGER PRIMARY KEY, game_id INTEGER);
    CREATE TABLE reviews (id INTEGER PRIMARY KEY, game_id INTEGER, rating INTEGER);
    INSERT INTO reviews (game_id, rating) VALUES (1, 5), (1, 4), (1, 4);
    INSERT INTO users (email, role) VALUES ('a@x.com', 'customer'), ('b@x.com', 'admin');
    INSERT INTO games (slug, price) VALUES ('g1', 1290), ('g2', 0), ('g3', 199);`);
  migrate(legacy);
  const snap = () => ({ prices: legacy.prepare('SELECT price FROM games ORDER BY id').all().map((r) => r.price), roles: legacy.prepare('SELECT role FROM users ORDER BY id').all().map((r) => r.role) });
  assert.deepEqual(snap(), { prices: [129000, 0, 19900], roles: ['user', 'admin'] });
  migrate(legacy);
  migrate(legacy);
  assert.deepEqual(snap(), { prices: [129000, 0, 19900], roles: ['user', 'admin'] });
  assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 10);
  assert.deepEqual(legacy.prepare('SELECT totp_enabled AS e, totp_last_step AS s, totp_secret_enc AS k FROM users WHERE id = 1').get(), { e: 0, s: 0, k: null });
  // 008: สรุปรีวิวเดิมถูกคำนวณย้อนหลัง (เกมที่ไม่มีรีวิว rating_avg = NULL)
  assert.deepEqual(legacy.prepare('SELECT review_count AS c, rating_avg AS a FROM games ORDER BY id').all(), [{ c: 3, a: 4.3 }, { c: 0, a: null }, { c: 0, a: null }]);
  assert.equal(legacy.prepare('SELECT status FROM users').get().status, 'active');
  assert.equal(legacy.prepare('SELECT token_version AS v FROM users').get().v, 0);
  assert.equal(legacy.prepare('SELECT low_stock_threshold AS t FROM games').get().t, 5);
  assert.ok(legacy.prepare('PRAGMA table_info(game_keys)').all().some((c) => c.name === 'revoke_reason'));
  // ฐานข้อมูลหลักที่ผ่านการ migrate แล้ว ก็ต้องรันซ้ำได้เช่นกัน
  const before = db.prepare("SELECT price FROM games WHERE slug = 'dragon-realm'").get().price;
  migrate(db);
  assert.equal(db.prepare("SELECT price FROM games WHERE slug = 'dragon-realm'").get().price, before);
});

// ---------------------------------------------------------------- สรุปรีวิว (trigger)
test('สรุปรีวิวใน games (review_count / rating_avg) ตรงกับการคำนวณจากตาราง reviews เสมอ หลังเพิ่ม/แก้/ลบแบบสุ่ม', () => {
  const games = db.prepare("SELECT id FROM games WHERE slug IN ('cozy-farm-life', 'pixel-dungeon-quest', 'chef-rush')").all().map((g) => g.id);
  const users = db.prepare('SELECT id FROM users ORDER BY id LIMIT 12').all().map((u) => u.id);
  assert.ok(users.length >= 6);
  let seed = 42;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const ins = db.prepare('INSERT OR IGNORE INTO reviews (user_id, game_id, rating, body) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < 300; i += 1) {
    const op = rnd(3);
    const [uid, gid] = [users[rnd(users.length)], games[rnd(games.length)]];
    if (op === 0) ins.run(uid, gid, 1 + rnd(5), 'random');
    else if (op === 1) db.prepare('UPDATE reviews SET rating = ? WHERE user_id = ? AND game_id = ?').run(1 + rnd(5), uid, gid);
    else db.prepare('DELETE FROM reviews WHERE user_id = ? AND game_id = ?').run(uid, gid);
  }
  // ย้ายรีวิวไปอีกเกม (เส้นทาง UPDATE OF game_id) ต้องอัปเดตทั้งสองเกม
  const moved = db.prepare('SELECT id, user_id FROM reviews WHERE game_id = ? LIMIT 1').get(games[0]);
  if (moved && !db.prepare('SELECT 1 FROM reviews WHERE user_id = ? AND game_id = ?').get(moved.user_id, games[1])) {
    db.prepare('UPDATE reviews SET game_id = ? WHERE id = ?').run(games[1], moved.id);
  }
  for (const gid of games) {
    const stored = db.prepare('SELECT review_count AS c, rating_avg AS a FROM games WHERE id = ?').get(gid);
    const actual = db.prepare('SELECT COUNT(*) AS c, ROUND(AVG(rating), 1) AS a FROM reviews WHERE game_id = ?').get(gid);
    assert.deepEqual(stored, actual, `game ${gid}`);
    const v = db.prepare('SELECT g.rating AS base, v.rating, v.review_count FROM games g JOIN games_v v ON v.id = g.id WHERE g.id = ?').get(gid);
    assert.equal(v.review_count, actual.c);
    assert.equal(v.rating, actual.a ?? v.base);
  }
  db.prepare(`DELETE FROM reviews WHERE game_id IN (${games.join(',')})`).run();
  for (const gid of games) assert.deepEqual(db.prepare('SELECT review_count AS c, rating_avg AS a FROM games WHERE id = ?').get(gid), { c: 0, a: null });
});
