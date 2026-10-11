import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { HttpError } from './services/errors.js';
import { stripeConfigured, webhookConfigured } from './services/stripe.js';
import { mountWeb } from './web.js';
import { config } from './config.js';
import { db } from './db/index.js';
import { authenticate } from './middleware/auth.js';
import { csrf } from './middleware/csrf.js';
import { requestLog } from './middleware/requestLog.js';
import { authRouter } from './routes/auth.js';
import { cartRouter } from './routes/cart.js';
import { couponsRouter } from './routes/coupons.js';
import { ordersRouter } from './routes/orders.js';
import { gamesRouter } from './routes/games.js';
import { meRouter } from './routes/me.js';
import { adminRouter } from './routes/admin/index.js';
import { stripeWebhook } from './routes/webhooks.js';
import { reviewsRouter } from './routes/reviews.js';
import { wishlistRouter } from './routes/wishlist.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy); // อยู่หลัง reverse proxy ให้ตั้ง TRUST_PROXY (กระทบ req.ip → rate limit / audit log)
  app.use(requestLog);

  // เช็กสถานะสำหรับ Docker/load balancer (ไม่ผ่าน rate limit/CSRF; ไม่เปิดเผยรายละเอียดภายใน)
  app.get('/healthz', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.set('Cache-Control', 'no-store').json({ status: 'ok', uptime: Math.round(process.uptime()) });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  // ---- Security headers ----
  // CSP เข้ม: ไม่มี inline script/style เลย ('unsafe-inline' ไม่ถูกใช้) อนุญาตเฉพาะ origin ตัวเอง
  // - ชำระเงินใช้ Stripe Checkout แบบ redirect (ไปหน้าของ Stripe แล้วกลับมา) จึงไม่ต้องเปิดโดเมน Stripe ใน script/frame/connect
  //   (ถ้าอนาคตฝัง Stripe.js/Elements ต้องเพิ่ม: script-src https://js.stripe.com; frame-src https://js.stripe.com https://hooks.stripe.com; connect-src https://api.stripe.com)
  // - frame-src: เฉพาะผู้ให้บริการวิดีโอตัวอย่างที่แอดมินวางลิงก์ได้ (ตรงกับ allowlist ใน routes/admin/games.js)
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'media-src': ["'self'"],
        'frame-src': ['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://player.vimeo.com'],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"],
        ...(config.isProd ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    strictTransportSecurity: config.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: false } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    xFrameOptions: { action: 'deny' },
  }));
  app.use((_req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    next();
  });

  // CORS: อนุญาตเฉพาะ origin ที่ตั้งไว้ใน APP_URL / CORS_ORIGINS (คำขอจาก origin เดียวกันไม่ต้องใช้ CORS อยู่แล้ว)
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin) ? origin || false : false),
    credentials: true,
  }));
  app.use(compression());
  // webhook ต้องใช้ raw body (ตรวจลายเซ็น) จึงอยู่ก่อน express.json และก่อน CSRF — ปลอดภัยด้วยลายเซ็น Stripe
  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), stripeWebhook);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api', rateLimit({ windowMs: 60_000, limit: config.apiRateLimit, standardHeaders: true, legacyHeaders: false }));
  app.use('/api', csrf, authenticate);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.get('/api/config', (_req, res) => res.json({
    devPay: config.devPay,
    payments: { stripe: stripeConfigured(), webhook: webhookConfigured(), methods: ['card', 'promptpay'] },
  }));
  app.use('/api/me', meRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/coupons', couponsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/wishlist', wishlistRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/games/:id/reviews', reviewsRouter);
  app.use('/api/games', gamesRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'ไม่พบ endpoint' }));

  mountWeb(app); // หน้าเว็บ, SEO, ไฟล์สถิต, แอดมิน, 404 (ดู web.js)

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: err.issues[0]?.message || 'ข้อมูลไม่ถูกต้อง', details: err.issues });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, params: err.params });
    if (err.name === 'MulterError') {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'ไฟล์ใหญ่เกินกำหนด' : 'อัปโหลดไฟล์ไม่ถูกต้อง', code: tooBig ? 'FILE_TOO_LARGE' : 'BAD_UPLOAD' });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' });
    console.error(err.stack ?? String(err));
    // หน้าเว็บทั่วไปให้หน้า 500 ที่สวยงาม (noindex); /api ตอบ JSON
    if (!req.path.startsWith('/api') && req.accepts('html') && app.locals.roots) return res.status(500).sendFile(path.join(app.locals.roots.pub, '500.html'));
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ' });
  });
  return app;
}
