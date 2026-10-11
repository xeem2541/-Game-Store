import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { publicUser, requireAuth, revokeSessions, setAuthCookie } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { decrypt } from '../services/crypto.js';
import { HttpError } from '../services/errors.js';
import { sendMail } from '../services/mail.js';
import { expirePending } from '../services/orders.js';
import { checkPassword, hashPassword, isUniqueViolation } from '../services/passwords.js';
import { withFinal } from './games.js';
import { passwordSchema, sendVerificationMail } from './auth.js';

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get('/', (req, res) => res.json({ user: publicUser(req.user) }));

// แสดงอีเมลใหม่แบบปิดบังบางส่วนในอีเมลแจ้งเตือน: somchai@example.com → so****@example.com
const maskEmail = (e) => e.replace(/^(.{1,2})[^@]*/, (_m, head) => `${head}****`);

meRouter.put('/', async (req, res) => {
  const body = z.object({
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().toLowerCase().email().max(254),
    currentPassword: z.string().max(72).optional(),
  }).parse(req.body);
  const oldEmail = req.user.email;
  const changed = body.email !== oldEmail.toLowerCase();
  if (changed) {
    // เปลี่ยนอีเมล = เปลี่ยนช่องทางกู้บัญชี → ต้องยืนยันด้วยรหัสผ่าน (ผู้ที่ได้เซสชันไปอย่างเดียวยึดบัญชีไม่ได้)
    if (!body.currentPassword) throw new HttpError(400, 'กรุณากรอกรหัสผ่านปัจจุบันเพื่อเปลี่ยนอีเมล', 'PASSWORD_REQUIRED');
    if (!(await checkPassword(req.user, body.currentPassword))) {
      throw new HttpError(400, 'รหัสผ่านเดิมไม่ถูกต้อง', 'WRONG_PASSWORD');
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(body.email, req.user.id)) {
      return res.status(409).json({ error: 'อีเมลนี้ถูกใช้งานแล้ว' });
    }
  }
  try {
    // เปลี่ยนอีเมล → ต้องยืนยันใหม่
    db.prepare('UPDATE users SET name = ?, email = ?, email_verified = ? WHERE id = ?')
      .run(body.name, body.email, changed ? 0 : req.user.email_verified, req.user.id);
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: 'อีเมลนี้ถูกใช้งานแล้ว' }); // สมัคร/เปลี่ยนชนกันพร้อมกัน
    throw e;
  }
  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (changed) {
    user = revokeSessions(user.id); // เซสชันอื่นทั้งหมดออกจากระบบ เครื่องนี้ได้ token ใหม่
    setAuthCookie(res, user);
    audit(req, 'user.email_change', 'user', user.id, { from: oldEmail, to: body.email });
    await sendVerificationMail(user);
    await sendMail({
      to: oldEmail,
      subject: 'อีเมลบัญชีของคุณถูกเปลี่ยน – Game Store',
      text: `สวัสดี ${user.name},\n\nอีเมลของบัญชีคุณถูกเปลี่ยนเป็น ${maskEmail(body.email)} เมื่อสักครู่\n\nถ้าคุณไม่ได้เป็นคนเปลี่ยน กรุณาติดต่อร้านค้าทันทีเพื่อระงับบัญชีและกู้คืน\n`,
    });
  }
  res.json({ user: publicUser(user) });
});

meRouter.post('/password', async (req, res) => {
  const body = z.object({ currentPassword: z.string().min(1).max(72), newPassword: passwordSchema }).parse(req.body);
  if (!(await checkPassword(req.user, body.currentPassword))) {
    return res.status(400).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(body.newPassword), req.user.id);
  // เพิกถอนเซสชันอื่นทั้งหมด แล้วออก token ใหม่ให้อุปกรณ์ที่ใช้อยู่ (ไม่ต้องล็อกอินใหม่)
  setAuthCookie(res, revokeSessions(req.user.id));
  res.json({ ok: true });
});

// ประวัติคำสั่งซื้อ (แบ่งหน้า ใหม่สุดก่อน)
meRouter.get('/orders', (req, res) => {
  expirePending(Date.now(), { userId: req.user.id });
  const page = z.coerce.number().int().min(1).default(1).parse(req.query.page);
  const limit = 10;
  const total = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id = ?').get(req.user.id).n;
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(req.user.id, limit, (page - 1) * limit);
  // ชื่อเกมของทุกออเดอร์ในหน้านี้ด้วย query เดียว (ไม่ query ทีละออเดอร์)
  const titles = new Map(orders.map((o) => [o.id, []]));
  if (orders.length) {
    db.prepare(`SELECT order_id, title FROM order_items WHERE order_id IN (${orders.map(() => '?').join(',')}) ORDER BY id`)
      .all(...orders.map((o) => o.id)).forEach((r) => titles.get(r.order_id).push(r.title));
  }
  const items = orders.map((o) => ({
    id: o.id, status: o.status, total: o.total, createdAt: o.created_at, expiresAt: o.expires_at, titles: titles.get(o.id),
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
  const keysByGame = Map.groupBy(keyRows, (k) => k.game_id);
  const items = games.map((g) => ({
    ...withFinal(g),
    purchasedAt: g.purchased_at,
    keys: (keysByGame.get(g.id) ?? []).map((k) => ({ orderId: k.order_id, code: decrypt(k.key_enc) })),
  }));
  if (keyRows.length) audit(req, 'key.view', 'library', req.user.id, { count: keyRows.length });
  res.json({ items });
});
