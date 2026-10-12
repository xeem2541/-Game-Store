import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { adminFromCookies } from './middleware/adminAuth.js';
import { authenticate } from './middleware/auth.js';
import { gameMeta, gamesMeta, homeMeta, ogImage, renderTemplate, robotsTxt, setTemplateRoot, sitemapXml } from './seo.js';
import { FILE_NAME_RE, UPLOAD_DIR } from './services/images.js';
import { escHtml } from './services/text.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// production (หรือ USE_DIST=1) ใช้ไฟล์ที่ build แล้วใน dist/ (minify + ชื่อไฟล์มี hash + บีบอัดล่วงหน้า) ถ้ายังไม่ได้ build จะ fallback ไปโฟลเดอร์ต้นฉบับ
export function resolveRoots() {
  const dist = path.join(ROOT, 'dist');
  const want = config.isProd || process.env.USE_DIST === '1';
  if (want && fs.existsSync(path.join(dist, 'public', 'index.html'))) return { pub: path.join(dist, 'public'), admin: path.join(dist, 'admin'), dist: true };
  if (want) console.warn('⚠️  ไม่พบโฟลเดอร์ dist/ (ยังไม่ได้รัน npm run build) — ใช้ไฟล์ต้นฉบับแทน ซึ่งไม่ได้ minify/แคชยาว');
  return { pub: path.join(ROOT, 'public'), admin: path.join(ROOT, 'admin'), dist: false };
}

