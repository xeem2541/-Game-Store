import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { withFinal } from './games.js';

export const wishlistRouter = Router();
wishlistRouter.use(requireAuth);

wishlistRouter.get('/', (req, res) => {
  const items = db.prepare(`SELECT g.* FROM wishlist w JOIN games_v g ON g.id = w.game_id
    WHERE w.user_id = ? AND g.active = 1 ORDER BY w.created_at DESC`).all(req.user.id).map(withFinal);
  res.json({ items });
});

wishlistRouter.post('/', (req, res) => {
  const { gameId } = z.object({ gameId: z.number().int().positive() }).parse(req.body);
  if (!db.prepare('SELECT 1 FROM games WHERE id = ? AND active = 1').get(gameId)) {
    return res.status(404).json({ error: 'ไม่พบเกม' });
  }
  db.prepare('INSERT OR IGNORE INTO wishlist (user_id, game_id) VALUES (?, ?)').run(req.user.id, gameId);
  res.status(201).json({ ok: true });
});

wishlistRouter.delete('/:gameId', (req, res) => {
  const gameId = z.coerce.number().int().positive().parse(req.params.gameId);
  db.prepare('DELETE FROM wishlist WHERE user_id = ? AND game_id = ?').run(req.user.id, gameId);
  res.json({ ok: true });
});
