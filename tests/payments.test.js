import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import Stripe from 'stripe';
import { Client, makeAdminClient, makeUser, outbox, startServer } from './helpers.js';
import { validProdEnv } from './prodenv.js';

const { db } = await import('../server/db/index.js');
const { seedCoupons } = await import('../server/db/seed.js');
const { setStripeClient } = await import('../server/services/stripe.js');
const { expirePending } = await import('../server/services/orders.js');
const { processEmailQueue } = await import('../server/services/emailQueue.js');
const { failNextMails } = await import('../server/services/mail.js');
const { addKeys } = await import('../server/services/keys.js');
const { encrypt, decrypt, keyHash } = await import('../server/services/crypto.js');
const { splitVat } = await import('../server/services/receipt.js');

let srv;
before(async () => { srv = await startServer(); seedCoupons(); });
after(() => srv.server.close());

// ---------- Stripe ปลอม (ไม่เรียก API จริง) + ตัวส่ง webhook ที่เซ็นลายเซ็นถูกต้อง ----------
const calls = { create: [], expire: [], refunds: [] };
let sessionN = 0;
const fakeStripe = {
  checkout: {
    sessions: {
      async create(params, opts) {
        const id = `cs_test_${++sessionN}`;
        calls.create.push({ params, opts, id });
        return { id, url: `https://checkout.stripe.test/c/${id}`, payment_intent: null };
      },
      async expire(id) { calls.expire.push(id); return { id }; },
    },
  },
  refunds: {
    async create(params, opts) {
      calls.refunds.push({ params, opts });
      if (fakeStripe.failRefund) throw new Error('stripe down');
      return { id: `re_${calls.refunds.length}`, status: 'succeeded' };
    },
  },
};
const lib = new Stripe('sk_test_unused');
let evN = 0;
async function webhook(type, object, { id, signature = 'valid' } = {}) {
  const event = { id: id ?? `evt_${++evN}`, object: 'event', type, data: { object } };
  const payload = JSON.stringify(event);
  const headers = { 'content-type': 'application/json' };
  if (signature === 'valid') headers['stripe-signature'] = lib.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  else if (signature === 'bad') headers['stripe-signature'] = 't=1,v1=deadbeef';
  const r = await fetch(srv.url + '/api/webhooks/stripe', { method: 'POST', headers, body: payload });
  return { status: r.status, data: await r.json(), event };
}
const completed = (order, sessionId, extra = {}) => ({
  id: sessionId, object: 'checkout.session', payment_status: 'paid', amount_total: order.total, currency: 'thb',
  payment_intent: `pi_${sessionId}`, metadata: { order_id: String(order.id) }, client_reference_id: String(order.id), ...extra,
});

