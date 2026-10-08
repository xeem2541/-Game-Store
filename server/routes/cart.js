import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { buildSummary } from '../services/orders.js';
import { withFinal } from './games.js';

export const cartRouter = Router();
cartRouter.use(requireAuth);

const readCart = (userId) => db.prepare(`SELECT g.* FROM cart_items c JOIN games_v g ON g.id = c.game_id
  WHERE c.user_id = ? AND g.active = 1 ORDER BY c.added_at, g.id`).all(userId).map(withFinal);

cartRouter.get('/', (req, res) => res.json({ items: readCart(req.user.id) }));

// สรุปราคาที่เซิร์ฟเวอร์คำนวณ (สตางค์) พร้อมคูปองถ้าส่ง ?coupon=CODE
cartRouter.get('/summary', (req, res) => {
  const coupon = z.string().trim().max(40).optional().parse(req.query.coupon);
  res.json(buildSummary(req.user.id, coupon));
});

// แทนที่ตะกร้าทั้งชุดด้วยรายการ slug ที่ส่งมา (สลักที่ไม่มีอยู่จริงจะถูกข้าม)
cartRouter.put('/', (req, res) => {
  const { slugs } = z.object({ slugs: z.array(z.string().max(100)).max(100) }).parse(req.body);
  const find = db.prepare('SELECT id FROM games WHERE slug = ? AND active = 1');
  const ins = db.prepare('INSERT OR IGNORE INTO cart_items (user_id, game_id) VALUES (?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
    for (const s of slugs) {
      const g = find.get(s);
      if (g) ins.run(req.user.id, g.id);
    }
  })();
  res.json({ items: readCart(req.user.id) });
});
