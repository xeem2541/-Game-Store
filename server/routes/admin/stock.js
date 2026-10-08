import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { adminOnly, requirePerm } from '../../middleware/adminAuth.js';
import { audit } from '../../services/audit.js';
import { decrypt, encrypt, keyHash, maskKey } from '../../services/crypto.js';
import { MAX_KEY_ROWS, parseKeyCsv } from '../../services/csv.js';
import { HttpError } from '../../services/errors.js';
import { idParam, likeArg, pageInfo, paging, uploadCsv } from './util.js';

export const stockRouter = Router();

// ภาพรวมสต็อกต่อเกม (available / reserved / sold / revoked) + เกณฑ์แจ้งเตือน
stockRouter.get('/', (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const q = req.query.q ? String(req.query.q) : null;
  const where = q ? "WHERE g.title LIKE ? ESCAPE '\\'" : '';
  const args = q ? [likeArg(q)] : [];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM games g ${where}`).get(...args).n;
  const items = db.prepare(`SELECT g.id, g.title, g.active, g.low_stock_threshold AS threshold,
      COALESCE(SUM(k.status = 'available'), 0) AS available, COALESCE(SUM(k.status = 'reserved'), 0) AS reserved,
      COALESCE(SUM(k.status = 'sold'), 0) AS sold, COALESCE(SUM(k.status = 'revoked'), 0) AS revoked
    FROM games g LEFT JOIN game_keys k ON k.game_id = g.id ${where}
    GROUP BY g.id ORDER BY (COALESCE(SUM(k.status = 'available'), 0) - g.low_stock_threshold) ASC, g.title LIMIT ? OFFSET ?`)
    .all(...args, limit, offset).map((r) => ({ ...r, active: !!r.active, low: r.active && r.available < r.threshold }));
  res.json({ items, ...pageInfo(total, page, limit) });
});

// รายการโค้ดของเกม: แสดงแบบปิดบังบางส่วนเท่านั้น (ดูเต็มต้องกด reveal และถูกบันทึก audit log)
stockRouter.get('/:gameId/keys', (req, res) => {
  const gameId = idParam.parse(req.params.gameId);
  const { page, limit, offset } = paging(req.query);
  const status = z.enum(['available', 'reserved', 'sold', 'revoked']).optional().parse(req.query.status);
  const w = status ? 'AND k.status = ?' : '';
  const args = status ? [gameId, status] : [gameId];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM game_keys k WHERE k.game_id = ? ${w}`).get(...args).n;
  const items = db.prepare(`SELECT k.id, k.key_enc, k.status, k.created_at AS createdAt, k.sold_at AS soldAt, k.revoked_at AS revokedAt,
      k.revoke_reason AS revokeReason, oi.order_id AS orderId
    FROM game_keys k LEFT JOIN order_items oi ON oi.id = k.order_item_id
    WHERE k.game_id = ? ${w} ORDER BY k.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset)
    .map(({ key_enc: enc, ...r }) => ({ ...r, masked: maskKey(decrypt(enc)) }));
  res.json({ items, ...pageInfo(total, page, limit) });
});

stockRouter.put('/:gameId/threshold', requirePerm('stock.write'), (req, res) => {
  const gameId = idParam.parse(req.params.gameId);
  const { threshold } = z.object({ threshold: z.number().int().min(0).max(100_000) }).parse(req.body);
  const g = db.prepare('SELECT low_stock_threshold AS t FROM games WHERE id = ?').get(gameId);
  if (!g) throw new HttpError(404, 'ไม่พบเกม', 'GAME_NOT_FOUND');
  db.prepare('UPDATE games SET low_stock_threshold = ? WHERE id = ?').run(threshold, gameId);
  audit(req, 'stock.threshold', 'game', gameId, { before: g.t, after: threshold });
  res.json({ ok: true });
});

// นำเข้าโค้ดจากไฟล์ CSV (หนึ่งโค้ดต่อบรรทัด) — ตรวจรูปแบบ ตัดซ้ำ เข้ารหัสก่อนบันทึก และสรุปผล
stockRouter.post('/:gameId/import', requirePerm('stock.write'), uploadCsv, (req, res) => {
  const gameId = idParam.parse(req.params.gameId);
  if (!db.prepare('SELECT 1 FROM games WHERE id = ?').get(gameId)) throw new HttpError(404, 'ไม่พบเกม', 'GAME_NOT_FOUND');
  if (!req.file) throw new HttpError(400, 'ไม่พบไฟล์ที่อัปโหลด (ฟิลด์ชื่อ file)', 'NO_FILE');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(req.file.buffer); } catch { text = null; }
  if (text === null || text.includes('\0')) throw new HttpError(400, 'ไฟล์ต้องเป็นข้อความ UTF-8 (CSV)', 'BAD_CSV');

  const parsed = parseKeyCsv(text);
  if (parsed.rows > MAX_KEY_ROWS) throw new HttpError(400, `นำเข้าได้ครั้งละไม่เกิน ${MAX_KEY_ROWS} แถว`, 'TOO_MANY_ROWS');

  const ins = db.prepare('INSERT OR IGNORE INTO game_keys (game_id, key_enc, key_hash) VALUES (?, ?, ?)');
  let added = 0;
  db.transaction(() => { for (const code of parsed.valid) added += ins.run(gameId, encrypt(code), keyHash(code)).changes; })();

  const result = {
    rows: parsed.rows,
    added,
    duplicates: parsed.duplicatesInFile + (parsed.valid.length - added), // ซ้ำในไฟล์ + ซ้ำกับที่มีอยู่ในระบบ
    invalid: parsed.invalid.length,
    invalidRows: parsed.invalid.slice(0, 20),
  };
  audit(req, 'stock.import', 'game', gameId, { rows: result.rows, added, duplicates: result.duplicates, invalid: result.invalid }); // ไม่บันทึกตัวโค้ด
  res.json(result);
});

// ดูโค้ดเต็ม (admin เท่านั้น) — บันทึก audit log ทุกครั้ง
stockRouter.post('/keys/:keyId/reveal', adminOnly, (req, res) => {
  const row = db.prepare('SELECT id, game_id, key_enc, status FROM game_keys WHERE id = ?').get(idParam.parse(req.params.keyId));
  if (!row) throw new HttpError(404, 'ไม่พบโค้ด', 'KEY_NOT_FOUND');
  audit(req, 'key.reveal', 'game_key', row.id, { gameId: row.game_id, status: row.status });
  res.set('Cache-Control', 'no-store').json({ code: decrypt(row.key_enc) });
});

// เพิกถอนโค้ดที่ "ยังไม่ขาย" (available) พร้อมเหตุผล — โค้ดที่ขายแล้ว/ถูกจองอยู่ไม่มีวิธีลบ
stockRouter.post('/keys/:keyId/revoke', requirePerm('stock.write'), (req, res) => {
  const id = idParam.parse(req.params.keyId);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'กรุณาระบุเหตุผล').max(300) }).parse(req.body);
  const k = db.prepare('SELECT id, game_id, status FROM game_keys WHERE id = ?').get(id);
  if (!k) throw new HttpError(404, 'ไม่พบโค้ด', 'KEY_NOT_FOUND');
  if (k.status === 'sold') throw new HttpError(409, 'โค้ดที่ขายแล้วลบหรือเพิกถอนไม่ได้ (ใช้การคืนเงินของออเดอร์แทน)', 'KEY_SOLD');
  if (k.status !== 'available') throw new HttpError(409, `เพิกถอนได้เฉพาะโค้ดที่ยังว่าง (สถานะปัจจุบัน: ${k.status})`, 'KEY_NOT_AVAILABLE');
  const r = db.prepare("UPDATE game_keys SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, revoke_reason = ?, revoked_by = ? WHERE id = ? AND status = 'available'")
    .run(reason, req.user.id, id);
  if (!r.changes) throw new HttpError(409, 'โค้ดถูกใช้ไปแล้ว', 'KEY_NOT_AVAILABLE');
  audit(req, 'key.revoke', 'game_key', id, { gameId: k.game_id, reason });
  res.json({ ok: true });
});
