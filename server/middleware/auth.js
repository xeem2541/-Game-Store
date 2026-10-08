import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';

const MAX_AGE = 7 * 24 * 3600 * 1000;

export function setAuthCookie(res, userId) {
  const token = jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: MAX_AGE, path: '/' });
}

export const clearAuthCookie = (res) => res.clearCookie('token', { path: '/' });

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
      const { sub } = jwt.verify(token, config.jwtSecret);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(sub);
      req.user = u && u.status === 'active' ? u : null; // บัญชีที่ถูกระงับ = ไม่ล็อกอิน (มีผลทันที)
    } catch { /* โทเคนเสีย/หมดอายุ → ถือว่าไม่ล็อกอิน */ }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  next();
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง' });
  next();
};
