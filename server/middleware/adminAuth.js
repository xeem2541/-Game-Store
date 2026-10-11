import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { tokenIsCurrent } from './auth.js';

// เซสชันแอดมินแยกจากเซสชันลูกค้า: คุกกี้คนละตัว, SameSite=Strict, หมดอายุ 2 ชั่วโมง
// คุกกี้ลูกค้า (token) ไม่ให้สิทธิ์แอดมินใด ๆ แม้ผู้ใช้นั้นจะมี role เป็น admin ก็ตาม — ต้องล็อกอินผ่าน /admin/login ทุกครั้ง
export const ADMIN_COOKIE = 'admin_token';
export const ADMIN_SESSION_MS = 2 * 3600 * 1000;
export const ADMIN_ROLES = ['staff', 'admin'];

const cookieOpts = (maxAge) => ({ httpOnly: true, sameSite: 'strict', secure: config.isProd, maxAge, path: '/' });

// mfa = ผ่าน 2FA แล้วในเซสชันนี้ (false = ยืนยันแค่รหัสผ่าน: ใช้ได้เฉพาะหน้าตั้งค่า 2FA เมื่อระบบบังคับใช้ 2FA)
export function setAdminCookie(res, user, { mfa = false } = {}) {
  const token = jwt.sign({ sub: user.id, tv: user.token_version, mfa, aud: 'admin' }, config.jwtSecret, { expiresIn: Math.floor(ADMIN_SESSION_MS / 1000) });
  res.cookie(ADMIN_COOKIE, token, cookieOpts(ADMIN_SESSION_MS));
}
export const clearAdminCookie = (res) => res.clearCookie(ADMIN_COOKIE, { path: '/' });

// ขั้นกลางของการล็อกอิน: รหัสผ่านถูกแล้ว รอรหัส 2FA (อายุ 5 นาที ใช้ทำอย่างอื่นไม่ได้นอกจากยืนยันรหัส)
export const MFA_PENDING_COOKIE = 'admin_mfa';
const MFA_PENDING_MS = 5 * 60 * 1000;
export function setMfaPendingCookie(res, user) {
  const token = jwt.sign({ sub: user.id, tv: user.token_version, aud: 'admin-mfa' }, config.jwtSecret, { expiresIn: Math.floor(MFA_PENDING_MS / 1000) });
  res.cookie(MFA_PENDING_COOKIE, token, cookieOpts(MFA_PENDING_MS));
}
export const clearMfaPendingCookie = (res) => res.clearCookie(MFA_PENDING_COOKIE, { path: '/' });

const loadAdmin = (payload) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  return u && u.status === 'active' && ADMIN_ROLES.includes(u.role) && tokenIsCurrent(payload, u) ? u : null;
};
export function mfaPendingUser(cookies) {
  const token = cookies?.[MFA_PENDING_COOKIE];
  if (!token) return null;
  try { return loadAdmin(jwt.verify(token, config.jwtSecret, { audience: 'admin-mfa' })); } catch { return null; }
}

// คืน { user, mfa } จากคุกกี้เซสชันแอดมิน (ตรวจ role/สถานะจากฐานข้อมูลทุกครั้ง สิทธิ์ที่ถูกถอนมีผลทันที) หรือ null
export function adminSession(cookies) {
  const token = cookies?.[ADMIN_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { audience: 'admin' });
    const user = loadAdmin(payload);
    return user ? { user, mfa: payload.mfa === true } : null;
  } catch {
    return null;
  }
}
export const adminFromCookies = (cookies) => adminSession(cookies)?.user ?? null;

// เซสชันนี้ผ่าน 2FA ตามที่ต้องผ่านแล้วหรือยัง: เปิด 2FA ไว้ → ต้องยืนยันรหัสแล้ว ; ยังไม่เปิด → ผ่านเมื่อระบบไม่บังคับ
export const mfaSatisfied = (user, mfa) => mfa || (!user.totp_enabled && !config.adminMfaRequired);

export function adminAuth(req, res, next) {
  const s = adminSession(req.cookies);
  if (!s) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบแอดมิน', code: 'ADMIN_AUTH_REQUIRED' });
  req.user = s.user; // audit log ใช้ req.user — ตั้งเป็นแอดมินที่ล็อกอินอยู่
  req.adminMfa = s.mfa;
  next();
}

// ทุก endpoint หลังบ้าน (ยกเว้นหน้าตั้งค่า 2FA / ข้อมูลตัวเอง / ออกจากระบบ) ต้องผ่าน 2FA ก่อน
export function requireMfa(req, res, next) {
  if (mfaSatisfied(req.user, req.adminMfa)) return next();
  return req.user.totp_enabled
    ? res.status(401).json({ error: 'กรุณายืนยันรหัส 2FA', code: 'MFA_REQUIRED' })
    : res.status(403).json({ error: 'กรุณาตั้งค่ายืนยันตัวตนสองขั้นตอน (2FA) ก่อนใช้งานหลังบ้าน', code: 'MFA_SETUP_REQUIRED' });
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
