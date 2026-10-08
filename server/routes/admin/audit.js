import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { BKK_DATE, dateStr, likeArg, pageInfo, paging } from './util.js';

// admin เท่านั้น (กำหนดที่ index.js)
export const auditRouter = Router();

auditRouter.get('/', (req, res) => {
  const { page, limit, offset } = paging(req.query, 30);
  const q = z.object({
    userId: z.coerce.number().int().positive().optional(), action: z.string().trim().max(60).optional(),
    q: z.string().trim().max(100).optional(), from: dateStr.optional(), to: dateStr.optional(),
  }).parse(req.query);
  const where = ['1 = 1'];
  const args = [];
  if (q.userId) { where.push('a.user_id = ?'); args.push(q.userId); }
  if (q.action) { where.push("a.action LIKE ? ESCAPE '\\'"); args.push(likeArg(q.action).replace(/^%/, '')); } // ขึ้นต้นด้วย (เช่น order. / key.)
  if (q.q) { where.push("(a.entity_id LIKE ? ESCAPE '\\' OR a.meta LIKE ? ESCAPE '\\')"); args.push(likeArg(q.q), likeArg(q.q)); }
  if (q.from) { where.push(`${BKK_DATE('a.created_at')} >= ?`); args.push(q.from); }
  if (q.to) { where.push(`${BKK_DATE('a.created_at')} <= ?`); args.push(q.to); }
  const w = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log a WHERE ${w}`).get(...args).n;
  const items = db.prepare(`SELECT a.id, a.action, a.entity, a.entity_id AS entityId, a.meta, a.ip, a.created_at AS createdAt,
      a.user_id AS userId, u.name AS userName, u.email AS userEmail
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE ${w} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset)
    .map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
  res.json({ items, ...pageInfo(total, page, limit) });
});
