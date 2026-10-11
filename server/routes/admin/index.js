import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { adminAuth, adminOnly, clearAdminCookie, permissionsOf, requirePerm, setAdminCookie, staffOrAdmin } from '../../middleware/adminAuth.js';
import { audit } from '../../services/audit.js';
import { auditRouter } from './audit.js';
import { couponsAdminRouter } from './coupons.js';
import { dashboardRouter } from './dashboard.js';
import { gamesAdminRouter } from './games.js';
import { ordersAdminRouter } from './orders.js';
import { reportsRouter } from './reports.js';
import { reviewsAdminRouter } from './reviews.js';
import { stockRouter } from './stock.js';
import { usersAdminRouter } from './users.js';

export const adminRouter = Router();

const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: config.authRateLimit, standardHeaders: true, legacyHeaders: false,
  message: { error: 'พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่' },
});
const publicAdmin = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

// ---------- เข้าสู่ระบบแอดมิน (แยกจากการล็อกอินของลูกค้า) ----------
adminRouter.post('/auth/login', loginLimiter, async (req, res) => {
  const body = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(72) }).parse(req.body);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email);
  const ok = await bcrypt.compare(body.password, user?.password_hash ?? DUMMY_HASH);
  // ผู้ใช้ทั่วไป/รหัสผิด/บัญชีถูกระงับ ตอบข้อความเดียวกัน ไม่เปิดเผยว่าอีเมลนี้เป็นแอดมินหรือไม่
  if (!user || !ok || user.status !== 'active' || !['staff', 'admin'].includes(user.role)) {
    audit({ ip: req.ip }, 'admin.login_failed', 'user', null, { email: body.email });
    return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  }
  setAdminCookie(res, user);
  audit({ user, ip: req.ip }, 'admin.login', 'user', user.id);
  res.json({ user: publicAdmin(user) });
});

adminRouter.post('/auth/logout', (req, res) => {
  clearAdminCookie(res);
  res.json({ ok: true });
});

// ทุกเส้นทางต่อจากนี้ต้องมีเซสชันแอดมิน (staff / admin) ที่ยังใช้ได้
adminRouter.use(adminAuth);
adminRouter.get('/auth/me', (req, res) => res.json({ user: publicAdmin(req.user), permissions: permissionsOf(req.user) }));

// สิทธิ์ละเอียดกำหนดในแต่ละ router (staff = ดูข้อมูล + ออเดอร์/รีวิว/แจ้งเตือน, admin = ทุกอย่าง)
adminRouter.use('/dashboard', staffOrAdmin, dashboardRouter);
adminRouter.use('/orders', staffOrAdmin, ordersAdminRouter);
adminRouter.use('/reviews', staffOrAdmin, reviewsAdminRouter);
adminRouter.use('/reports', staffOrAdmin, reportsRouter);
adminRouter.use('/games', staffOrAdmin, gamesAdminRouter);
adminRouter.use('/stock', staffOrAdmin, stockRouter);
adminRouter.use('/users', adminOnly, usersAdminRouter);
adminRouter.use('/coupons', requirePerm('coupons.manage'), couponsAdminRouter);
adminRouter.use('/audit', adminOnly, auditRouter);