const key = () => `key-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const buy = async (c, slugs, body = {}) => {
  await c.put('/api/cart', { slugs });
  const r = await c.post('/api/orders', { idempotencyKey: key(), ...body });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.order;
};
// สั่งซื้อ + เริ่มชำระ → คืน order กับ id ของ Checkout Session
const startPay = async (c, slugs, body) => {
  const order = await buy(c, slugs, body);
  const r = await c.post(`/api/orders/${order.id}/pay`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { order, sessionId: calls.create.at(-1).id };
};
const paidViaWebhook = async (c, slugs, body) => {
  const { order, sessionId } = await startPay(c, slugs, body);
  const w = await webhook('checkout.session.completed', completed(order, sessionId));
  assert.equal(w.data.result, 'processed');
  return { order, sessionId };
};
// ส่งงานค้างในคิวให้หมดก่อน เพื่อให้เทสที่นับจำนวนอีเมลไม่ปนกับเทสอื่น
const drainEmails = async () => { while (await processEmailQueue()) { /* loop */ } };
const alerts = (kind) => db.prepare('SELECT * FROM admin_alerts WHERE kind = ?').all(kind);
const soldKeys = (orderId) => db.prepare("SELECT COUNT(*) AS n FROM game_keys WHERE status = 'sold' AND order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)").get(orderId).n;
const makeAdmin = () => makeAdminClient(srv.url, 'admin');

test('ยังไม่ตั้งค่า Stripe: ระบบยังรัน และบอกชัดว่าขาดค่าอะไร', async () => {
  const c = await makeUser(srv.url);
  const order = await buy(c, ['dragon-realm']);
  const r = await c.post(`/api/orders/${order.id}/pay`, {});
  assert.equal(r.status, 503);
  assert.equal(r.data.code, 'PAYMENTS_NOT_CONFIGURED');
  assert.match(r.data.error, /STRIPE_SECRET_KEY/);
  const cfg = (await c.get('/api/config')).data;
  assert.equal(cfg.payments.stripe, false);
  assert.equal(cfg.devPay, true); // นอก production ยังมีปุ่มจำลอง
  assert.equal((await c.post(`/api/orders/${order.id}/dev-pay`, {})).data.order.status, 'paid');
  setStripeClient(fakeStripe); // เทสถัดไปใช้ Stripe ปลอม
});

test('เริ่มชำระ: ยอดมาจากออเดอร์ในฐานข้อมูล, เมินยอดที่เบราว์เซอร์ส่งมา, ใช้ session เดิมซ้ำ', async () => {
  const c = await makeUser(srv.url);
  const order = await buy(c, ['dragon-realm']); // 903 บาท = 90300 สตางค์
  const before = calls.create.length;
  const r = await c.post(`/api/orders/${order.id}/pay`, { amount: 1, total: 1, currency: 'usd', unit_amount: 1 });
  assert.equal(r.status, 200);
  const { params, opts } = calls.create.at(-1);
  assert.equal(params.line_items[0].price_data.unit_amount, 90300);
  assert.equal(params.line_items[0].price_data.currency, 'thb');
  assert.deepEqual(params.payment_method_types, ['card', 'promptpay']);
  assert.equal(params.metadata.order_id, String(order.id));
  assert.equal(params.client_reference_id, String(order.id));
  assert.ok(params.success_url.includes(`/order/${order.id}`) && params.cancel_url.includes(`/order/${order.id}`));
  assert.ok(opts.idempotencyKey);
  assert.equal(r.data.url, `https://checkout.stripe.test/c/${calls.create.at(-1).id}`);

  const again = await c.post(`/api/orders/${order.id}/pay`, {});
  assert.equal(again.data.url, r.data.url);
  assert.equal(calls.create.length, before + 1); // ไม่สร้าง session ซ้ำ

  assert.equal((await (await makeUser(srv.url)).post(`/api/orders/${order.id}/pay`, {})).status, 404); // ของคนอื่น
  assert.equal((await new Client(srv.url).init().then((x) => x.post(`/api/orders/${order.id}/pay`, {}))).status, 401);
  await c.post(`/api/orders/${order.id}/cancel`, {});
  assert.equal((await c.post(`/api/orders/${order.id}/pay`, {})).status, 409); // จ่ายได้เฉพาะ pending
});

test('Webhook: ลายเซ็นผิด/ไม่มี ถูกปฏิเสธและไม่มีผลใด ๆ', async () => {
  const c = await makeUser(srv.url);
  const { order, sessionId } = await startPay(c, ['kart-mania']);
  for (const signature of ['bad', 'none']) {
    const w = await webhook('checkout.session.completed', completed(order, sessionId), { signature });
    assert.equal(w.status, 400);
    assert.equal(w.data.code, 'BAD_SIGNATURE');
  }
  assert.equal((await c.get(`/api/orders/${order.id}`)).data.order.status, 'pending');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM webhook_events WHERE id LIKE ?').get('evt_none%').n, 0);
});

