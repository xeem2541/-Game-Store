import crypto from 'node:crypto';
import { config } from '../config.js';

// Double-submit cookie: เซิร์ฟเวอร์ตั้งคุกกี้ csrf (อ่านได้จาก JS) แล้วเว็บต้องส่งค่าเดียวกันกลับใน header X-CSRF-Token
// เว็บอื่นอ่านคุกกี้ของเราไม่ได้จึงปลอมคำขอไม่ได้
export function csrf(req, res, next) {
  let token = req.cookies.csrf;
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie('csrf', token, { sameSite: 'lax', secure: config.isProd, httpOnly: false, path: '/' });
    req.cookies.csrf = token;
  }
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = req.get('x-csrf-token') || '';
  const a = Buffer.from(sent);
  const b = Buffer.from(token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'CSRF token ไม่ถูกต้อง' });
  }
  next();
}
