import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';

const MAX_AGE = 7 * 24 * 3600 * 1000;

// tv = users.token_version ตอนออก token — ถ้าค่าในฐานข้อมูลเปลี่ยน token เก่าทั้งหมดใช้ไม่ได้ทันที
export function setAuthCookie(res, user) {
  const token = jwt.sign({ sub: user.id, tv: user.token_version }, config.jwtSecret, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: MAX_AGE, path: '/' });
}

export const clearAuthCookie = (res) => res.clearCookie('token', { path: '/' });

// เพิกถอนทุกเซสชัน (ลูกค้าและแอดมิน) ของผู้ใช้ คืนผู้ใช้ที่อัปเดตแล้ว (ใช้ออก token ใหม่ให้เซสชันปัจจุบันได้)
export function revokeSessions(userId) {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

// token ที่ออกก่อนมี token_version ไม่มี tv → ถือเป็น 0
export const tokenIsCurrent = (payload, user) => (payload.tv ?? 0) === user.token_version;

export const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name, role: u.role,
  emailVerified: !!u.email_verified, createdAt: u.created_at,
});

// อ่านผู้ใช้จากคุกกี้ถ้ามี (ไม่บังคับ) — ดึงจาก DB ทุกครั้ง สิทธิ์จึงเปลี่ยนทันที
export function authenticate(req, _res, next) {
  req.user = null;
  const token = req.cookies.token;
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
      // บัญชีที่ถูกระงับ / token ที่ถูกเพิกถอน = ไม่ล็อกอิน (มีผลทันที)
      req.user = u && u.status === 'active' && tokenIsCurrent(payload, u) ? u : null;
    } catch { /* โทเคนเสีย/หมดอายุ → ถือว่าไม่ล็อกอิน */ }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  next();
}
