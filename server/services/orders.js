import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { evaluateCoupon } from './coupons.js';
import { enqueueEmail } from './emailQueue.js';
import { HttpError } from './errors.js';
import { releaseReserved, reserveForOrder, revokeForOrder, sellForOrder } from './keys.js';
import { priceCart } from './pricing.js';

// State machine: ข้ามสถานะผิดลำดับไม่ได้ (cancelled / refunded เป็นสถานะสุดท้าย)
export const TRANSITIONS = {
  pending: ['paid', 'cancelled'],
  paid: ['refunded'],
  cancelled: [],
  refunded: [],
};

// แจ้งส่วนอื่นหลัง transaction commit แล้ว (เช่น สั่ง Stripe ให้ expire session) — ผู้ฟังต้องไม่ throw
export const orderEvents = new EventEmitter();

const coverOf = (slug) => `/api/games/${slug}/cover.svg`;

export function serializeOrder(o) {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(o.id).map((i) => ({
    gameId: i.game_id, slug: i.slug, title: i.title, platform: i.platform, cover: coverOf(i.slug),
    listPrice: i.list_price, discountPercent: i.discount_percent, unitPrice: i.unit_price,
  }));
  const invoice = db.prepare('SELECT number FROM invoices WHERE order_id = ?').get(o.id);
  return {
    id: o.id, status: o.status, currency: o.currency, invoiceNumber: invoice?.number ?? null,
    subtotal: o.subtotal, gameDiscount: o.game_discount,
    couponCode: o.coupon_code, couponDiscount: o.coupon_discount, total: o.total,
    createdAt: o.created_at, expiresAt: o.expires_at, paidAt: o.paid_at, cancelledAt: o.cancelled_at,
    refundedAt: o.refunded_at, cancelReason: o.cancel_reason, items,
  };
}

// เลขที่ใบเสร็จรันต่อเนื่องจากตาราง invoices (INV-ปี-000001)
function issueInvoice(orderId) {
  const { lastInsertRowid } = db.prepare('INSERT INTO invoices (order_id, number) VALUES (?, ?)').run(orderId, `tmp-${orderId}`);
  db.prepare('UPDATE invoices SET number = ? WHERE id = ?')
    .run(`INV-${new Date().getFullYear()}-${String(lastInsertRowid).padStart(6, '0')}`, lastInsertRowid);
}

export function transition(orderId, to, { reason = null, actorId = null } = {}) {
  const updated = db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new HttpError(404, 'ไม่พบคำสั่งซื้อ', 'ORDER_NOT_FOUND');
    if (!TRANSITIONS[order.status]?.includes(to)) {
      throw new HttpError(409, `ไม่สามารถเปลี่ยนสถานะคำสั่งซื้อจาก ${order.status} เป็น ${to} ได้`, 'ORDER_BAD_STATE', { from: order.status, to });
    }
    const stamp = { paid: 'paid_at', cancelled: 'cancelled_at', refunded: 'refunded_at' }[to];
    db.prepare(`UPDATE orders SET status = ?, ${stamp} = CURRENT_TIMESTAMP, cancel_reason = ? WHERE id = ?`)
      .run(to, to === 'cancelled' ? reason : order.cancel_reason, orderId);

    db.prepare('INSERT INTO order_events (order_id, from_status, to_status, reason, actor_id) VALUES (?, ?, ?, ?, ?)')
      .run(orderId, order.status, to, reason, actorId);
    if (to === 'cancelled') {
      db.prepare('DELETE FROM coupon_usages WHERE order_id = ?').run(orderId); // คืนสิทธิ์คูปอง
      releaseReserved(orderId); // คืนโค้ดที่จองไว้เข้าสต็อก
    }
    if (to === 'paid') {
      // ทุกอย่างอยู่ใน transaction เดียว: ถ้าโค้ดไม่พอ sellForOrder จะ throw แล้วออเดอร์ยังเป็น pending
      sellForOrder(orderId);
      issueInvoice(orderId);
      db.prepare('DELETE FROM cart_items WHERE user_id = ? AND game_id IN (SELECT game_id FROM order_items WHERE order_id = ?)')
        .run(order.user_id, orderId);
      enqueueEmail('order_paid', orderId);
    }
    if (to === 'refunded') {
      revokeForOrder(orderId); // เพิกถอนโค้ด (เกมออกจากคลังผู้ใช้เพราะคลังนับเฉพาะออเดอร์ paid)
      db.prepare('DELETE FROM coupon_usages WHERE order_id = ?').run(orderId);
    }
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  })();
  orderEvents.emit('status', updated, to); // หลัง commit (ถ้าเรียกซ้อนใน transaction อื่น ผู้ฟังต้องทนได้)
  return updated;
}

// ยกเลิกออเดอร์ pending ที่เลยเวลา คืนจำนวนที่หมดอายุ
export function expirePending(now = Date.now()) {
  const ids = db.prepare("SELECT id FROM orders WHERE status = 'pending' AND expires_at <= ?").all(now).map((r) => r.id);
  for (const id of ids) transition(id, 'cancelled', { reason: 'expired' });
  return ids.length;
}

export function getOwnOrder(userId, orderId) {
  expirePending();
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, userId);
  if (!o) throw new HttpError(404, 'ไม่พบคำสั่งซื้อ', 'ORDER_NOT_FOUND'); // ของคนอื่นก็ตอบ 404 เหมือนกัน
  return o;
}

