import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { UPLOAD_DIR } from '../services/images.js';
import { FINAL_PRICE_SQL, finalPrice } from '../services/pricing.js';
import { likeArg } from '../services/text.js';
import { coverSvg, sceneSvg } from '../services/coverArt.js';
import { BM25_WEIGHTS, ftsMatch, parseQuery, segmentThai, shortTermSql } from '../services/search.js';

export const gamesRouter = Router();

export const withFinal = (g) => ({
  ...g,
  finalPrice: finalPrice(g),
  cover: `/api/games/${g.slug}/cover.svg`,
});

const SORTS = {
  default: 'featured DESC, sales DESC',
  priceAsc: `${FINAL_PRICE_SQL} ASC, id`,
  priceDesc: `${FINAL_PRICE_SQL} DESC, id`,
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
  // รายการ slug คั่นด้วยจุลภาค (สูงสุด 12) — หน้าแรกใช้ดึง "เกมที่เพิ่งดู" ที่จำไว้ในเครื่องผู้ใช้
  slugs: z.string().max(400).regex(/^[a-z0-9-]+(,[a-z0-9-]+){0,11}$/).optional(),
  sort: z.enum(Object.keys(SORTS)).default('default'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(12),
});

// รายการเกม + ค้นหา/กรอง/เรียง/แบ่งหน้า
// ค้นหา: เรียงตามความเกี่ยวข้อง (ชื่อเกมขึ้นต้นด้วยคำค้นก่อน แล้วตามคะแนน bm25) เมื่อไม่ได้เลือกการเรียงเอง
// ไม่พบ → ผ่อนปรนทีละขั้น: (1) แยกวลีไทยเป็นคำ ต้องมีครบทุกคำ (2) มีคำใดคำหนึ่ง — แล้วตอบ relaxed: true ให้หน้าเว็บบอกผู้ใช้
gamesRouter.get('/', (req, res) => {
  const p = listQuery.parse(req.query);
  const where = ['g.active = 1'];
  const args = [];
  if (p.genre) { where.push('g.genre = ?'); args.push(p.genre); }
  if (p.platform) { where.push('g.platform = ?'); args.push(p.platform); }
  if (p.minPrice !== undefined) { where.push(`${FINAL_PRICE_SQL} >= ?`); args.push(p.minPrice); }
  if (p.maxPrice !== undefined) { where.push(`${FINAL_PRICE_SQL} <= ?`); args.push(p.maxPrice); }
  if (p.onSale) where.push('g.discount > 0');
  if (p.featured) where.push('g.featured = 1');
  if (p.slugs) { const list = p.slugs.split(','); where.push(`g.slug IN (${list.map(() => '?').join(',')})`); args.push(...list); }

  const parsed = parseQuery(p.q);
  const { terms } = parsed;
  const run = ({ long, short }, any = false) => {
    const w = [...where];
    const a = [...args];
    let from = 'games_v g';
    const fa = [];
    if (long.length) {
      from += ` JOIN (SELECT rowid, bm25(games_fts, ${BM25_WEIGHTS}) AS score FROM games_fts WHERE games_fts MATCH ?) f ON f.rowid = g.id`;
      fa.push(ftsMatch(long, { any }));
    }
    if (short.length && !any) { // โหมดผ่อนปรนไม่บังคับคำสั้น (เช่น "ใน", "of")
      const st = shortTermSql(short);
      w.push(...st.sql);
      a.push(...st.args);
    }
    const order = terms.length && p.sort === 'default'
      ? `(g.title LIKE ? ESCAPE '\\') DESC, ${long.length ? 'f.score, ' : ''}g.sales DESC`
      : SORTS[p.sort];
    const oa = terms.length && p.sort === 'default' ? [likeArg(terms.join(' ')).slice(1)] : []; // ชื่อขึ้นต้นด้วยคำค้น ("dragon%")
    const sqlW = w.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM ${from} WHERE ${sqlW}`).get(...fa, ...a).n;
    const items = db.prepare(`SELECT g.* FROM ${from} WHERE ${sqlW} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...fa, ...a, ...oa, p.limit, (p.page - 1) * p.limit).map(withFinal);
    return { items, total };
  };
  let r = run(parsed);
  let relaxed = false;
  if (!r.total && terms.length) {
    const words = segmentThai(terms) ?? parsed;
    if (words !== parsed) r = run(words);
    if (!r.total && words.terms.length > 1 && words.long.length) r = run(words, true);
    relaxed = r.total > 0;
  }
  res.json({ items: r.items, total: r.total, page: p.page, pages: Math.max(1, Math.ceil(r.total / p.limit)), ...(relaxed && { relaxed }) });
});

