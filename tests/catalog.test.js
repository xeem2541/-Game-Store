import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, makeUser, startServer } from './helpers.js';

const { db } = await import('../server/db/index.js');
const { bangkokYear, expirePending } = await import('../server/services/orders.js');
const { likeArg, escHtml, slugify } = await import('../server/services/text.js');
const { formatBaht } = await import('../server/services/pricing.js');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.server.close());

const get = async (p) => (await new Client(srv.url).get(p)).data;
const raw = (p) => new Client(srv.url).raw(p);
const key = () => `key-${Math.random().toString(36).slice(2)}-${Date.now()}`;

test('รายการเกม: กรอง/เรียง/แบ่งหน้า และไม่แสดงเกมที่ซ่อน', async () => {
  const all = await get('/api/games?limit=60');
  assert.ok(all.total >= 30);
  assert.ok(all.items.every((g) => g.active === 1 && g.finalPrice <= g.price && g.cover.endsWith('/cover.svg')));

  const p1 = await get('/api/games?limit=5&page=1&sort=priceAsc');
  const p2 = await get('/api/games?limit=5&page=2&sort=priceAsc');
  assert.equal(p1.items.length, 5);
  assert.equal(p1.pages, Math.ceil(all.total / 5));
  assert.ok(p1.items.at(-1).finalPrice <= p2.items[0].finalPrice);
  assert.equal(new Set([...p1.items, ...p2.items].map((g) => g.id)).size, 10, 'หน้าไม่ซ้อนกัน');

  const ps5 = await get('/api/games?platform=PS5&limit=60');
  assert.ok(ps5.total > 0 && ps5.items.every((g) => g.platform === 'PS5'));
  const sale = await get('/api/games?onSale=1&limit=60&sort=discount');
  assert.ok(sale.items.every((g, i, a) => g.discount > 0 && (i === 0 || a[i - 1].discount >= g.discount)));
  const range = await get('/api/games?minPrice=50000&maxPrice=100000&limit=60');
  assert.ok(range.items.every((g) => g.finalPrice >= 50000 && g.finalPrice <= 100000));

  db.prepare("UPDATE games SET active = 0 WHERE slug = 'football-pro-26'").run();
  try {
    assert.ok(!(await get('/api/games?q=Football&limit=60')).items.length);
    assert.equal((await raw('/api/games/football-pro-26')).status, 404);
  } finally {
    db.prepare("UPDATE games SET active = 1 WHERE slug = 'football-pro-26'").run();
  }
  assert.equal((await raw('/api/games?sort=hack')).status, 400);
});

test('ค้นหา: % และ _ ถูกค้นเป็นตัวอักษรจริง ไม่ใช่ wildcard ของ LIKE', async () => {
  assert.equal((await get('/api/games?q=Dragon')).items[0].slug, 'dragon-realm');
  assert.equal((await get('/api/games?q=%25')).total, 0, '% ต้องไม่จับทุกเกม');
  assert.equal((await get('/api/games?q=_')).total, 0, '_ ต้องไม่จับทุกเกม');
  assert.deepEqual(await get('/api/games/suggest?q=%25'), []);
  assert.deepEqual(await get('/api/games/suggest?q='), []);
  const s = await get('/api/games/suggest?q=legend');
  assert.ok(s.length > 0 && s.length <= 6 && s.every((g) => /legend/i.test(g.title) && g.slug && g.genre));

  assert.equal(likeArg('50%_a\\b'), '%50\\%\\_a\\\\b%');
});

test('ตัวกรอง (facets), หน้าแรก และรายละเอียดเกม', async () => {
  const f = await get('/api/games/facets');
  assert.ok(f.genres.includes('RPG') && f.platforms.includes('Switch'));
  assert.deepEqual(f.platforms, [...f.platforms].sort());

  const home = await get('/api/games/home');
  for (const k of ['featured', 'bestsellers', 'newest', 'onSale']) assert.ok(home[k].length > 0 && home[k].length <= 8, k);
  assert.ok(home.featured.every((g) => g.featured === 1));
  assert.ok(home.onSale.every((g) => g.discount > 0));

  const g = await get('/api/games/dragon-realm');
  assert.equal(g.finalPrice, 90300);
  assert.ok(g.related.length <= 4 && g.related.every((r) => r.genre === g.genre && r.id !== g.id));
  assert.ok(Array.isArray(g.images));
  assert.equal((await raw('/api/games/no-such-game')).status, 404);
});

test('ภาพปก SVG: escape ชื่อเกม, แคชได้, ไม่พบเกม = 404', async () => {
  const id = db.prepare("INSERT INTO games (slug, title, description, genre, platform, price, discount, color1, color2, release_date) VALUES ('xss-cover', '<script>alert(1)</script> & Co', 'd', 'RPG', 'PC', 1000, 0, '#000000', '#ffffff', '2024-01-01')").run().lastInsertRowid;
  try {
    const r = await raw('/api/games/xss-cover/cover.svg');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(r.headers.get('cache-control'), /max-age=86400/);
    const svg = r.buf.toString();
    assert.ok(!svg.includes('<script>') && svg.includes('&lt;script&gt;') && svg.includes('&amp; Co'));
  } finally {
    db.prepare('DELETE FROM games WHERE id = ?').run(id);
  }
  assert.equal((await raw('/api/games/nope/cover.svg')).status, 404);
});