const cartGames = (userId) => db.prepare(`SELECT g.* FROM cart_items c JOIN games g ON g.id = c.game_id
  WHERE c.user_id = ? ORDER BY c.added_at, g.id`).all(userId);

const ownedGameIds = (userId, status, gameIds) => {
  if (!gameIds.length) return [];
  return db.prepare(`SELECT DISTINCT oi.game_id FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.user_id = ? AND o.status = ? AND oi.game_id IN (${gameIds.map(() => '?').join(',')})`)
    .all(userId, status, ...gameIds).map((r) => r.game_id);
};

// สรุปราคาตะกร้าของผู้ใช้ (ใช้ทั้งหน้าตะกร้า/checkout) — คำนวณจากฐานข้อมูลเท่านั้น
export function buildSummary(userId, couponCode) {
  const games = cartGames(userId).filter((g) => g.active);
  const base = priceCart(games);
  let coupon = null;
  let couponError = null;
  if (couponCode) {
    const r = evaluateCoupon(couponCode, userId, base.subtotal - base.gameDiscount);
    if (r.ok) coupon = r.coupon;
    else couponError = { code: r.code, message: r.message, params: r.params };
  }
  const priced = priceCart(games, coupon);
  const owned = ownedGameIds(userId, 'paid', games.map((g) => g.id));
  const bySlug = new Map(games.map((g) => [g.id, g]));
  return {
    ...priced,
    items: priced.items.map((i) => ({ ...i, cover: coverOf(i.slug), owned: owned.includes(i.gameId) })),
    coupon: coupon ? { code: coupon.code, type: coupon.type, value: coupon.value } : null,
    couponError,
    owned: owned.map((id) => bySlug.get(id).slug),
    currency: 'THB',
  };
}

export function createOrder(user, { couponCode, idempotencyKey }) {
  return db.transaction(() => {
    // กันกดซ้ำ: key เดิมของผู้ใช้เดิม → คืนออเดอร์เดิม
    const existing = db.prepare('SELECT * FROM orders WHERE user_id = ? AND idempotency_key = ?').get(user.id, idempotencyKey);
    if (existing) return { order: existing, created: false };

    const all = cartGames(user.id);
    if (!all.length) throw new HttpError(400, 'ตะกร้าว่างเปล่า', 'CART_EMPTY');
    const unavailable = all.filter((g) => !g.active);
    if (unavailable.length) {
      throw new HttpError(409, 'มีเกมที่หยุดจำหน่ายแล้ว: ' + unavailable.map((g) => g.title).join(', '), 'GAME_UNAVAILABLE', { titles: unavailable.map((g) => g.title).join(', ') });
    }
    const ids = all.map((g) => g.id);
    const owned = ownedGameIds(user.id, 'paid', ids);
    if (owned.length) {
      const titles = all.filter((g) => owned.includes(g.id)).map((g) => g.title).join(', ');
      throw new HttpError(409, 'คุณมีเกมนี้ในคลังแล้ว: ' + titles, 'ALREADY_OWNED', { titles });
    }
    const pending = ownedGameIds(user.id, 'pending', ids);
    if (pending.length) {
      const titles = all.filter((g) => pending.includes(g.id)).map((g) => g.title).join(', ');
      throw new HttpError(409, 'มีคำสั่งซื้อที่รอชำระของเกมนี้อยู่แล้ว: ' + titles, 'PENDING_EXISTS', { titles });
    }

    const base = priceCart(all);
    let coupon = null;
    if (couponCode) {
      const r = evaluateCoupon(couponCode, user.id, base.subtotal - base.gameDiscount);
      if (!r.ok) throw new HttpError(422, r.message, r.code, r.params);
      coupon = r.coupon;
    }
    const p = priceCart(all, coupon);

    const expiresAt = Date.now() + config.orderExpiryMinutes * 60_000;
    const { lastInsertRowid: orderId } = db.prepare(`INSERT INTO orders
      (user_id, subtotal, game_discount, coupon_id, coupon_code, coupon_discount, total, idempotency_key, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, p.subtotal, p.gameDiscount, coupon?.id ?? null, coupon?.code ?? null, p.couponDiscount, p.total, idempotencyKey, expiresAt);
    const insItem = db.prepare(`INSERT INTO order_items (order_id, game_id, slug, title, platform, list_price, discount_percent, unit_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const i of p.items) insItem.run(orderId, i.gameId, i.slug, i.title, i.platform, i.listPrice, i.discountPercent, i.unitPrice);
    if (coupon) db.prepare('INSERT INTO coupon_usages (coupon_id, user_id, order_id) VALUES (?, ?, ?)').run(coupon.id, user.id, orderId);
    db.prepare("INSERT INTO order_events (order_id, from_status, to_status) VALUES (?, NULL, 'pending')").run(orderId);
    reserveForOrder(orderId); // จองโค้ดเกม: ไม่พอ → throw 409 OUT_OF_STOCK แล้ว rollback ทั้งออเดอร์

    // ยอด 0 บาท (เกมฟรี/คูปองเต็มจำนวน) ไม่ต้องรอชำระเงิน
    if (p.total === 0) {
      db.prepare("INSERT INTO payments (order_id, provider, amount, currency, status) VALUES (?, 'free', 0, 'thb', 'succeeded')").run(orderId);
    }
    const order = p.total === 0 ? transition(orderId, 'paid') : db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    return { order, created: true };
  })();
}
