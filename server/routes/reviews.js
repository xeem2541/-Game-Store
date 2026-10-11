import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../services/errors.js';

// mount ที่ /api/games/:id/reviews
export const reviewsRouter = Router({ mergeParams: true });

const idSchema = z.coerce.number().int().positive();
// ซื้อแล้ว = มีออเดอร์ที่ชำระแล้ว (ไม่นับที่คืนเงิน/ยกเลิก) ที่มีเกมนี้ — ใช้ทั้งตอนตรวจสิทธิ์รีวิวและติดป้าย "ซื้อแล้ว"
const purchasedSql = (userExpr, gameExpr) => `EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
  WHERE o.user_id = ${userExpr} AND o.status = 'paid' AND oi.game_id = ${gameExpr})`;
const hasPurchased = (userId, gameId) => !!db.prepare(`SELECT ${purchasedSql('?', '?')} AS ok`).get(userId, gameId).ok;

const bodySchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().max(2000).default(''),
});

reviewsRouter.use((req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success || !db.prepare('SELECT 1 FROM games WHERE id = ? AND active = 1').get(id.data)) {
    return res.status(404).json({ error: 'ไม่พบเกม' });
  }
  req.gameId = id.data;
  next();
});

reviewsRouter.get('/', (req, res) => {
  const page = z.coerce.number().int().min(1).default(1).parse(req.query.page);
  const limit = 10;
  const stats = db.prepare('SELECT COUNT(*) AS count, ROUND(AVG(rating), 1) AS avg FROM reviews WHERE game_id = ?').get(req.gameId);
  const items = db.prepare(`SELECT r.id, r.rating, r.body, r.created_at, r.updated_at, u.name, (r.user_id = ?) AS mine,
      ${purchasedSql('r.user_id', 'r.game_id')} AS verified
    FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.game_id = ?
    ORDER BY r.updated_at DESC, r.id DESC LIMIT ? OFFSET ?`)
    .all(req.user?.id ?? 0, req.gameId, limit, (page - 1) * limit)
    .map((r) => ({ ...r, mine: !!r.mine, verified: !!r.verified }));
  // รีวิวของผู้ใช้เอง (ส่งแยก เพราะอาจไม่อยู่ในหน้าที่ขอ)
  const mine = req.user
    ? db.prepare('SELECT id, rating, body FROM reviews WHERE user_id = ? AND game_id = ?').get(req.user.id, req.gameId) ?? null
    : null;
  const canReview = !!req.user && hasPurchased(req.user.id, req.gameId); // ให้หน้าเว็บบอกได้ว่าทำไมยังรีวิวไม่ได้
  res.json({ items, mine, canReview, count: stats.count, average: stats.avg, page, pages: Math.max(1, Math.ceil(stats.count / limit)) });
});

// รีวิวได้เฉพาะผู้ที่ซื้อเกมนี้แล้ว (กันปั่นคะแนน — คะแนนเฉลี่ยมีผลต่อการเรียงลำดับและ JSON-LD) ; แก้/ลบรีวิวของตัวเองได้เสมอ
reviewsRouter.post('/', requireAuth, (req, res) => {
  const b = bodySchema.parse(req.body);
  if (!hasPurchased(req.user.id, req.gameId)) {
    throw new HttpError(403, 'รีวิวได้เฉพาะผู้ที่ซื้อเกมนี้แล้ว', 'REVIEW_PURCHASE_REQUIRED');
  }
  try {
    db.prepare('INSERT INTO reviews (user_id, game_id, rating, body) VALUES (?, ?, ?, ?)').run(req.user.id, req.gameId, b.rating, b.body);
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'คุณรีวิวเกมนี้แล้ว (แก้ไขรีวิวเดิมได้)' });
    throw e;
  }
  res.status(201).json({ ok: true });
});

reviewsRouter.put('/', requireAuth, (req, res) => {
  const b = bodySchema.parse(req.body);
  const r = db.prepare('UPDATE reviews SET rating = ?, body = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND game_id = ?')
    .run(b.rating, b.body, req.user.id, req.gameId);
  if (!r.changes) return res.status(404).json({ error: 'ยังไม่มีรีวิวของคุณ' });
  res.json({ ok: true });
});

reviewsRouter.delete('/', requireAuth, (req, res) => {
  db.prepare('DELETE FROM reviews WHERE user_id = ? AND game_id = ?').run(req.user.id, req.gameId);
  res.json({ ok: true });
});