test('รูป Open Graph: PNG 1200x630 ของหน้าแรก/เกม, ชื่อไฟล์ผิดรูปแบบหรือเกมไม่มี = 404, แคชผลลัพธ์', async () => {
  const sharp = (await import('sharp')).default;
  for (const p of ['/og/default.png', '/og/dragon-realm.png']) {
    const r = await raw(p);
    assert.equal(r.status, 200, p);
    assert.equal(r.headers.get('content-type'), 'image/png');
    const meta = await sharp(r.buf).metadata();
    assert.deepEqual([meta.width, meta.height], [1200, 630]);
  }
  const again = await raw('/og/dragon-realm.png');
  assert.ok(again.buf.equals((await raw('/og/dragon-realm.png')).buf));
  assert.equal((await raw('/og/no-such-game.png')).status, 404);
  assert.equal((await raw('/og/..%2Fsecret.png')).status, 404);
  assert.equal((await raw('/og/Dragon.png')).status, 404);
});

test('หน้าเกม: meta SEO มีราคาและรูป OG, เกมที่ไม่มี = 404 noindex', async () => {
  const ok = await raw('/game/dragon-realm');
  assert.equal(ok.status, 200);
  const html = ok.buf.toString();
  assert.match(html, /<title>[^<]*Dragon Realm/);
  assert.match(html, /og:image" content="[^"]*\/og\/dragon-realm\.png/);
  const missing = await raw('/game/%3Cscript%3E');
  assert.equal(missing.status, 404);
  assert.ok(!missing.buf.toString().includes('<script>alert'));
});

test('ตัวช่วยข้อความ/เงินที่ใช้ร่วมกัน', () => {
  assert.equal(escHtml(`<a href='x'>"&"</a>`), '&lt;a href=&#39;x&#39;&gt;&quot;&amp;&quot;&lt;/a&gt;');
  assert.equal(escHtml(null), '');
  assert.equal(slugify('  Dragon Realm: Origins!! '), 'dragon-realm-origins');
  assert.equal(formatBaht(90300), '฿903');
  assert.equal(formatBaht(90350), '฿903.50');
  assert.equal(formatBaht(123456700, 'th-TH'), '฿1,234,567');
});

test('เลขที่ใบเสร็จใช้ปีตามเวลาไทย ไม่ใช่เวลาเครื่อง (ช่วงข้ามปี)', () => {
  assert.equal(bangkokYear(Date.parse('2025-12-31T16:59:59Z')), 2025); // 23:59:59 เวลาไทย
  assert.equal(bangkokYear(Date.parse('2025-12-31T17:00:00Z')), 2026); // 00:00 1 ม.ค. เวลาไทย (UTC ยังเป็นปี 2025)
});

test('ประวัติคำสั่งซื้อ: ชื่อเกมถูกจับคู่กับออเดอร์ถูกต้อง (query เดียว) และออเดอร์ที่เลยเวลาแสดงเป็นยกเลิกทันที', async () => {
  const c = await makeUser(srv.url);
  const other = await makeUser(srv.url);
  const mk = async (u, slugs) => { await u.put('/api/cart', { slugs }); return (await u.post('/api/orders', { idempotencyKey: key() })).data.order; };
  const o1 = await mk(c, ['ocean-explorer', 'space-miner']);
  const o2 = await mk(c, ['hero-tactics']);
  const theirs = await mk(other, ['forest-spirit']);

  db.prepare('UPDATE orders SET expires_at = ? WHERE id IN (?, ?)').run(Date.now() - 1000, o1.id, theirs.id);
  const list = (await c.get('/api/me/orders')).data;
  const byId = Object.fromEntries(list.items.map((o) => [o.id, o]));
  assert.deepEqual(byId[o1.id].titles, ['Ocean Explorer', 'Space Miner']);
  assert.deepEqual(byId[o2.id].titles, ['Hero Tactics']);
  assert.equal(byId[o1.id].status, 'cancelled', 'ไม่ต้องรอ job รอบถัดไป');
  assert.equal(byId[o2.id].status, 'pending');
  // การเปิดหน้าของผู้ใช้หนึ่งไม่ไปยกเลิกออเดอร์ของคนอื่น (job ทั้งระบบเป็นคนทำ)
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(theirs.id).status, 'pending');
  assert.ok(expirePending() >= 1);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(theirs.id).status, 'cancelled');
});

test('สรุปบัญชี /me/summary: นับคำสั่งซื้อ/คลังเกม/รายการโปรดถูกต้อง และไม่บันทึก audit การดูโค้ด', async () => {
  const c = await makeUser(srv.url);
  const empty = (await c.get('/api/me/summary')).data;
  assert.deepEqual(empty, { orders: 0, pendingOrders: 0, library: 0, wishlist: 0, emailVerified: true });

  await c.put('/api/cart', { slugs: ['tower-defense-legends', 'chef-rush'] });
  const paid = (await c.post('/api/orders', { idempotencyKey: key() })).data.order;
  await c.post(`/api/orders/${paid.id}/dev-pay`, {});
  await c.put('/api/cart', { slugs: ['puzzle-palace'] });
  await c.post('/api/orders', { idempotencyKey: key() });
  const gid = db.prepare("SELECT id FROM games WHERE slug = 'sky-kingdoms'").get().id;
  await c.post('/api/wishlist', { gameId: gid });

  const s = (await c.get('/api/me/summary')).data;
  assert.deepEqual(s, { orders: 2, pendingOrders: 1, library: 2, wishlist: 1, emailVerified: true });
  const uid = db.prepare('SELECT user_id FROM orders WHERE id = ?').get(paid.id).user_id;
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'key.view' AND user_id = ?").get(uid).n, 0);
  assert.equal((await new Client(srv.url).get('/api/me/summary')).status, 401);
});
