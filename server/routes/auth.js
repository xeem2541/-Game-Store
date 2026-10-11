import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { clearAuthCookie, publicUser, requireAuth, revokeSessions, setAuthCookie } from '../middleware/auth.js';
import { sendMail } from '../services/mail.js';
import { checkPassword, hashPassword, isUniqueViolation } from '../services/passwords.js';
import { consumeToken, createToken } from '../services/tokens.js';

export const authRouter = Router();

const HOUR = 3600 * 1000;
const limiter = rateLimit({
  windowMs: 15 * 60_000, limit: config.authRateLimit, standardHeaders: true, legacyHeaders: false,
  message: { error: 'พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่' },
});

const email = z.string().trim().toLowerCase().email().max(254);
// bcrypt ใช้เพียง 72 ไบต์แรก จึงจำกัดความยาวไว้
const password = z.string().min(8, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร').max(72);
export const passwordSchema = password;

export function sendVerificationMail(user) {
  const token = createToken('email_verifications', user.id, 24 * HOUR);
  return sendMail({
    to: user.email,
    subject: 'ยืนยันอีเมลของคุณ – Game Store',
    text: `สวัสดี ${user.name},\n\nกรุณายืนยันอีเมลโดยเปิดลิงก์ (หมดอายุใน 24 ชั่วโมง):\n${config.appUrl}/verify?token=${token}\n`,
  });
}

authRouter.post('/register', limiter, async (req, res) => {
  const body = z.object({ email, password, name: z.string().trim().min(1).max(80) }).parse(req.body);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email)) {
    return res.status(409).json({ error: 'อีเมลนี้ถูกใช้งานแล้ว' });
  }
  const hash = await hashPassword(body.password);
  let lastInsertRowid;
  try {
    ({ lastInsertRowid } = db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'user')")
      .run(body.email, body.name, hash));
  } catch (e) {
    // สมัครอีเมลเดียวกันพร้อมกันสองคำขอ: คำขอหลังชน UNIQUE ระหว่างรอ bcrypt
    if (isUniqueViolation(e)) return res.status(409).json({ error: 'อีเมลนี้ถูกใช้งานแล้ว' });
    throw e;
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  await sendVerificationMail(user);
  setAuthCookie(res, user);
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post('/login', limiter, async (req, res) => {
  const body = z.object({ email, password: z.string().min(1).max(72) }).parse(req.body);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email);
  if (!(await checkPassword(user, body.password))) return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  if (user.status !== 'active') return res.status(403).json({ error: 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อร้านค้า', code: 'ACCOUNT_SUSPENDED' });
  setAuthCookie(res, user);
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// ออกจากระบบทุกอุปกรณ์: token ทุกตัวที่เคยออกให้ผู้ใช้นี้ (รวมเซสชันแอดมิน) ใช้ไม่ได้อีก
authRouter.post('/logout-all', requireAuth, (req, res) => {
  revokeSessions(req.user.id);
  clearAuthCookie(res);
  res.json({ ok: true });
});

// ไม่ล็อกอิน → 200 พร้อม user: null (หน้าเว็บเรียกทุกครั้งที่โหลด จึงไม่ใช้ 401 เพื่อไม่ให้เกิด error ใน console)
authRouter.get('/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

authRouter.get('/verify', (req, res) => {
  const userId = consumeToken('email_verifications', String(req.query.token ?? ''));
  if (!userId) return res.status(400).json({ error: 'ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุแล้ว' });
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);
  res.json({ ok: true });
});

authRouter.post('/resend', limiter, requireAuth, async (req, res) => {
  if (!req.user.email_verified) await sendVerificationMail(req.user);
  res.json({ ok: true });
});

// ตอบเหมือนกันเสมอ ไม่ว่ามีอีเมลนี้ในระบบหรือไม่ — และไม่รอส่งอีเมล (เวลาตอบสนองต้องไม่บอกใบ้ว่ามีบัญชีนี้)
authRouter.post('/forgot', limiter, (req, res) => {
  const body = z.object({ email }).parse(req.body);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email);
  if (user) {
    const token = createToken('password_resets', user.id, HOUR);
    sendMail({
      to: user.email,
      subject: 'รีเซ็ตรหัสผ่าน – Game Store',
      text: `สวัสดี ${user.name},\n\nตั้งรหัสผ่านใหม่ได้ที่ลิงก์นี้ (หมดอายุใน 1 ชั่วโมง ใช้ได้ครั้งเดียว):\n${config.appUrl}/reset?token=${token}\n\nถ้าคุณไม่ได้ขอ ให้ละเว้นอีเมลนี้\n`,
    }).catch((e) => console.error('ส่งอีเมลรีเซ็ตรหัสผ่านไม่สำเร็จ:', e.message));
  }
  res.json({ ok: true });
});

authRouter.post('/reset', limiter, async (req, res) => {
  const body = z.object({ token: z.string().min(10).max(200), password }).parse(req.body);
  const userId = consumeToken('password_resets', body.token);
  if (!userId) return res.status(400).json({ error: 'ลิงก์รีเซ็ตไม่ถูกต้องหรือหมดอายุแล้ว' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(body.password), userId);
  revokeSessions(userId); // ใครที่ถือเซสชันเก่าอยู่ (เช่น ผู้ที่ขโมยบัญชี) ถูกออกจากระบบทันที
  res.json({ ok: true });
});
