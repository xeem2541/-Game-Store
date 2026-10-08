import { db } from '../db/index.js';
import { decrypt, encrypt, keyHash } from './crypto.js';
import { HttpError } from './errors.js';

// สถานะโค้ด: available → reserved (จองตอนสร้างออเดอร์) → sold (ตอนชำระแล้ว) → revoked (ตอนคืนเงิน)
//            reserved → available (ยกเลิก/หมดอายุ)

export function addKeys(gameId, codes) {
  const stmt = db.prepare('INSERT OR IGNORE INTO game_keys (game_id, key_enc, key_hash) VALUES (?, ?, ?)');
  let added = 0;
  db.transaction(() => {
    for (const raw of codes) {
      const code = String(raw).trim();
      if (code) added += stmt.run(gameId, encrypt(code), keyHash(code)).changes;
    }
  })();
  return added;
}

export const availableCount = (gameId) => db.prepare("SELECT COUNT(*) AS n FROM game_keys WHERE game_id = ? AND status = 'available'").get(gameId).n;

// จองโค้ด 1 ตัวต่อรายการ — UPDATE ... WHERE id = (SELECT ...) เป็นคำสั่งเดียว (atomic) กันสองคนได้โค้ดเดียวกัน
// เรียกภายใน transaction ของผู้เรียก: ถ้าโค้ดไม่พอจะ throw ให้ทั้ง transaction ถูก rollback
export function reserveForOrder(orderId) {
  const items = db.prepare('SELECT id, game_id, title FROM order_items WHERE order_id = ?').all(orderId);
  const claim = db.prepare(`UPDATE game_keys SET status = 'reserved', order_item_id = ?
    WHERE id = (SELECT id FROM game_keys WHERE game_id = ? AND status = 'available' ORDER BY id LIMIT 1)`);
  const short = items.filter((i) => claim.run(i.id, i.game_id).changes === 0).map((i) => i.title);
  if (short.length) {
    throw new HttpError(409, 'โค้ดเกมหมดสต็อก: ' + short.join(', '), 'OUT_OF_STOCK', { titles: short.join(', ') });
  }
}

export function releaseReserved(orderId) {
  db.prepare(`UPDATE game_keys SET status = 'available', order_item_id = NULL
    WHERE status = 'reserved' AND order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)`).run(orderId);
}

// ขายโค้ด: ใช้ตัวที่จองไว้ ถ้าไม่มี (เช่น จองหลุดไปแล้ว) พยายามหยิบตัวว่าง ถ้าไม่พอ throw → rollback
export function sellForOrder(orderId) {
  const items = db.prepare('SELECT id, game_id, title FROM order_items WHERE order_id = ?').all(orderId);
  const sellReserved = db.prepare("UPDATE game_keys SET status = 'sold', sold_at = CURRENT_TIMESTAMP WHERE status = 'reserved' AND order_item_id = ?");
  const claimFree = db.prepare(`UPDATE game_keys SET status = 'sold', order_item_id = ?, sold_at = CURRENT_TIMESTAMP
    WHERE id = (SELECT id FROM game_keys WHERE game_id = ? AND status = 'available' ORDER BY id LIMIT 1)`);
  const short = [];
  for (const i of items) {
    if (sellReserved.run(i.id).changes === 0 && claimFree.run(i.id, i.game_id).changes === 0) short.push(i.title);
  }
  if (short.length) throw new HttpError(409, 'โค้ดเกมหมดสต็อก: ' + short.join(', '), 'OUT_OF_STOCK', { titles: short.join(', ') });
}

export function revokeForOrder(orderId) {
  db.prepare(`UPDATE game_keys SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
    WHERE status = 'sold' AND order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)`).run(orderId);
}

// ถอดรหัสโค้ดของออเดอร์ (เรียกเฉพาะตอนแสดงให้เจ้าของ/ส่งอีเมล)
export function keysForOrder(orderId) {
  return db.prepare(`SELECT oi.id AS orderItemId, oi.game_id AS gameId, oi.slug, oi.title, oi.platform, k.key_enc
    FROM order_items oi JOIN game_keys k ON k.order_item_id = oi.id AND k.status = 'sold'
    WHERE oi.order_id = ? ORDER BY oi.id`).all(orderId)
    .map(({ key_enc: enc, ...rest }) => ({ ...rest, code: decrypt(enc) }));
}
