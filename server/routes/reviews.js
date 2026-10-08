import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

// mount ที่ /api/games/:id/reviews
export const reviewsRouter = Router({ mergeParams: true });

const idSchema = z.coerce.number().int().positive();
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
  const items = db.prepare(`SELECT r.id, r.rating, r.body, r.created_at, r.updated_at, u.name, (r.user_id = ?) AS mine
    FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.game_id = ?
    ORDER BY r.updated_at DESC, r.id DESC LIMIT ? OFFSET ?`)
    .all(req.user?.id ?? 0, req.gameId, limit, (page - 1) * limit)
    .map((r) => ({ ...r, mine: !!r.mine }));
  // รีวิวของผู้ใช้เอง (ส่งแยก เพราะอาจไม่อยู่ในหน้าที่ขอ)
  const mine = req.user
    ? db.prepare('SELECT id, rating, body FROM reviews WHERE user_id = ? AND game_id = ?').get(req.user.id, req.gameId) ?? null
    : null;
  res.json({ items, mine, count: stats.count, average: stats.avg, page, pages: Math.max(1, Math.ceil(stats.count / limit)) });
});

reviewsRouter.post('/', requireAuth, (req, res) => {
  const b = bodySchema.parse(req.body);
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