test('จ่ายสำเร็จ (webhook): paid + ได้โค้ด + ใบเสร็จเลขที่ + อีเมล + คลังเกม + audit log', async () => {
  const c = await makeUser(srv.url);
  const { order, sessionId } = await paidViaWebhook(c, ['dragon-realm', 'sky-kingdoms']);
  const o = (await c.get(`/api/orders/${order.id}`)).data.order;
  assert.equal(o.status, 'paid');
  assert.match(o.invoiceNumber, /^INV-\d{4}-\d{6}$/);
  assert.equal(o.keys.length, 2);
  assert.ok(o.keys.every((k) => /^FAKE-/.test(k.code)));
  assert.equal(soldKeys(order.id), 2);

  const pay = db.prepare('SELECT * FROM payments WHERE provider_ref = ?').get(sessionId);
  assert.equal(pay.status, 'succeeded');
  assert.equal(pay.amount, order.total);
  assert.ok(pay.raw_event_id.startsWith('evt_'));

  assert.ok((await processEmailQueue()) >= 1); // (คิวเป็นของทั้งระบบ อาจมีงานของเทสก่อนหน้าค้างอยู่)
  const mail = [...outbox].reverse().find((m) => m.to === c.email && m.subject.includes(`#${order.id}`));
  assert.ok(mail, 'ต้องมีอีเมลยืนยันคำสั่งซื้อ');
  for (const k of o.keys) assert.ok(mail.text.includes(k.code), 'อีเมลต้องมีโค้ดเกม');
  assert.ok(mail.text.includes(o.invoiceNumber));

  const lib = (await c.get('/api/me/library')).data.items;
  assert.deepEqual(lib.flatMap((g) => g.keys.map((k) => k.code)).sort(), o.keys.map((k) => k.code).sort());
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'key.view' AND user_id = (SELECT id FROM users WHERE email = ?)").get(c.email).n >= 2);
  assert.equal((await c.get('/api/cart')).data.items.length, 0);
});

