import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { tokenIsCurrent } from './auth.js';

// เซสชันแอดมินแยกจากเซสชันลูกค้า: คุกกี้คนละตัว, SameSite=Strict, หมดอายุ 2 ชั่วโมง
// คุกกี้ลูกค้า (token) ไม่ให้สิทธิ์แอดมินใด ๆ แม้ผู้ใช้นั้นจะมี role เป็น admin ก็ตาม — ต้องล็อกอินผ่าน /admin/login ทุกครั้ง
export const ADMIN_COOKIE = 'admin_token';
export const ADMIN_SESSION_MS = 2 * 3600 * 1000;
export const ADMIN_ROLES = ['staff', 'admin'];

export function setAdminCookie(res, user) {
  const token = jwt.sign({ sub: user.id, tv: user.token_version, aud: 'admin' }, config.jwtSecret, { expiresIn: Math.floor(ADMIN_SESSION_MS / 1000) });
  res.cookie(ADMIN_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: config.isProd, maxAge: ADMIN_SESSION_MS, path: '/' });
}
export const clearAdminCookie = (res) => res.clearCookie(ADMIN_COOKIE, { path: '/' });

// คืนผู้ใช้แอดมินจากคุกกี้ (ตรวจ role/สถานะจากฐานข้อมูลทุกครั้ง สิทธิ์ที่ถูกถอนมีผลทันที) หรือ null
export function adminFromCookies(cookies) {
  const token = cookies?.[ADMIN_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { audience: 'admin' });
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    return u && u.status === 'active' && ADMIN_ROLES.includes(u.role) && tokenIsCurrent(payload, u) ? u : null;
  } catch {
    return null;
  }
}

export function adminAuth(req, res, next) {
  const admin = adminFromCookies(req.cookies);
  if (!admin) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบแอดมิน', code: 'ADMIN_AUTH_REQUIRED' });
  req.user = admin; // audit log ใช้ req.user — ตั้งเป็นแอดมินที่ล็อกอินอยู่
  next();
}

// ตรวจบทบาทที่ฝั่งเซิร์ฟเวอร์ทุก endpoint (การซ่อนปุ่มในหน้าเว็บเป็นแค่ความสะดวก)
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ทำรายการนี้', code: 'FORBIDDEN' });
  }
  next();
};
export const adminOnly = requireRole('admin');

// สิทธิ์เสริมที่เปิดให้ staff ได้ผ่าน STAFF_PERMISSIONS ใน .env (ค่าเริ่มต้นว่าง = staff อ่านอย่างเดียว) — admin ทำได้เสมอ
export const permissionsOf = (user) => (user.role === 'admin' ? ['*'] : config.staffPermissions);
export const hasPermission = (user, perm) => user.role === 'admin' || (user.role === 'staff' && config.staffPermissions.includes(perm));
export const requirePerm = (perm) => (req, res, next) => {
  if (!req.user || !hasPermission(req.user, perm)) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ทำรายการนี้', code: 'FORBIDDEN' });
  }
  next();
};
export const staffOrAdmin = requireRole('staff', 'admin');
