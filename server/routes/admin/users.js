import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { audit } from '../../services/audit.js';
import { HttpError } from '../../services/errors.js';
import { resetMfa } from './mfa.js';
import { idParam, likeArg, pageInfo, paging } from './util.js';

// ทั้ง router เป็น admin เท่านั้น (กำหนดที่ index.js) และไม่เคยส่ง password_hash / token ออกไป
export const usersAdminRouter = Router();

const PUBLIC_COLS = 'u.id, u.email, u.name, u.role, u.status, u.email_verified AS emailVerified, u.totp_enabled AS mfaEnabled, u.created_at AS createdAt';

usersAdminRouter.get('/', (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const q = z.object({ q: z.string().trim().max(100).optional(), role: z.enum(['user', 'staff', 'admin']).optional(), status: z.enum(['active', 'suspended']).optional() }).parse(req.query);
  const where = ['1 = 1'];
  const args = [];
  if (q.q) { where.push("(u.email LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')"); args.push(likeArg(q.q), likeArg(q.q)); }
  if (q.role) { where.push('u.role = ?'); args.push(q.role); }
  if (q.status) { where.push('u.status = ?'); args.push(q.status); }
  const w = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${w}`).get(...args).n;
  const items = db.prepare(`SELECT ${PUBLIC_COLS},
      (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orderCount,
      (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS paidTotal
    FROM users u WHERE ${w} ORDER BY u.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json({ items, ...pageInfo(total, page, limit) });
});

usersAdminRouter.get('/:id', (req, res) => {
  const id = idParam.parse(req.params.id);
  const user = db.prepare(`SELECT ${PUBLIC_COLS} FROM users u WHERE u.id = ?`).get(id);
  if (!user) throw new HttpError(404, 'ไม่พบผู้ใช้', 'USER_NOT_FOUND');
  const orders = db.prepare('SELECT id, status, total, created_at AS createdAt, paid_at AS paidAt FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(id);
  const reviews = db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE user_id = ?').get(id).n;
  audit(req, 'user.view', 'user', id);
  res.json({ user, orders, reviewCount: reviews });
});

// ต้องมี admin ที่ยังใช้งานได้อย่างน้อย 1 คนเสมอ
function assertNotLastAdmin(targetId, action) {
  const others = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND id != ?").get(targetId).n;
  if (others === 0) throw new HttpError(409, `ไม่สามารถ${action} admin คนสุดท้ายของระบบได้`, 'LAST_ADMIN');
}

function loadTarget(req) {
  const id = idParam.parse(req.params.id);
  if (id === req.user.id) throw new HttpError(409, 'ไม่สามารถเปลี่ยนสิทธิ์หรือสถานะของบัญชีตัวเองได้', 'SELF_CHANGE');
  const t = db.prepare('SELECT id, role, status, email FROM users WHERE id = ?').get(id);
  if (!t) throw new HttpError(404, 'ไม่พบผู้ใช้', 'USER_NOT_FOUND');
  return t;
}

usersAdminRouter.put('/:id/status', (req, res) => {
  const t = loadTarget(req);
  const { status, reason } = z.object({ status: z.enum(['active', 'suspended']), reason: z.string().trim().max(300).optional() }).parse(req.body);
  if (status === 'suspended' && t.role === 'admin' && t.status === 'active') assertNotLastAdmin(t.id, 'ระงับ');
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, t.id);
  audit(req, 'user.status', 'user', t.id, { before: { status: t.status }, after: { status }, reason: reason ?? null });
  res.json({ ok: true });
});

usersAdminRouter.put('/:id/role', (req, res) => {
  const t = loadTarget(req);
  const { role } = z.object({ role: z.enum(['user', 'staff', 'admin']) }).parse(req.body);
  if (t.role === 'admin' && role !== 'admin' && t.status === 'active') assertNotLastAdmin(t.id, 'ลดสิทธิ์');
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, t.id);
  audit(req, 'user.role', 'user', t.id, { before: { role: t.role }, after: { role }, email: t.email });
  res.json({ ok: true });
});

// ล้าง 2FA ของบัญชีอื่น (เช่น ทำโทรศัพท์หายและไม่มีรหัสกู้คืน) — ทุกเซสชันของคนนั้นถูกเพิกถอน ล็อกอินครั้งถัดไปต้องตั้ง 2FA ใหม่
usersAdminRouter.post('/:id/mfa/reset', (req, res) => {
  const t = loadTarget(req);
  resetMfa(t.id);
  audit(req, 'user.mfa_reset', 'user', t.id, { email: t.email });
  res.json({ ok: true });
});
