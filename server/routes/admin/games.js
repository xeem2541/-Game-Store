import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { requirePerm } from '../../middleware/adminAuth.js';
import { audit } from '../../services/audit.js';
import { HttpError } from '../../services/errors.js';
import { deleteGameImage, saveGameImage } from '../../services/images.js';
import { finalPrice } from '../../services/pricing.js';
import { slugify } from '../../services/text.js';
import { idParam, likeArg, pageInfo, paging, uploadImage } from './util.js';

export const gamesAdminRouter = Router();

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
// วิดีโอตัวอย่าง: รับเฉพาะลิงก์ embed จากผู้ให้บริการที่อนุญาต (ใช้เป็น src ของ iframe)
const TRAILER_HOSTS = new Set(['www.youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com']);
const trailer = z.string().trim().max(300).url().refine((u) => {
  try { const x = new URL(u); return x.protocol === 'https:' && TRAILER_HOSTS.has(x.hostname); } catch { return false; }
}, 'วิดีโอต้องเป็นลิงก์ https ของ YouTube / Vimeo (แบบ embed)').nullable();

const gameSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกชื่อเกม').max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug ใช้ a-z 0-9 และ - เท่านั้น').max(80),
  description: z.string().trim().min(1, 'กรุณากรอกคำอธิบาย').max(5000),
  description_en: z.string().trim().max(5000),
  genre: z.string().trim().min(1).max(40),
  platform: z.string().trim().min(1).max(30),
  price: z.number().int().min(0).max(100_000_000), // สตางค์
  discount: z.number().int().min(0).max(100),
  release_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  trailer_url: trailer,
  spec_min: z.string().trim().max(1000).nullable(),
  spec_rec: z.string().trim().max(1000).nullable(),
  featured: z.boolean(),
  active: z.boolean(),
  low_stock_threshold: z.number().int().min(0).max(100_000),
  color1: hex,
  color2: hex,
});
const COLS = Object.keys(gameSchema.shape);
const toRow = (g) => ({ ...g, featured: g.featured ? 1 : 0, active: g.active ? 1 : 0 });
const fromRow = (g) => ({ ...g, featured: !!g.featured, active: !!g.active });

const stockOf = (id) => {
  const o = { available: 0, reserved: 0, sold: 0, revoked: 0 };
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM game_keys WHERE game_id = ? GROUP BY status').all(id)) o[r.status] = r.n;
  return o;
};

const SORTS = { id: 'g.id DESC', title: 'g.title COLLATE NOCASE', priceAsc: 'g.price ASC', priceDesc: 'g.price DESC', sales: 'g.sales DESC' };