// autocomplete: ชื่อเกมที่ขึ้นต้นด้วยคำค้นก่อน แล้วตามความเกี่ยวข้อง (ชื่อมีน้ำหนักสูงสุด) — ค้นทุกคอลัมน์
// เพื่อให้คำไทย เช่น "มังกร" แนะนำ Dragon Realm ได้ (ชื่อเกมเป็นภาษาอังกฤษ)
gamesRouter.get('/suggest', (req, res) => {
  const q = String(req.query.q ?? '').normalize('NFC').trim().slice(0, 50);
  if (!q) return res.json([]);
  const { long, short } = parseQuery(q);
  const prefix = likeArg(q).slice(1); // "q%"
  const rows = long.length && !short.length
    ? db.prepare(`SELECT g.slug, g.title, g.genre FROM games_v g
        JOIN (SELECT rowid, bm25(games_fts, ${BM25_WEIGHTS}) AS score FROM games_fts WHERE games_fts MATCH ?) f ON f.rowid = g.id
        WHERE g.active = 1 ORDER BY (g.title LIKE ? ESCAPE '\\') DESC, f.score, g.sales DESC LIMIT 6`).all(ftsMatch(long), prefix)
    : db.prepare(`SELECT slug, title, genre FROM games_v WHERE active = 1 AND title LIKE ? ESCAPE '\\'
        ORDER BY (title LIKE ? ESCAPE '\\') DESC, sales DESC LIMIT 6`).all(likeArg(q), prefix);
  res.json(rows);
});

// ตัวเลือกตัวกรอง
gamesRouter.get('/facets', (_req, res) => {
  res.json({
    genres: db.prepare('SELECT DISTINCT genre FROM games_v WHERE active = 1 ORDER BY genre').all().map((r) => r.genre),
    platforms: db.prepare('SELECT DISTINCT platform FROM games_v WHERE active = 1 ORDER BY platform').all().map((r) => r.platform),
    // ช่องแนวเกมแบบ bento หน้ารวมเกม: จำนวนเกม + เกมขายดีสุดของแนว (ใช้ฉากของเกมนั้นเป็นพื้นหลังช่อง)
    genreStats: db.prepare(`SELECT genre, COUNT(*) AS count,
        (SELECT slug FROM games_v t WHERE t.active = 1 AND t.genre = g.genre ORDER BY sales DESC, id LIMIT 1) AS slug
      FROM games_v g WHERE active = 1 GROUP BY genre ORDER BY count DESC, genre`).all(),
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

// ภาพปกแบบ SVG สร้างอัตโนมัติ (ฉากตามแนวเกม + ชื่อเกม จากสีของเกม — services/coverArt.js)
gamesRouter.get('/:slug/cover.svg', (req, res) => {
  const g = db.prepare('SELECT slug, title, genre, color1, color2, cover_image FROM games WHERE slug = ?').get(req.params.slug);
  if (!g) return res.status(404).end();
  // มีรูปปกที่แอดมินอัปโหลด → ส่งไปที่รูปนั้น (ทำให้ตะกร้า/ออเดอร์/og:image ใช้รูปจริงโดยไม่ต้องแก้หลายที่)
  if (g.cover_image) {
    const thumb = g.cover_image.replace('.webp', '-sm.webp');
    const useThumb = req.query.size === 'sm' && fs.existsSync(path.join(UPLOAD_DIR, thumb));
    return res.set('Cache-Control', 'public, max-age=300').redirect(302, `/uploads/games/${useThumb ? thumb : g.cover_image}`);
  }
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(coverSvg(g));
});

// ฉากของเกมแบบไม่มีชื่อเกม (พื้นหลังช่องแนวเกมหน้ารวมเกม) — สร้างจากสี/แนวเกมเสมอ ไม่ใช้รูปที่อัปโหลด
gamesRouter.get('/:slug/scene.svg', (req, res) => {
  const g = db.prepare('SELECT slug, genre, color1, color2 FROM games WHERE slug = ?').get(req.params.slug);
  if (!g) return res.status(404).end();
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(sceneSvg(g));
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