test('Webhook ซ้ำ: event id เดิมไม่ประมวลผลซ้ำ, event อื่นของการจ่ายเดิมไม่ทำซ้ำ', async () => {
  const c = await makeUser(srv.url);
  const { order, sessionId } = await startPay(c, ['neon-racer-2077']);
  const body = completed(order, sessionId);
  const first = await webhook('checkout.session.completed', body, { id: 'evt_fixed_1' });
  const dup = await webhook('checkout.session.completed', body, { id: 'evt_fixed_1' });
  assert.equal(first.data.result, 'processed');
  assert.equal(dup.status, 200);
  assert.equal(dup.data.result, 'duplicate');
  // payment_intent.succeeded ของการจ่ายเดียวกันมาทีหลัง (event id ใหม่) → ไม่ทำซ้ำ
  await webhook('payment_intent.succeeded', { id: `pi_${sessionId}`, amount_received: order.total, currency: 'thb', metadata: { order_id: String(order.id) } });
  assert.equal(soldKeys(order.id), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE order_id = ?').get(order.id).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM email_queue WHERE order_id = ? AND kind = 'order_paid'").get(order.id).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE order_id = ? AND status = 'succeeded'").get(order.id).n, 1);
});

test('ยอด/สกุลเงินไม่ตรงกับออเดอร์: ไม่เปลี่ยนเป็น paid, คืนเงินอัตโนมัติ, แจ้งแอดมิน', async () => {
  const c = await makeUser(srv.url);
  const { order, sessionId } = await startPay(c, ['hero-tactics']);
  const refundsBefore = calls.refunds.length;
  await webhook('checkout.session.completed', completed(order, sessionId, { amount_total: 100 }));
  assert.equal((await c.get(`/api/orders/${order.id}`)).data.order.status, 'pending');
  assert.equal(soldKeys(order.id), 0);
  assert.equal(calls.refunds.length, refundsBefore + 1);
  assert.equal(calls.refunds.at(-1).params.payment_intent, `pi_${sessionId}`);
  assert.ok(alerts('AMOUNT_MISMATCH').some((a) => a.order_id === order.id));

  const c2 = await makeUser(srv.url);
  const p2 = await startPay(c2, ['chef-rush']);
  await webhook('checkout.session.completed', completed(p2.order, p2.sessionId, { currency: 'usd' }));
  assert.equal((await c2.get(`/api/orders/${p2.order.id}`)).data.order.status, 'pending');
  assert.equal(calls.refunds.length, refundsBefore + 2);
});

test('จ่ายล้มเหลว: ออเดอร์ยัง pending และกดชำระใหม่ได้ (session ใหม่)', async () => {
  const c = await makeUser(srv.url);
  const { order, sessionId } = await startPay(c, ['cyber-samurai']);
  const w = await webhook('payment_intent.payment_failed', { id: 'pi_failed_1', metadata: { order_id: String(order.id) }, last_payment_error: { message: 'Your card was declined.' } });
  assert.equal(w.status, 200);
  const pay = db.prepare('SELECT * FROM payments WHERE provider_ref = ?').get(sessionId);
  assert.equal(pay.status, 'failed');
  assert.match(pay.last_error, /declined/);
  assert.equal((await c.get(`/api/orders/${order.id}`)).data.order.status, 'pending');
  const before = calls.create.length;
  assert.equal((await c.post(`/api/orders/${order.id}/pay`, {})).status, 200);
  assert.equal(calls.create.length, before + 1);
});

test('จ่ายหลังออเดอร์หมดอายุ: ไม่ให้โค้ด, คืนเงินอัตโนมัติ, บันทึกให้แอดมินดู', async () => {
  const c = await makeUser(srv.url);
  const { order, sessionId } = await startPay(c, ['puzzle-palace']);
  db.prepare('UPDATE orders SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, order.id);
  assert.equal(expirePending(), 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(calls.expire.includes(sessionId), 'ต้องสั่ง expire Checkout Session ฝั่ง Stripe');
  assert.equal(db.prepare('SELECT status FROM payments WHERE provider_ref = ?').get(sessionId).status, 'expired');

  const refundsBefore = calls.refunds.length;
  await webhook('checkout.session.completed', completed(order, sessionId));
  const o = (await c.get(`/api/orders/${order.id}`)).data.order;
  assert.equal(o.status, 'cancelled');
  assert.equal(soldKeys(order.id), 0);
  assert.equal(calls.refunds.length, refundsBefore + 1);
  assert.ok(alerts('LATE_PAYMENT').some((a) => a.order_id === order.id));
  assert.equal(db.prepare('SELECT status FROM payments WHERE provider_ref = ?').get(sessionId).status, 'refunded');
});

test('ยกเลิกออเดอร์: expire Checkout Session ฝั่ง Stripe และคืนโค้ดที่จองเข้าสต็อก', async () => {
  const c = await makeUser(srv.url);
  const stockBefore = db.prepare("SELECT COUNT(*) AS n FROM game_keys WHERE status = 'available' AND game_id = (SELECT id FROM games WHERE slug = 'vampire-castle')").get().n;
  const { order, sessionId } = await startPay(c, ['vampire-castle']);
  const reserved = () => db.prepare("SELECT COUNT(*) AS n FROM game_keys WHERE status = 'reserved' AND order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)").get(order.id).n;
  assert.equal(reserved(), 1);
  await c.post(`/api/orders/${order.id}/cancel`, {});
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(calls.expire.includes(sessionId));
  assert.equal(reserved(), 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM game_keys WHERE status = 'available' AND game_id = (SELECT id FROM games WHERE slug = 'vampire-castle')").get().n, stockBefore);
});

test('โค้ดหมดสต็อก: สั่งซื้อไม่ได้ตั้งแต่ต้น, ซื้อพร้อมกันตัวสุดท้ายได้คนเดียว', async () => {
  const slug = 'ocean-explorer';
  const gid = db.prepare('SELECT id FROM games WHERE slug = ?').get(slug).id;
  db.prepare("UPDATE game_keys SET status = 'revoked' WHERE game_id = ? AND status = 'available'").run(gid);
  addKeys(gid, ['FAKE-LAST-ONLY-0001']); // เหลือโค้ดว่างตัวเดียว

  const users = await Promise.all(Array.from({ length: 5 }, () => makeUser(srv.url)));
  await Promise.all(users.map((u) => u.put('/api/cart', { slugs: [slug] })));
  const results = await Promise.all(users.map((u) => u.post('/api/orders', { idempotencyKey: key() })));
  const ok = results.filter((r) => r.status === 201);
  const fail = results.filter((r) => r.status === 409);
  assert.equal(ok.length, 1);
  assert.equal(fail.length, 4);
  assert.ok(fail.every((r) => r.data.code === 'OUT_OF_STOCK'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE id IN (SELECT order_id FROM order_items WHERE game_id = ?) AND status = 'pending'").get(gid).n, 1); // ไม่มีออเดอร์กำพร้า

  // ผู้ชนะยกเลิก → โค้ดกลับเข้าสต็อก คนถัดไปซื้อได้
  const winner = users[results.findIndex((r) => r.status === 201)];
  await winner.post(`/api/orders/${ok[0].data.order.id}/cancel`, {});
  const loser = users[results.findIndex((r) => r.status === 409)];
  assert.equal((await loser.post('/api/orders', { idempotencyKey: key() })).status, 201);
});

test('ซื้อพร้อมกัน 10 คน: ได้โค้ดไม่ซ้ำกันเลย', async () => {
  const users = await Promise.all(Array.from({ length: 10 }, () => makeUser(srv.url)));
  const codes = await Promise.all(users.map(async (u) => {
    const order = await buy(u, ['forest-spirit']);
    const r = await u.post(`/api/orders/${order.id}/dev-pay`, {});
    assert.equal(r.status, 200);
    return (await u.get(`/api/orders/${order.id}`)).data.order.keys[0].code;
  }));
  assert.equal(new Set(codes).size, 10);
});

test('โค้ดหายระหว่างจ่าย: ไม่เปลี่ยนเป็น paid, คืนเงินอัตโนมัติ, แจ้งแอดมิน', async () => {
  const c = await makeUser(srv.url);
  const { order, sessionId } = await startPay(c, ['mech-warriors']);
  const gid = db.prepare('SELECT id FROM games WHERE slug = ?').get('mech-warriors').id;
  // จำลองแอดมินเพิกถอนโค้ดทั้งหมดของเกม (รวมที่จองไว้) ระหว่างลูกค้ากำลังจ่าย
  db.prepare("UPDATE game_keys SET status = 'revoked' WHERE game_id = ? AND status IN ('available', 'reserved')").run(gid);
  const refundsBefore = calls.refunds.length;
  await webhook('checkout.session.completed', completed(order, sessionId));
  assert.equal((await c.get(`/api/orders/${order.id}`)).data.order.status, 'pending');
  assert.equal(calls.refunds.length, refundsBefore + 1);
  assert.ok(alerts('OUT_OF_STOCK_AFTER_PAYMENT').some((a) => a.order_id === order.id));
  assert.equal(db.prepare('SELECT status FROM payments WHERE provider_ref = ?').get(sessionId).status, 'refunded');
});

test('คืนเงิน (แอดมิน): refunded, เพิกถอนโค้ด, ออกจากคลัง, คืนสิทธิ์คูปอง, ไม่คืนซ้ำ', async () => {
  const c = await makeUser(srv.url);
  const { order, sessionId } = await paidViaWebhook(c, ['moonlight-academy'], { couponCode: 'WELCOME10' });
  assert.equal(order.couponDiscount, Math.floor(order.total / 0.9 * 0.1)); // sanity: มีส่วนลดคูปอง
  assert.equal((await c.get('/api/me/library')).data.items.length, 1);
  await c.put('/api/cart', { slugs: ['kart-mania'] });
  assert.equal((await c.post('/api/coupons/validate', { code: 'WELCOME10' })).data.code, 'COUPON_USER_LIMIT'); // ใช้สิทธิ์ไปแล้ว

  assert.equal((await c.post(`/api/admin/orders/${order.id}/refund`, { confirmOrderId: order.id, reason: 'ลูกค้าขอ' })).status, 401); // ลูกค้าไม่มีเซสชันแอดมิน
  assert.equal((await (await new Client(srv.url).init()).post(`/api/admin/orders/${order.id}/refund`, { confirmOrderId: order.id, reason: 'x' })).status, 401);

  const admin = await makeAdmin();
  assert.equal((await admin.post(`/api/admin/orders/${order.id}/refund`, { confirmOrderId: order.id, reason: 'x' })).status, 400); // เหตุผลสั้นไป
  const r = await admin.post(`/api/admin/orders/${order.id}/refund`, { confirmOrderId: order.id, reason: 'ลูกค้าขอคืนเงิน' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.order.status, 'refunded');

  const call = calls.refunds.at(-1);
  assert.equal(call.params.payment_intent, `pi_${sessionId}`);
  assert.equal(call.opts.idempotencyKey, `refund-order-${order.id}`);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM game_keys WHERE status = 'revoked' AND order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)").get(order.id).n, 1);
  assert.equal((await c.get('/api/me/library')).data.items.length, 0);
  assert.equal(db.prepare('SELECT status FROM payments WHERE provider_ref = ?').get(sessionId).status, 'refunded');
  const refund = db.prepare('SELECT * FROM refunds WHERE order_id = ?').get(order.id);
  assert.equal(refund.amount, order.total);
  assert.equal(refund.reason, 'ลูกค้าขอคืนเงิน');
  assert.ok(refund.admin_id);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'order.refund' AND entity_id = ?").get(String(order.id)));
  assert.equal((await c.post('/api/coupons/validate', { code: 'WELCOME10' })).status, 200); // สิทธิ์คูปองกลับมา

  assert.equal((await admin.post(`/api/admin/orders/${order.id}/refund`, { confirmOrderId: order.id, reason: 'ซ้ำ' })).status, 409); // คืนซ้ำไม่ได้
  // webhook charge.refunded ที่ตามมาจาก Stripe ไม่ทำให้พัง/ไม่ทำซ้ำ
  const refundsAfterAdmin = calls.refunds.length;
  const w = await webhook('charge.refunded', { id: 'ch_1', payment_intent: `pi_${sessionId}`, amount: order.total, amount_refunded: order.total });
  assert.equal(w.status, 200);
  assert.equal(calls.refunds.length, refundsAfterAdmin); // ไม่เรียก Stripe คืนเงินซ้ำ
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM refunds WHERE order_id = ?').get(order.id).n, 1);

  // ซื้อเกมเดิมซ้ำได้อีกหลังคืนเงิน
  assert.equal((await c.put('/api/cart', { slugs: ['moonlight-academy'] })).status, 200);
  assert.equal((await c.post('/api/orders', { idempotencyKey: key() })).status, 201);
});

test('คืนเงินจาก Stripe Dashboard (webhook charge.refunded): เพิกถอนโค้ด; คืนบางส่วนแค่แจ้งเตือน', async () => {
  const c = await makeUser(srv.url);
  const { order, sessionId } = await paidViaWebhook(c, ['island-tycoon']);
  const partial = await webhook('charge.refunded', { id: 'ch_p', payment_intent: `pi_${sessionId}`, amount: order.total, amount_refunded: 100 });
  assert.equal(partial.status, 200);
  assert.equal((await c.get(`/api/orders/${order.id}`)).data.order.status, 'paid');
  assert.ok(alerts('PARTIAL_REFUND').some((a) => a.order_id === order.id));

  await webhook('charge.refunded', { id: 'ch_f', payment_intent: `pi_${sessionId}`, amount: order.total, amount_refunded: order.total });
  assert.equal((await c.get(`/api/orders/${order.id}`)).data.order.status, 'refunded');
  assert.equal(db.prepare('SELECT source FROM refunds WHERE order_id = ?').get(order.id).source, 'stripe_dashboard');
  assert.equal((await c.get('/api/me/library')).data.items.length, 0);
});

test('คืนเงินล้มเหลวที่ Stripe: ออเดอร์ยังเป็น paid (ไม่เปลี่ยนสถานะลอย ๆ)', async () => {
  const c = await makeUser(srv.url);
  const { order } = await paidViaWebhook(c, ['ninja-dash']);
  const admin = await makeAdmin();
  fakeStripe.failRefund = true;
  const r = await admin.post(`/api/admin/orders/${order.id}/refund`, { confirmOrderId: order.id, reason: 'ทดสอบ stripe ล่ม' });
  fakeStripe.failRefund = false;
  assert.equal(r.status, 502);
  assert.equal(r.data.code, 'REFUND_PROVIDER_ERROR');
  assert.equal((await c.get(`/api/orders/${order.id}`)).data.order.status, 'paid');
  assert.equal((await c.get('/api/me/library')).data.items.length, 1);
});

test('ใบเสร็จ PDF: เฉพาะเจ้าของ + paid, เลขที่รันต่อเนื่อง, VAT แยกถูกต้อง', async () => {
  assert.deepEqual(splitVat(10700), { net: 10000, vat: 700 });
  const t = splitVat(90300);
  assert.equal(t.net + t.vat, 90300);

  const c = await makeUser(srv.url);
  const pending = await buy(c, ['basketball-star']);
  assert.equal((await c.req('GET', `/api/orders/${pending.id}/receipt.pdf`)).status, 409); // ยังไม่จ่าย

  const a = await paidViaWebhook(c, ['dragon-realm']);
  const b = await paidViaWebhook(c, ['kart-mania']);
  const numA = (await c.get(`/api/orders/${a.order.id}`)).data.order.invoiceNumber;
  const numB = (await c.get(`/api/orders/${b.order.id}`)).data.order.invoiceNumber;
  assert.equal(Number(numB.slice(-6)), Number(numA.slice(-6)) + 1);

  const res = await fetch(`${srv.url}/api/orders/${a.order.id}/receipt.pdf`, { headers: { cookie: Object.entries(c.cookies).map(([k, v]) => `${k}=${v}`).join('; ') } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /attachment; filename="receipt-INV-/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buf.length > 5000);

  const other = await makeUser(srv.url);
  assert.equal((await other.req('GET', `/api/orders/${a.order.id}/receipt.pdf`)).status, 404); // ของคนอื่น
  const anon = await new Client(srv.url).init();
  assert.equal((await anon.req('GET', `/api/orders/${a.order.id}/receipt.pdf`)).status, 401);

  const admin = await makeAdmin();
  await admin.post(`/api/admin/orders/${a.order.id}/refund`, { confirmOrderId: a.order.id, reason: 'ทดสอบใบเสร็จหลังคืนเงิน' });
  assert.equal((await c.req('GET', `/api/orders/${a.order.id}/receipt.pdf`)).status, 409); // คืนเงินแล้วไม่ออกใบเสร็จ
});

test('อีเมลหลังซื้อ: ส่งล้มเหลวแล้ว retry (backoff), ไม่ทำให้ออเดอร์พัง, ครบกำหนดแล้วแจ้งแอดมิน', async () => {
  await drainEmails();
  const c = await makeUser(srv.url);
  failNextMails(2);
  const order = await buy(c, ['shadow-assassin']);
  assert.equal((await c.post(`/api/orders/${order.id}/dev-pay`, {})).status, 200); // ออเดอร์ paid แม้อีเมลยังไม่ถึง
  const sentBefore = outbox.length;
  const now = Date.now();
  assert.equal(await processEmailQueue(now), 0);
  let job = db.prepare('SELECT * FROM email_queue WHERE order_id = ?').get(order.id);
  assert.equal(job.attempts, 1);
  assert.equal(job.status, 'pending');
  assert.ok(job.next_attempt_at > now);

  assert.equal(await processEmailQueue(now + 1000), 0); // ยังไม่ถึงเวลา retry
  assert.equal(await processEmailQueue(now + 2 * 60_000), 0); // ล้มเหลวครั้งที่ 2
  assert.equal(db.prepare('SELECT attempts FROM email_queue WHERE order_id = ?').get(order.id).attempts, 2);
  assert.equal(await processEmailQueue(now + 10 * 60_000), 1); // สำเร็จ
  job = db.prepare('SELECT * FROM email_queue WHERE order_id = ?').get(order.id);
  assert.equal(job.status, 'sent');
  assert.equal(outbox.length, sentBefore + 1);

  // ล้มเหลวจนครบจำนวนครั้ง → failed + แจ้งแอดมิน
  const c2 = await makeUser(srv.url);
  const o2 = await buy(c2, ['football-pro-26']);
  failNextMails(99);
  await c2.post(`/api/orders/${o2.id}/dev-pay`, {});
  let t = Date.now();
  for (let i = 0; i < 6; i++) { await processEmailQueue(t); t += 7 * 3600_000; }
  failNextMails(0);
  assert.equal(db.prepare('SELECT status FROM email_queue WHERE order_id = ?').get(o2.id).status, 'failed');
  assert.ok(alerts('EMAIL_FAILED').some((a) => a.order_id === o2.id));
  assert.equal((await c2.get(`/api/orders/${o2.id}`)).data.order.status, 'paid');
});

test('ส่งอีเมลอีกครั้ง: เฉพาะเจ้าของ+paid และมี rate limit', async () => {
  const c = await makeUser(srv.url);
  const pending = await buy(c, ['galaxy-commanders']);
  assert.equal((await c.post(`/api/orders/${pending.id}/resend-email`, {})).status, 409);
  await c.post(`/api/orders/${pending.id}/cancel`, {});

  const { order } = await paidViaWebhook(c, ['wild-west-legends']);
  assert.equal((await (await makeUser(srv.url)).post(`/api/orders/${order.id}/resend-email`, {})).status, 404);
  // โควตา 5 ครั้ง/10 นาที/ผู้ใช้ — ครั้งที่ลองตอนออเดอร์ยัง pending (409) ก็นับด้วย จึงเหลือ 4
  for (let i = 0; i < 4; i++) assert.equal((await c.post(`/api/orders/${order.id}/resend-email`, {})).status, 200);
  const limited = await c.post(`/api/orders/${order.id}/resend-email`, {});
  assert.equal(limited.status, 429);
  const before = outbox.length;
  await processEmailQueue();
  assert.ok(outbox.length >= before + 1);
  const last = outbox.at(-1);
  assert.ok(last.text.includes('FAKE-'));
});

test('เกมฟรี: บันทึกเป็น payment แบบ free, ได้โค้ด, ส่งอีเมล', async () => {
  await drainEmails();
  const c = await makeUser(srv.url);
  const order = await buy(c, ['battle-arena-x']);
  assert.equal(order.status, 'paid');
  assert.equal(db.prepare("SELECT provider FROM payments WHERE order_id = ?").get(order.id).provider, 'free');
  assert.equal(soldKeys(order.id), 1);
  assert.equal(await processEmailQueue(), 1);
  assert.equal((await c.post(`/api/orders/${order.id}/pay`, {})).status, 409);
});

test('โค้ดเกมถูกเข้ารหัสในฐานข้อมูล (AES-256-GCM) และกันโค้ดซ้ำ', async () => {
  const gid = db.prepare('SELECT id FROM games WHERE slug = ?').get('cozy-farm-life').id;
  assert.equal(addKeys(gid, ['FAKE-ENC-TEST-1111']), 1);
  assert.equal(addKeys(gid, ['FAKE-ENC-TEST-1111', '  FAKE-ENC-TEST-1111  ']), 0); // ซ้ำ (รวมช่องว่าง)
  const row = db.prepare('SELECT * FROM game_keys WHERE key_hash = ?').get(keyHash('FAKE-ENC-TEST-1111'));
  assert.ok(row);
  assert.ok(!row.key_enc.includes('ENC-TEST'));
  assert.match(row.key_enc, /^v1:/);
  assert.equal(decrypt(row.key_enc), 'FAKE-ENC-TEST-1111');
  assert.notEqual(encrypt('same'), encrypt('same')); // IV สุ่มทุกครั้ง
  const parts = row.key_enc.split(':');
  parts[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decrypt(parts.join(':'))); // แก้ข้อมูลแล้วต้องถอดรหัสไม่ผ่าน (auth tag)
  const all = db.prepare('SELECT key_enc FROM game_keys').all();
  assert.ok(all.every((k) => !k.key_enc.includes('FAKE-')));
});

test('production: ไม่มี route จำลองชำระเงิน และ config ปิด devPay', () => {
  const script = `
    import('./server/routes/orders.js').then(async ({ ordersRouter }) => {
      const { config } = await import('./server/config.js');
      const routes = ordersRouter.stack.filter((l) => l.route).map((l) => l.route.path);
      console.log(JSON.stringify({ devPay: config.devPay, hasDevPay: routes.includes('/:id/dev-pay'), hasPay: routes.includes('/:id/pay') }));
    });`;
  const env = validProdEnv();
  const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { env, cwd: process.cwd() }).toString().trim().split('\n').pop());
  assert.deepEqual(out, { devPay: false, hasDevPay: false, hasPay: true });
});