gamesAdminRouter.get('/', (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const where = ['1 = 1'];
  const args = [];
  const { q, genre, platform, status, sort } = req.query;
  if (q) { where.push("(g.title LIKE ? ESCAPE '\\' OR g.slug LIKE ? ESCAPE '\\')"); args.push(likeArg(q), likeArg(q)); }
  if (genre) { where.push('g.genre = ?'); args.push(String(genre)); }
  if (platform) { where.push('g.platform = ?'); args.push(String(platform)); }
  if (status === 'active') where.push('g.active = 1');
  if (status === 'hidden') where.push('g.active = 0');
  const w = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM games g WHERE ${w}`).get(...args).n;
  const items = db.prepare(`SELECT g.id, g.slug, g.title, g.genre, g.platform, g.price, g.discount, g.active, g.featured, g.cover_image AS coverImage,
      g.low_stock_threshold AS lowStockThreshold,
      (SELECT COUNT(*) FROM game_keys k WHERE k.game_id = g.id AND k.status = 'available') AS available
    FROM games g WHERE ${w} ORDER BY ${SORTS[sort] ?? SORTS.id} LIMIT ? OFFSET ?`).all(...args, limit, offset)
    .map((g) => ({ ...g, active: !!g.active, featured: !!g.featured, finalPrice: finalPrice(g) }));
  res.json({ items, ...pageInfo(total, page, limit) });
});

gamesAdminRouter.get('/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM games WHERE id = ?').get(idParam.parse(req.params.id));
  if (!g) throw new HttpError(404, 'ไม่พบเกม', 'GAME_NOT_FOUND');
  res.json({
    game: fromRow(g),
    stock: stockOf(g.id),
    images: db.prepare("SELECT id, filename FROM game_images WHERE game_id = ? AND kind = 'screenshot' ORDER BY position, id").all(g.id)
      .map((i) => ({ id: i.id, url: `/uploads/games/${i.filename}` })),
    coverUrl: g.cover_image ? `/uploads/games/${g.cover_image}` : null,
    priceHistory: db.prepare(`SELECT h.old_price AS oldPrice, h.new_price AS newPrice, h.old_discount AS oldDiscount, h.new_discount AS newDiscount,
        h.changed_at AS changedAt, u.name AS changedBy FROM price_history h LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.game_id = ? ORDER BY h.id DESC LIMIT 50`).all(g.id),
  });
});

const palette = ['#7c5cff', '#00c6ff', '#ff512f', '#11998e', '#f7971e', '#8e2de2'];

// ---- จากนี้เป็นการแก้ข้อมูล: admin เท่านั้น (staff ดูได้อย่างเดียว) ----
gamesAdminRouter.post('/', requirePerm('games.write'), (req, res) => {
  const raw = { description_en: '', trailer_url: null, spec_min: null, spec_rec: null, featured: false, active: true, low_stock_threshold: 5,
    color1: palette[Math.floor(Math.random() * palette.length)], color2: '#2a2c55', ...req.body };
  raw.slug ||= slugify(String(raw.title ?? ''));
  const g = gameSchema.parse(raw);
  if (db.prepare('SELECT 1 FROM games WHERE slug = ?').get(g.slug)) throw new HttpError(409, 'slug นี้ถูกใช้แล้ว', 'SLUG_TAKEN');
  const row = toRow(g);
  const { lastInsertRowid } = db.prepare(`INSERT INTO games (${COLS.join(', ')}) VALUES (${COLS.map((c) => `@${c}`).join(', ')})`).run(row);
  audit(req, 'game.create', 'game', lastInsertRowid, { after: row });
  res.status(201).json({ id: lastInsertRowid });
});

gamesAdminRouter.put('/:id', requirePerm('games.write'), (req, res) => {
  const id = idParam.parse(req.params.id);
  const before = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  if (!before) throw new HttpError(404, 'ไม่พบเกม', 'GAME_NOT_FOUND');
  const patch = gameSchema.partial().parse(req.body);
  const next = { ...fromRow(before), ...patch };
  if (patch.slug && patch.slug !== before.slug && db.prepare('SELECT 1 FROM games WHERE slug = ? AND id != ?').get(patch.slug, id)) {
    throw new HttpError(409, 'slug นี้ถูกใช้แล้ว', 'SLUG_TAKEN');
  }
  const row = toRow(gameSchema.parse(Object.fromEntries(COLS.map((c) => [c, next[c]])))); // ตรวจความสมบูรณ์ของข้อมูลหลังรวมแล้ว
  const changed = COLS.filter((c) => String(row[c]) !== String(before[c]));
  db.transaction(() => {
    db.prepare(`UPDATE games SET ${COLS.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...row, id });
    // ประวัติราคา: ออเดอร์เก่าไม่กระทบเพราะเก็บ snapshot ใน order_items อยู่แล้ว
    if (row.price !== before.price || row.discount !== before.discount) {
      db.prepare('INSERT INTO price_history (game_id, old_price, new_price, old_discount, new_discount, changed_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, before.price, row.price, before.discount, row.discount, req.user.id);
    }
    if (changed.length) {
      audit(req, 'game.update', 'game', id, {
        before: Object.fromEntries(changed.map((c) => [c, before[c]])), after: Object.fromEntries(changed.map((c) => [c, row[c]])),
      });
    }
  })();
  res.json({ ok: true, changed });
});