// ไฟล์ที่ชื่อมี hash ของเนื้อหา (เช่น home-3FA9C2D1.js) แคชได้ 1 ปี; HTML/JSON ต้องตรวจซ้ำทุกครั้ง (ETag → 304)
const HASHED = /-[A-Za-z0-9_]{8}\.(js|css)$/;
export function setCache(res, file) {
  if (HASHED.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  else if (/\.(html|json)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  else res.setHeader('Cache-Control', 'public, max-age=3600');
}

// เสิร์ฟไฟล์ .br / .gz ที่บีบอัดไว้ตอน build (ไม่ต้องบีบอัดซ้ำทุกคำขอ)
function precompressed(root) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const ae = req.headers['accept-encoding'] || '';
    const enc = ae.includes('br') ? 'br' : ae.includes('gzip') ? 'gz' : null;
    if (!enc) return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (!/\.(js|css|json|svg|xml|txt)$/.test(rel)) return next();
    const file = path.join(root, rel);
    const comp = `${file}.${enc}`;
    if (!file.startsWith(root + path.sep) || !fs.existsSync(comp)) return next();
    res.setHeader('Content-Encoding', enc === 'br' ? 'br' : 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    setCache(res, file);
    res.type(path.extname(file));
    fs.createReadStream(comp).pipe(res);
  };
}

export function mountWeb(app) {
  const roots = resolveRoots();
  setTemplateRoot(roots.pub);
  app.locals.roots = roots;

  // ---- SEO / หน้าที่เซิร์ฟเวอร์ใส่ meta ให้ ----
  app.get(['/', '/index.html'], (_req, res) => res.set('Cache-Control', 'no-cache').type('html').send(renderTemplate('index.html', homeMeta())));
  app.get(['/games.html', '/games'], (_req, res) => res.set('Cache-Control', 'no-cache').type('html').send(renderTemplate('games.html', gamesMeta())));
  app.get('/game/:slug', (req, res) => {
    const { found, meta } = gameMeta(req.params.slug);
    // skeleton มีภาพปกจริงอยู่ตำแหน่งเดียวกับกล่องเกม: แสดงทันทีก่อนข้อมูลเกมมา และเป็นปลายทางที่ภาพปกจากการ์ด
    // หน้าก่อนหน้าขยายมาหา (cross-document view transition — ดู css/transitions.css)
    const cover = found
      ? `<img class="detail-cover sk-hero-cover" src="/api/games/${escHtml(req.params.slug)}/cover.svg" alt="" width="400" height="300" fetchpriority="high">`
      : '<div class="sk-cover sk-hero-cover"></div>';
    const html = renderTemplate('game.html', meta).replaceAll('{{SLUG}}', found ? escHtml(req.params.slug) : '').replace('{{COVER_IMG}}', cover);
    res.status(found ? 200 : 404).set('Cache-Control', 'no-cache').type('html').send(html);
  });
  app.get('/sitemap.xml', (_req, res) => res.set('Cache-Control', 'public, max-age=3600').type('application/xml').send(sitemapXml()));
  app.get('/robots.txt', (_req, res) => res.set('Cache-Control', 'public, max-age=3600').type('text/plain').send(robotsTxt()));
  app.get('/og/:file', async (req, res, next) => {
    const m = /^([a-z0-9-]{1,80})\.png$/.exec(req.params.file);
    if (!m) return res.status(404).end();
    try {
      const png = await ogImage(m[1]);
      if (!png) return res.status(404).end();
      res.set('Cache-Control', 'public, max-age=86400').type('image/png').send(png);
    } catch (e) { next(e); }
  });

  // ---- รูปเกมที่แอดมินอัปโหลด: อยู่นอก public/ เสิร์ฟผ่าน route นี้เท่านั้น รับเฉพาะชื่อไฟล์ <32 hex>[-sm].webp (กัน path traversal) ----
  app.get('/uploads/games/:file', (req, res) => {
    if (!FILE_NAME_RE.test(req.params.file)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=31536000, immutable').type('image/webp')
      .sendFile(path.join(UPLOAD_DIR, req.params.file), (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });

  // ---- หน้าแอดมิน (/admin): ไฟล์อยู่นอก public/ เสิร์ฟให้เฉพาะผู้มีเซสชันแอดมินที่ใช้ได้ ----
  // ไฟล์ที่เปิดสาธารณะได้มีแค่หน้า login และสไตล์/สคริปต์ของหน้า login (ชื่อมี hash เมื่อ build)
  const PUBLIC_ADMIN = /^\/(login(\.html)?|login(-[A-Za-z0-9_]{8})?\.js|admin(-[A-Za-z0-9_]{8})?\.css)$/;
  app.use('/admin', (req, res, next) => {
    if (adminFromCookies(req.cookies)) return next();
    if (PUBLIC_ADMIN.test(req.path)) return next();
    // ผู้ใช้ทั่วไปที่ล็อกอินอยู่ถูกส่งกลับหน้าแรก (ไม่บอกว่ามีหน้าแอดมิน) คนอื่นไปหน้า login ของแอดมิน
    authenticate(req, res, () => {}); // หน้าเว็บไม่ผ่าน middleware ของ /api จึงอ่านผู้ใช้ทั่วไปจากคุกกี้ที่นี่
    return res.redirect(302, req.user?.role === 'user' ? '/' : '/admin/login');
  });
  app.get('/admin/login', (_req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(roots.admin, 'login.html')));
  app.use('/admin', precompressed(roots.admin));
  app.use('/admin', express.static(roots.admin, { index: 'index.html', setHeaders: (res, file) => { setCache(res, file); if (/\.html$/.test(file)) res.setHeader('Cache-Control', 'no-store'); } }));

  app.get('/order/:id', (_req, res) => res.sendFile(path.join(roots.pub, 'order.html')));

  // ---- ไฟล์สถิตของร้านค้า (extensions: /login → login.html) ----
  app.use(precompressed(roots.pub));
  app.use(express.static(roots.pub, { index: false, extensions: ['html'], setHeaders: (res, file) => setCache(res, file) }));

  // ---- 404 ----
  app.use((req, res) => {
    res.status(404);
    if (req.accepts('html')) return res.sendFile(path.join(roots.pub, '404.html'));
    return res.type('text/plain').send('Not found');
  });
}
