import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { audit } from '../../services/audit.js';
import { HttpError } from '../../services/errors.js';
import { idParam, likeArg, pageInfo, paging } from './util.js';

// staff และ admin จัดการรีวิวได้ (คะแนนเฉลี่ยของเกมคำนวณจากตาราง reviews ผ่าน view จึงอัปเดตเองหลังลบ)
export const reviewsAdminRouter = Router();

reviewsAdminRouter.get('/', (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const q = z.object({ q: z.string().trim().max(100).optional(), rating: z.coerce.number().int().min(1).max(5).optional(), gameId: z.coerce.number().int().positive().optional() }).parse(req.query);
  const where = ['1 = 1'];
  const args = [];
  if (q.q) { where.push("(r.body LIKE ? ESCAPE '\\' OR g.title LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')"); args.push(...Array(4).fill(likeArg(q.q))); }
  if (q.rating) { where.push('r.rating = ?'); args.push(q.rating); }
  if (q.gameId) { where.push('r.game_id = ?'); args.push(q.gameId); }
  const w = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM reviews r JOIN games g ON g.id = r.game_id JOIN users u ON u.id = r.user_id WHERE ${w}`).get(...args).n;
  const items = db.prepare(`SELECT r.id, r.rating, r.body, r.created_at AS createdAt, g.id AS gameId, g.title AS gameTitle, u.id AS userId, u.name AS userName, u.email AS userEmail
    FROM reviews r JOIN games g ON g.id = r.game_id JOIN users u ON u.id = r.user_id WHERE ${w} ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json({ items, ...pageInfo(total, page, limit) });
});

reviewsAdminRouter.delete('/:id', (req, res) => {
  const id = idParam.parse(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'กรุณาระบุเหตุผล').max(300) }).parse(req.body);
  const r = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
  if (!r) throw new HttpError(404, 'ไม่พบรีวิว', 'REVIEW_NOT_FOUND');
  db.transaction(() => {
    db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
    audit(req, 'review.delete', 'review', id, { before: { gameId: r.game_id, userId: r.user_id, rating: r.rating, body: r.body }, reason });
  })();
  const game = db.prepare('SELECT rating, review_count AS reviewCount FROM games_v WHERE id = ?').get(r.game_id);
  res.json({ ok: true, game }); // คะแนนเฉลี่ยใหม่ของเกม
});
