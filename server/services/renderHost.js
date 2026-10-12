// Render: URL สาธารณะจริงของร้านเมื่อไม่ได้ตั้ง APP_URL / BASE_URL
// RENDER_EXTERNAL_URL ที่ Render ตั้งให้มาจากชื่อ service (เช่น https://game-store.onrender.com) ซึ่งอาจไม่ใช่โดเมนที่ได้จริง
// (ชื่อซ้ำกับคนอื่น → Render ต่อท้ายให้ เช่น game-store-4944.onrender.com) ลิงก์ในอีเมล/ใบเสร็จ/sitemap จะชี้ไปเว็บคนอื่น
// → ใช้ Host ของคำขอแรกที่เข้ามาทาง *.onrender.com แทน: proxy ของ Render ส่งคำขอมาที่ service ตาม Host ที่ลงทะเบียนไว้
// จึงปลอมเป็นโดเมนอื่นไม่ได้ (ใช้ header Host เท่านั้น ไม่เชื่อ X-Forwarded-Host ที่ผู้ใช้ใส่เองได้)
// ตั้ง APP_URL เอง (เช่น โดเมนของร้าน) = ไม่ใช้กลไกนี้
const RENDER_HOST = /^[a-z0-9-]+\.onrender\.com$/;

export function renderHostLearner(cfg, env = process.env, log = console.log) {
  if (!env.RENDER || env.APP_URL || env.BASE_URL) return null;
  let done = false;
  return (req, _res, next) => {
    if (!done) {
      const host = String(req.headers.host ?? '').trim().toLowerCase();
      if (RENDER_HOST.test(host)) {
        done = true;
        const url = `https://${host}`;
        if (url !== cfg.appUrl) {
          log(`✓ URL ของร้านคือ ${url} (จากคำขอจริง — RENDER_EXTERNAL_URL เป็น ${cfg.appUrl})`);
          if (!env.CORS_ORIGINS) cfg.corsOrigins = [url];
          cfg.appUrl = url;
        }
      }
    }
    next();
  };
}