// "ลบ" = ซ่อนจากหน้าร้าน (soft delete) ข้อมูล/ออเดอร์/โค้ดเดิมยังอยู่ครบ
gamesAdminRouter.delete('/:id', requirePerm('games.write'), (req, res) => {
  const id = idParam.parse(req.params.id);
  const r = db.prepare('UPDATE games SET active = 0 WHERE id = ?').run(id);
  if (!r.changes) throw new HttpError(404, 'ไม่พบเกม', 'GAME_NOT_FOUND');
  audit(req, 'game.hide', 'game', id, { before: { active: true }, after: { active: false } });
  res.json({ ok: true });
});

// ---- รูปภาพ ----
const MAX_SHOTS = 10;
gamesAdminRouter.post('/:id/images', requirePerm('games.write'), uploadImage, async (req, res) => {
  const id = idParam.parse(req.params.id);
  const kind = z.enum(['cover', 'screenshot']).parse(req.query.kind ?? 'screenshot');
  const game = db.prepare('SELECT id, cover_image FROM games WHERE id = ?').get(id);
  if (!game) throw new HttpError(404, 'ไม่พบเกม', 'GAME_NOT_FOUND');
  if (!req.file) throw new HttpError(400, 'ไม่พบไฟล์ที่อัปโหลด (ฟิลด์ชื่อ file)', 'NO_FILE');
  if (kind === 'screenshot' && db.prepare("SELECT COUNT(*) AS n FROM game_images WHERE game_id = ? AND kind = 'screenshot'").get(id).n >= MAX_SHOTS) {
    throw new HttpError(409, `เพิ่มภาพตัวอย่างได้ไม่เกิน ${MAX_SHOTS} ภาพ`, 'TOO_MANY_IMAGES');
  }
  const filename = await saveGameImage(req.file.buffer, kind);
  if (kind === 'cover') {
    db.prepare('UPDATE games SET cover_image = ? WHERE id = ?').run(filename, id);
    deleteGameImage(game.cover_image);
  } else {
    const pos = db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM game_images WHERE game_id = ? AND kind = 'screenshot'").get(id).p;
    db.prepare("INSERT INTO game_images (game_id, filename, kind, position) VALUES (?, ?, 'screenshot', ?)").run(id, filename, pos);
  }
  audit(req, kind === 'cover' ? 'game.cover_set' : 'game.image_add', 'game', id, { filename });
  res.status(201).json({ url: `/uploads/games/${filename}` });
});

gamesAdminRouter.delete('/:id/cover', requirePerm('games.write'), (req, res) => {
  const id = idParam.parse(req.params.id);
  const g = db.prepare('SELECT cover_image FROM games WHERE id = ?').get(id);
  if (!g) throw new HttpError(404, 'ไม่พบเกม', 'GAME_NOT_FOUND');
  db.prepare('UPDATE games SET cover_image = NULL WHERE id = ?').run(id);
  deleteGameImage(g.cover_image);
  audit(req, 'game.cover_remove', 'game', id, { filename: g.cover_image });
  res.json({ ok: true });
});

gamesAdminRouter.delete('/:id/images/:imageId', requirePerm('games.write'), (req, res) => {
  const id = idParam.parse(req.params.id);
  const img = db.prepare('SELECT * FROM game_images WHERE id = ? AND game_id = ?').get(idParam.parse(req.params.imageId), id);
  if (!img) throw new HttpError(404, 'ไม่พบรูปภาพ', 'IMAGE_NOT_FOUND');
  db.prepare('DELETE FROM game_images WHERE id = ?').run(img.id);
  deleteGameImage(img.filename);
  audit(req, 'game.image_remove', 'game', id, { filename: img.filename });
  res.json({ ok: true });
});
