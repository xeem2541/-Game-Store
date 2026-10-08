import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db/index.js';
import { publicUser, requireAuth } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { decrypt } from '../services/crypto.js';
import { expirePending } from '../services/orders.js';
import { withFinal } from './games.js';
import { passwordSchema, sendVerificationMail } from './auth.js';

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get('/', (req, res) => res.json({ user: publicUser(req.user) }));

meRouter.put('/', async (req, res) => {
  const body = z.object({
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().toLowerCase().email().max(254),
  }).parse(req.body);
  const changed = body.email !== req.user.email;
  if (changed && db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(body.email, req.user.id)) {
    return res.status(409).json({ error: 'อีเมลนี้ถูกใช้งานแล้ว' });
  }
  // เปลี่ยนอีเมล → ต้องยืนยันใหม่
  db.prepare('UPDATE users SET name = ?, email = ?, email_verified = ? WHERE id = ?')
    .run(body.name, body.email, changed ? 0 : req.user.email_verified, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (changed) await sendVerificationMail(user);
  res.json({ user: publicUser(user) });
});

meRouter.post('/password', async (req, res) => {
  const body = z.object({ currentPassword: z.string().min(1).max(72), newPassword: passwordSchema }).parse(req.body);
  if (!(await bcrypt.compare(body.currentPassword, req.user.password_hash))) {
    return res.status(400).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(body.newPassword, 10), req.user.id);
  res.json({ ok: true });
});

// ประวัติคำสั่งซื้อ (แบ่งหน้า ใหม่สุดก่อน)
meRouter.get('/orders', (req, res) => {
  expirePending();
  const page = z.coerce.number().int().min(1).default(1).parse(req.query.page);
  const limit = 10;
  const total = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id = ?').get(req.user.id).n;
  const items = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(req.user.id, limit, (page - 1) * limit).map((o) => ({
      id: o.id, status: o.status, total: o.total, createdAt: o.created_at, expiresAt: o.expires_at,
      titles: db.prepare('SELECT title FROM order_items WHERE order_id = ? ORDER BY id').all(o.id).map((r) => r.title),
    }));
  res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

// คลังเกม = เกมจากออเดอร์ที่ชำระแล้ว พร้อมโค้ดเกม (ถอดรหัสให้เฉพาะเจ้าของ และบันทึก audit log)
meRouter.get('/library', (req, res) => {
  const games = db.prepare(`SELECT g.*, MAX(o.paid_at) AS purchased_at FROM order_items oi
    JOIN orders o ON o.id = oi.order_id AND o.status = 'paid' AND o.user_id = ?
    JOIN games_v g ON g.id = oi.game_id GROUP BY g.id ORDER BY purchased_at DESC`).all(req.user.id);
  const keyRows = db.prepare(`SELECT oi.game_id, o.id AS order_id, k.key_enc FROM game_keys k
    JOIN order_items oi ON oi.id = k.order_item_id JOIN orders o ON o.id = oi.order_id
    WHERE o.user_id = ? AND o.status = 'paid' AND k.status = 'sold' ORDER BY k.id`).all(req.user.id);
  const items = games.map((g) => ({
    ...withFinal(g),
    purchasedAt: g.purchased_at,
    keys: keyRows.filter((k) => k.game_id === g.id).map((k) => ({ orderId: k.order_id, code: decrypt(k.key_enc) })),
  }));
  if (keyRows.length) audit(req, 'key.view', 'library', req.user.id, { count: keyRows.length });
  res.json({ items });
});
