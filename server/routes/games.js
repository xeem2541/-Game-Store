import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { UPLOAD_DIR } from '../services/images.js';

export const gamesRouter = Router();

export const withFinal = (g) => ({
  ...g,
  finalPrice: Math.round(g.price * (1 - g.discount / 100)),
  cover: `/api/games/${g.slug}/cover.svg`,
});

const SORTS = {
  default: 'featured DESC, sales DESC',
  priceAsc: 'price * (100 - discount) ASC',
  priceDesc: 'price * (100 - discount) DESC',
  rating: 'rating DESC',
  discount: 'discount DESC',
  newest: 'release_date DESC',
  bestseller: 'sales DESC',
};

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  genre: z.string().max(50).optional(),
  platform: z.string().max(50).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  onSale: z.enum(['1']).optional(),
  featured: z.enum(['1']).optional(),
  sort: z.enum(Object.keys(SORTS)).default('default'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(12),
});

// รายการเกม + ค้นหา/กรอง/เรียง/แบ่งหน้า
gamesRouter.get('/', (req, res) => {
  const p = listQuery.parse(req.query);
  const where = ['active = 1'];
  const args = [];
  if (p.q) { where.push('(title LIKE ? OR description LIKE ?)'); args.push(`%${p.q}%`, `%${p.q}%`); }
  if (p.genre) { where.push('genre = ?'); args.push(p.genre); }
  if (p.platform) { where.push('platform = ?'); args.push(p.platform); }
  if (p.minPrice !== undefined) { where.push('price * (100 - discount) / 100 >= ?'); args.push(p.minPrice); }
  if (p.maxPrice !== undefined) { where.push('price * (100 - discount) / 100 <= ?'); args.push(p.maxPrice); }
  if (p.onSale) where.push('discount > 0');
  if (p.featured) where.push('featured = 1');
  const w = where.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) AS n FROM games_v WHERE ${w}`).get(...args).n;
  const items = db.prepare(`SELECT * FROM games_v WHERE ${w} ORDER BY ${SORTS[p.sort]} LIMIT ? OFFSET ?`)
    .all(...args, p.limit, (p.page - 1) * p.limit).map(withFinal);
  res.json({ items, total, page: p.page, pages: Math.max(1, Math.ceil(total / p.limit)) });
});

// autocomplete
gamesRouter.get('/suggest', (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 50);
  if (!q) return res.json([]);
  const rows = db.prepare('SELECT slug, title, genre FROM games_v WHERE active = 1 AND title LIKE ? ORDER BY sales DESC LIMIT 6')
    .all(`%${q}%`);
  res.json(rows);
});

// ตัวเลือกตัวกรอง
gamesRouter.get('/facets', (_req, res) => {
  res.json({
    genres: db.prepare('SELECT DISTINCT genre FROM games_v WHERE active = 1 ORDER BY genre').all().map((r) => r.genre),
    platforms: db.prepare('SELECT DISTINCT platform FROM games_v WHERE active = 1 ORDER BY platform').all().map((r) => r.platform),
  });
});

// หน้าแรก: รวมหลายส่วนในคำขอเดียว
gamesRouter.get('/home', (_req, res) => {
  const q = (order, extra = '') => db.prepare(`SELECT * FROM games_v WHERE active = 1 ${extra} ORDER BY ${order} LIMIT 8`).all().map(withFinal);
  res.json({
    featured: q('sales DESC', 'AND featured = 1'),
    bestsellers: q('sales DESC'),
    newest: q('release_date DESC'),
    onSale: q('discount DESC', 'AND discount > 0'),
  });
});

// ภาพปกแบบ SVG สร้างจากสีของเกม
gamesRouter.get('/:slug/cover.svg', (req, res) => {
  const g = db.prepare('SELECT title, color1, color2, cover_image FROM games WHERE slug = ?').get(req.params.slug);
  if (!g) return res.status(404).end();
  // มีรูปปกที่แอดมินอัปโหลด → ส่งไปที่รูปนั้น (ทำให้ตะกร้า/ออเดอร์/og:image ใช้รูปจริงโดยไม่ต้องแก้หลายที่)
  if (g.cover_image) {
    const thumb = g.cover_image.replace('.webp', '-sm.webp');
    const useThumb = req.query.size === 'sm' && fs.existsSync(path.join(UPLOAD_DIR, thumb));
    return res.set('Cache-Control', 'public, max-age=300').redirect(302, `/uploads/games/${useThumb ? thumb : g.cover_image}`);
  }
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const words = g.title.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 14 && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  lines.push(cur);
  const text = lines.map((l, i) => `<text x="24" y="${290 - (lines.length - 1 - i) * 36}" font-size="32" font-weight="800" fill="#fff" font-family="Segoe UI,Tahoma,sans-serif">${esc(l)}</text>`).join('');
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${g.color1}"/><stop offset="1" stop-color="${g.color2}"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><circle cx="330" cy="70" r="90" fill="#fff" opacity=".12"/><circle cx="60" cy="40" r="40" fill="#000" opacity=".1"/>${text}</svg>`,
  );
});

// รายละเอียดเกม + เกมที่เกี่ยวข้อง
gamesRouter.get('/:slug', (req, res) => {
  const g = db.prepare('SELECT * FROM games_v WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!g) return res.status(404).json({ error: 'ไม่พบเกม' });
  const related = db.prepare('SELECT * FROM games_v WHERE active = 1 AND genre = ? AND id != ? ORDER BY sales DESC LIMIT 4')
    .all(g.genre, g.id).map(withFinal);
  const images = db.prepare("SELECT filename FROM game_images WHERE game_id = ? AND kind = 'screenshot' ORDER BY position, id").all(g.id)
    .map((r) => `/uploads/games/${r.filename}`);
  res.json({ ...withFinal(g), related, images });
});
