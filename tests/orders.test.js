import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, outbox, startServer, tokenFrom } from './helpers.js';

const { db } = await import('../server/db/index.js');
const { seedCoupons } = await import('../server/db/seed.js');
const { expirePending, transition } = await import('../server/services/orders.js');

let srv;
before(async () => { srv = await startServer(); seedCoupons(); });
after(() => srv.server.close());

let n = 0;
async function makeUser({ verify = true } = {}) {
  const c = await new Client(srv.url).init();
  const email = `buyer${++n}@example.com`;
  const password = `pw-${Math.random().toString(36).slice(2)}-Aa1`;
  assert.equal((await c.post('/api/auth/register', { email, password, name: `Buyer ${n}` })).status, 201);
  if (verify) {
    const mail = [...outbox].reverse().find((m) => m.to === email);
    assert.equal((await c.get('/api/auth/verify?token=' + tokenFrom(mail))).status, 200);
  }
  return c;
}
const setCart = (c, slugs) => c.put('/api/cart', { slugs });
const key = () => `key-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const order = (c, body = {}) => c.post('/api/orders', { idempotencyKey: key(), ...body });

// ราคาอ้างอิง (สตางค์): dragon-realm 1290฿ -30% = 90300 | kart-mania 1490฿ -10% = 134100
const DRAGON = 90300;
const KART = 134100;

test('คำนวณราคา: ส่วนลดเกม + ยอดสุทธิ เป็นสตางค์จำนวนเต็ม', async () => {
  const c = await makeUser();
  await setCart(c, ['dragon-realm', 'kart-mania']);
  const s = (await c.get('/api/cart/summary')).data;
  assert.equal(s.subtotal, 129000 + 149000);
  assert.equal(s.gameDiscount, 129000 + 149000 - DRAGON - KART);
  assert.equal(s.couponDiscount, 0);
  assert.equal(s.total, DRAGON + KART);
  for (const v of [s.subtotal, s.gameDiscount, s.total, ...s.items.map((i) => i.unitPrice)]) assert.ok(Number.isInteger(v));
});

test('คูปอง: เปอร์เซ็นต์ / จำนวนคงที่ / ยอดขั้นต่ำ', async () => {
  const c = await makeUser();
  await setCart(c, ['dragon-realm', 'kart-mania']);
  const pct = await c.post('/api/coupons/validate', { code: 'welcome10' }); // ไม่สนตัวพิมพ์
  assert.equal(pct.status, 200);
  assert.equal(pct.data.summary.couponDiscount, Math.floor((DRAGON + KART) * 0.1));
  assert.equal(pct.data.summary.total, DRAGON + KART - Math.floor((DRAGON + KART) * 0.1));

  const fixed = await c.post('/api/coupons/validate', { code: 'SAVE100' });
  assert.equal(fixed.data.summary.couponDiscount, 10000);

  // ตะกร้าเล็กกว่าขั้นต่ำ ฿500 → ไม่ผ่าน (Retro Arcade Pack ฿199 -50% = ฿99.5)
  await setCart(c, ['retro-arcade-pack']);
  const low = await c.post('/api/coupons/validate', { code: 'SAVE100' });
  assert.equal(low.status, 422);
  assert.equal(low.data.code, 'COUPON_MIN');
});

test('คูปอง: ไม่มีโค้ด / หมดอายุ / ถูกปิด / ครบจำนวน / ครบต่อผู้ใช้', async () => {
  const c = await makeUser();
  await setCart(c, ['dragon-realm']);
  assert.equal((await c.post('/api/coupons/validate', { code: 'NOPE' })).data.code, 'COUPON_INVALID');
  assert.equal((await c.post('/api/coupons/validate', { code: 'EXPIRED20' })).data.code, 'COUPON_EXPIRED');

  db.prepare("INSERT INTO coupons (code, type, value, active) VALUES ('OFF1', 'percent', 5, 0)").run();
  assert.equal((await c.post('/api/coupons/validate', { code: 'OFF1' })).data.code, 'COUPON_INVALID');

  db.prepare("INSERT INTO coupons (code, type, value, max_uses) VALUES ('ONCE', 'percent', 5, 1)").run();
  const other = await makeUser();
  await setCart(other, ['kart-mania']);
  assert.equal((await order(other, { couponCode: 'ONCE' })).status, 201); // คนแรกใช้สิทธิ์ไป
  assert.equal((await c.post('/api/coupons/validate', { code: 'ONCE' })).data.code, 'COUPON_EXHAUSTED');

  // WELCOME10 จำกัดคนละ 1 ครั้ง
  assert.equal((await order(c, { couponCode: 'WELCOME10' })).status, 201);
  await setCart(c, ['sky-kingdoms']);
  assert.equal((await c.post('/api/coupons/validate', { code: 'WELCOME10' })).data.code, 'COUPON_USER_LIMIT');
});

test('สร้างออเดอร์: ต้องล็อกอินและยืนยันอีเมล, ตะกร้าว่างไม่ได้, key ต้องถูกต้อง', async () => {
  const anon = await new Client(srv.url).init();
  assert.equal((await order(anon)).status, 401);

  const unverified = await makeUser({ verify: false });
  await setCart(unverified, ['dragon-realm']);
  const r = await order(unverified);
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'EMAIL_NOT_VERIFIED');

  const c = await makeUser();
  assert.equal((await order(c)).data.code, 'CART_EMPTY');
  await setCart(c, ['dragon-realm']);
  assert.equal((await c.post('/api/orders', { idempotencyKey: 'short' })).status, 400);
  assert.equal((await c.post('/api/orders', {})).status, 400);
});

test('สร้างออเดอร์: snapshot ราคา, สถานะ pending, ราคาปลอมจากเบราว์เซอร์ไม่มีผล', async () => {
  const c = await makeUser();
  await setCart(c, ['dragon-realm', 'kart-mania']);
  const r = await c.post('/api/orders', {
    idempotencyKey: key(),
    // ข้อมูลปลอมที่เบราว์เซอร์อาจส่งมา — ต้องถูกเมินทั้งหมด
    total: 1, subtotal: 1, couponDiscount: 999999, items: [{ slug: 'dragon-realm', unitPrice: 1 }], price: 1,
  });
  assert.equal(r.status, 201);
  const o = r.data.order;
  assert.equal(o.status, 'pending');
  assert.equal(o.total, DRAGON + KART);
  assert.equal(o.items.length, 2);
  assert.equal(o.items[0].unitPrice, DRAGON);
  assert.ok(o.expiresAt > Date.now());

  // เปลี่ยนราคาเกมทีหลัง → ออเดอร์เก่าต้องไม่เปลี่ยน
  db.prepare("UPDATE games SET price = 500000, discount = 0 WHERE slug = 'dragon-realm'").run();
  const again = (await c.get(`/api/orders/${o.id}`)).data.order;
  assert.equal(again.total, DRAGON + KART);
  assert.equal(again.items[0].unitPrice, DRAGON);
  assert.equal(again.items[0].listPrice, 129000);
  assert.equal(again.items[0].discountPercent, 30);
  db.prepare("UPDATE games SET price = 129000, discount = 30 WHERE slug = 'dragon-realm'").run();
});

test('Idempotency: key เดิมได้ออเดอร์เดิม ไม่สร้างซ้ำ; ซื้อเกมที่รอชำระอยู่แล้วไม่ได้', async () => {
  const c = await makeUser();
  await setCart(c, ['dragon-realm']);
  const k = key();
  const first = await c.post('/api/orders', { idempotencyKey: k });
  const second = await c.post('/api/orders', { idempotencyKey: k });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.data.order.id, first.data.order.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders WHERE idempotency_key = ?').get(k).n, 1);

  const dup = await order(c); // key ใหม่ แต่เกมเดิมยังรอชำระ
  assert.equal(dup.status, 409);
  assert.equal(dup.data.code, 'PENDING_EXISTS');
});

test('ยกเลิก: เฉพาะ pending, คืนสิทธิ์คูปอง, ยกเลิกซ้ำไม่ได้', async () => {
  const c = await makeUser();
  await setCart(c, ['kart-mania']);
  const o = (await order(c, { couponCode: 'WELCOME10' })).data.order;
  assert.equal(o.couponDiscount, Math.floor(KART * 0.1));
  await setCart(c, ['sky-kingdoms']);
  assert.equal((await c.post('/api/coupons/validate', { code: 'WELCOME10' })).data.code, 'COUPON_USER_LIMIT');

  const cancelled = await c.post(`/api/orders/${o.id}/cancel`);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.order.status, 'cancelled');
  assert.equal((await c.post('/api/coupons/validate', { code: 'WELCOME10' })).status, 200); // สิทธิ์กลับมา
  assert.equal((await c.post(`/api/orders/${o.id}/cancel`)).status, 409);
});

test('ชำระแล้ว: ล้างตะกร้า, เข้าคลัง, ซื้อซ้ำไม่ได้, ยกเลิกไม่ได้', async () => {
  const c = await makeUser();
  await setCart(c, ['dragon-realm', 'sky-kingdoms']);
  const o = (await order(c)).data.order;
  const paid = await c.post(`/api/orders/${o.id}/dev-pay`);
  assert.equal(paid.data.order.status, 'paid');
  assert.ok(paid.data.order.paidAt);
  assert.equal((await c.get('/api/cart')).data.items.length, 0);
  assert.equal((await c.get('/api/me/library')).data.items.length, 2);

  await setCart(c, ['dragon-realm']);
  assert.equal((await order(c)).data.code, 'ALREADY_OWNED');
  assert.equal((await c.post(`/api/orders/${o.id}/cancel`)).status, 409);
  assert.equal((await c.post(`/api/orders/${o.id}/dev-pay`)).status, 409); // จ่ายซ้ำไม่ได้
});

test('State machine: ข้ามสถานะผิดลำดับไม่ได้', async () => {
  const c = await makeUser();
  await setCart(c, ['neon-racer-2077']);
  const id = (await order(c)).data.order.id;
  assert.throws(() => transition(id, 'refunded'), { code: 'ORDER_BAD_STATE' }); // pending → refunded ไม่ได้
  transition(id, 'paid');
  assert.throws(() => transition(id, 'cancelled'), { code: 'ORDER_BAD_STATE' }); // paid → cancelled ไม่ได้
  assert.throws(() => transition(id, 'pending'), { code: 'ORDER_BAD_STATE' });
  assert.equal(transition(id, 'refunded').status, 'refunded');
  assert.throws(() => transition(id, 'paid'), { code: 'ORDER_BAD_STATE' }); // refunded เป็นสถานะสุดท้าย
  assert.throws(() => transition(99999, 'paid'), { code: 'ORDER_NOT_FOUND' });
});

test('ความเป็นเจ้าของ: เข้าถึง/ยกเลิก/จ่ายออเดอร์ของคนอื่นไม่ได้ (404)', async () => {
  const a = await makeUser();
  const b = await makeUser();
  await setCart(a, ['mystery-manor']);
  const o = (await order(a)).data.order;
  assert.equal((await b.get(`/api/orders/${o.id}`)).status, 404);
  assert.equal((await b.post(`/api/orders/${o.id}/cancel`)).status, 404);
  assert.equal((await b.post(`/api/orders/${o.id}/dev-pay`)).status, 404);
  assert.equal((await a.get(`/api/orders/${o.id}`)).status, 200);
  assert.equal((await b.get('/api/orders/abc')).status, 400);
  const anon = await new Client(srv.url).init();
  assert.equal((await anon.get(`/api/orders/${o.id}`)).status, 401);
});

test('ออเดอร์ pending ที่เกินเวลาหมดอายุอัตโนมัติ และคืนสิทธิ์คูปอง', async () => {
  const c = await makeUser();
  await setCart(c, ['galaxy-commanders']); // ราคาเกิน ฿500 (ขั้นต่ำของ SAVE100)
  const o = (await order(c, { couponCode: 'SAVE100' })).data.order;
  assert.equal(expirePending(), 0); // ยังไม่หมดเวลา
  db.prepare('UPDATE orders SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, o.id);
  assert.equal(expirePending(), 1);
  const after = (await c.get(`/api/orders/${o.id}`)).data.order;
  assert.equal(after.status, 'cancelled');
  assert.equal(after.cancelReason, 'expired');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM coupon_usages WHERE order_id = ?').get(o.id).n, 0);
});

test('เกมฟรี (ยอด 0) ชำระอัตโนมัติ; เกมที่หยุดขายสั่งไม่ได้', async () => {
  const c = await makeUser();
  await setCart(c, ['battle-arena-x']);
  const free = (await order(c)).data.order;
  assert.equal(free.total, 0);
  assert.equal(free.status, 'paid');

  await setCart(c, ['puzzle-palace']);
  db.prepare("UPDATE games SET active = 0 WHERE slug = 'puzzle-palace'").run();
  const r = await order(c);
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'GAME_UNAVAILABLE'); // ตะกร้า PUT กรองเกมที่ปิดอยู่ แต่เกมที่ปิดทีหลังต้องกันตอนสั่ง
  assert.equal(r.data.params.titles, 'Puzzle Palace');
  db.prepare("UPDATE games SET active = 1 WHERE slug = 'puzzle-palace'").run();
});

test('ประวัติคำสั่งซื้อ: แบ่งหน้า ใหม่สุดก่อน เฉพาะของตัวเอง', async () => {
  const c = await makeUser();
  const slugs = ['chef-rush', 'hero-tactics', 'forest-spirit'];
  const ids = [];
  for (const s of slugs) { await setCart(c, [s]); ids.push((await order(c)).data.order.id); }
  const r = (await c.get('/api/me/orders')).data;
  assert.equal(r.total, 3);
  assert.deepEqual(r.items.map((i) => i.id), ids.reverse());
  assert.deepEqual(r.items[0].titles, ['Forest Spirit']);
  assert.equal((await c.get('/api/me/orders?page=2')).data.items.length, 0);
  assert.equal((await (await makeUser()).get('/api/me/orders')).data.total, 0);
});

// ---------- ราคาหลังส่วนลด: แหล่งเดียว (pricing.finalPrice) ทุกหน้าตรงกับยอดที่เรียกเก็บ ----------
test('ราคาที่แสดงตรงกับราคาที่เรียกเก็บ แม้ราคามีเศษสตางค์ (เดิมคลาด 1 สตางค์จาก float)', async () => {
  const { finalPrice, FINAL_PRICE_SQL } = await import('../server/services/pricing.js');
  // ฿100.50 ลด 33%: สูตร float เดิมแสดง 6733 แต่เก็บเงิน 6734
  const before = db.prepare("SELECT price, discount FROM games WHERE slug = 'space-miner'").get();
  db.prepare("UPDATE games SET price = 10050, discount = 33 WHERE slug = 'space-miner'").run();
  try {
    const c = await makeUser();
    const shown = (await c.get('/api/games/space-miner')).data.finalPrice;
    assert.equal(shown, 6734);
    await setCart(c, ['space-miner']);
    assert.equal((await c.get('/api/cart')).data.items[0].finalPrice, shown);
    assert.equal((await c.get('/api/cart/summary')).data.total, shown);
    assert.equal((await order(c)).data.order.total, shown);
    // ตัวกรองราคาใช้สูตรเดียวกัน: ค่าขอบพอดีต้องเจอ
    const hit = (await c.get('/api/games?minPrice=6734&maxPrice=6734&limit=60')).data.items.map((g) => g.slug);
    assert.ok(hit.includes('space-miner'));
    assert.ok(!(await c.get('/api/games?minPrice=6735&limit=60')).data.items.some((g) => g.slug === 'space-miner'));
  } finally {
    db.prepare("UPDATE games SET price = ?, discount = ? WHERE slug = 'space-miner'").run(before.price, before.discount);
  }
  // สูตร SQL ให้ผลเท่ากับ finalPrice() ทุกกรณี (ราคา 0-2000 สตางค์ × ส่วนลด 0-100% + ราคาสูง)
  const sql = db.prepare(`SELECT ${FINAL_PRICE_SQL} AS v FROM (SELECT ? AS price, ? AS discount)`);
  for (const price of [...Array(2001).keys(), 99999, 100_000_000]) {
    for (let discount = 0; discount <= 100; discount += price > 2000 ? 1 : 3) {
      assert.equal(sql.get(price, discount).v, finalPrice({ price, discount }), `price=${price} discount=${discount}`);
    }
  }
});

test('เกมในตะกร้าที่ถูกหยุดขาย: summary แจ้งชื่อ, สั่งซื้อแล้วถูกนำออกจากตะกร้า, สั่งใหม่ได้ทันที', async () => {
  const c = await makeUser();
  await setCart(c, ['ocean-explorer', 'mystery-manor']);
  db.prepare("UPDATE games SET active = 0 WHERE slug = 'mystery-manor'").run();
  try {
    const s = (await c.get('/api/cart/summary')).data;
    assert.deepEqual(s.unavailable, [{ slug: 'mystery-manor', title: 'Mystery Manor' }]);
    assert.deepEqual(s.items.map((i) => i.slug), ['ocean-explorer']);

    const r = await order(c);
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'GAME_UNAVAILABLE');
    assert.equal((await c.get('/api/me/orders')).data.total, 0, 'ไม่มีออเดอร์ถูกสร้าง');
    assert.deepEqual((await c.get('/api/cart/summary')).data.unavailable, [], 'เกมที่หยุดขายถูกนำออกจากตะกร้าแล้ว');

    const ok = await order(c); // ลองใหม่ได้เลย เหลือเฉพาะเกมที่ยังขายอยู่
    assert.equal(ok.status, 201);
    assert.deepEqual(ok.data.order.items.map((i) => i.slug), ['ocean-explorer']);
  } finally {
    db.prepare("UPDATE games SET active = 1 WHERE slug = 'mystery-manor'").run();
  }
});

// ---------- กันกักสต็อกด้วยออเดอร์ pending ----------
test('จำกัดออเดอร์รอชำระต่อผู้ใช้ (ค่าเริ่มต้น 3): เกินแล้ว 409, key เดิมยังได้ออเดอร์เดิม, ยกเลิก/หมดอายุแล้วสั่งต่อได้', async () => {
  const c = await makeUser();
  const made = [];
  for (const slug of ['tower-defense-legends', 'final-boss-rush', 'speed-legends-gt']) {
    await setCart(c, [slug]);
    const idempotencyKey = key();
    const r = await c.post('/api/orders', { idempotencyKey });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    made.push({ id: r.data.order.id, idempotencyKey });
  }
  await setCart(c, ['wild-west-legends']);
  const blocked = await order(c);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'TOO_MANY_PENDING');
  assert.equal(blocked.data.params.n, 3);
  const wwlId = db.prepare("SELECT id FROM games WHERE slug = 'wild-west-legends'").get().id;
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM game_keys WHERE game_id = ? AND status = 'reserved'").get(wwlId).n, 0, 'ไม่จองโค้ดเพิ่ม');

  // กดซ้ำด้วย key เดิม (เช่น รีเฟรชหน้า) ยังได้ออเดอร์เดิม ไม่ติดลิมิต
  const again = await c.post('/api/orders', { idempotencyKey: made[0].idempotencyKey });
  assert.equal(again.status, 200);
  assert.equal(again.data.order.id, made[0].id);

  assert.equal((await c.post(`/api/orders/${made[0].id}/cancel`)).status, 200);
  assert.equal((await order(c)).status, 201, 'ยกเลิกหนึ่งรายการแล้วสั่งใหม่ได้');

  // ออเดอร์ที่เลยเวลาแล้ว (แม้งานยกเลิกอัตโนมัติยังไม่ทำงาน) ไม่นับ
  db.prepare('UPDATE orders SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, made[1].id);
  await setCart(c, ['vampire-castle']);
  assert.equal((await order(c)).status, 201);
});

test('สร้างคำสั่งซื้อถี่เกินไป (ค่าเริ่มต้น 10 ครั้ง/10 นาที/ผู้ใช้): 429, ผู้ใช้อื่นไม่โดนด้วย', async () => {
  const c = await makeUser();
  for (let i = 0; i < 10; i += 1) assert.equal((await order(c)).status, 400); // ตะกร้าว่าง — ครั้งที่ล้มเหลวก็นับ
  const limited = await order(c);
  assert.equal(limited.status, 429);
  assert.equal(limited.data.code, 'ORDER_RATE_LIMIT');
  assert.equal((await order(await makeUser())).status, 400, 'นับแยกต่อผู้ใช้ ไม่ใช่ต่อ IP');
});

test('กดสั่งซื้อซ้ำด้วย idempotency key เดิม (เน็ตไม่เสถียร) ไม่กินโควตาการสร้างออเดอร์', async () => {
  const c = await makeUser();
  await setCart(c, ['kart-mania']);
  const first = await c.post('/api/orders', { idempotencyKey: 'retry-same-key-123' });
  assert.equal(first.status, 201);
  for (let i = 0; i < 12; i += 1) {
    const r = await c.post('/api/orders', { idempotencyKey: 'retry-same-key-123' });
    assert.equal(r.status, 200);
    assert.equal(r.data.order.id, first.data.order.id);
  }
  assert.equal((await c.post(`/api/orders/${first.data.order.id}/cancel`)).status, 200);
});
