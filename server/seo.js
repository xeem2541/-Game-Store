import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { db } from './db/index.js';
import { UPLOAD_DIR } from './services/images.js';

// หน้า HTML ที่ต้องมี meta SEO จริง (เซิร์ฟเวอร์ใส่แทน <!--SEO--> ในเทมเพลต) — อ่านเทมเพลตจากโฟลเดอร์ที่ใช้งานอยู่ (public หรือ dist/public)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const SITE = 'Geme Store';
const DEFAULT_DESC = 'Geme Store ร้านขายเกมออนไลน์ PC, PS5, Switch รับโค้ดเกมทันทีหลังชำระเงิน ราคาโดนใจ ลดสูงสุด 50%';

export const absUrl = (p) => `${config.appUrl}${p}`;

export function seoTags({ title, description = DEFAULT_DESC, path: p = '/', image, type = 'website', robots, jsonLd }) {
  const url = absUrl(p);
  const img = image ? absUrl(image) : absUrl('/og/default.png');
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    robots ? `<meta name="robots" content="${esc(robots)}">` : '',
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:site_name" content="${SITE}">`,
    `<meta property="og:type" content="${esc(type)}">`,
    `<meta property="og:locale" content="th_TH">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
  ];
  // JSON-LD เป็น data block (ไม่ใช่สคริปต์ที่รัน) จึงไม่ขัดกับ CSP; escape "<" กันปิดแท็กก่อนเวลา
  if (jsonLd) tags.push(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`);
  return tags.filter(Boolean).join('\n  ');
}

// ---------- เทมเพลต ----------
let rootDir;
const cache = new Map();
export const setTemplateRoot = (dir) => { rootDir = dir; cache.clear(); };
function template(name) {
  if (!config.isProd || !cache.has(name)) cache.set(name, fs.readFileSync(path.join(rootDir, name), 'utf8'));
  return cache.get(name);
}
export const renderTemplate = (name, meta) => template(name).replace('<!--SEO-->', seoTags(meta));

export const finalPrice = (g) => Math.round((g.price * (100 - g.discount)) / 100);

export function homeMeta() {
  return {
    title: 'Geme Store – ร้านขายเกมออนไลน์ เกมแท้ ราคาโดนใจ', path: '/', image: '/og/default.png',
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'WebSite', name: SITE, url: absUrl('/'),
      potentialAction: { '@type': 'SearchAction', target: `${absUrl('/games.html')}?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
    },
  };
}
export const gamesMeta = () => ({ title: 'เกมทั้งหมด – Geme Store', description: 'เลือกซื้อเกม PC, PS5, Switch ทุกแนว ค้นหาและกรองตามหมวดหมู่ ราคา และแพลตฟอร์ม', path: '/games.html' });

// หน้ารายละเอียดเกม: Product + Offer + AggregateRating (เฉพาะเมื่อมีรีวิวจริง — ไม่แต่งตัวเลข)
export function gameMeta(slug) {
  const g = db.prepare('SELECT * FROM games_v WHERE slug = ? AND active = 1').get(slug);
  if (!g) return { found: false, meta: { title: 'ไม่พบเกม – Geme Store', description: 'ไม่พบเกมที่คุณต้องการ', path: `/game/${slug}`, robots: 'noindex,nofollow' } };
  const stock = db.prepare("SELECT COUNT(*) AS n FROM game_keys WHERE game_id = ? AND status = 'available'").get(g.id).n;
  const image = `/og/${g.slug}.png`;
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Product', name: g.title, description: g.description, image: [absUrl(image)],
    sku: g.slug, category: g.genre, brand: { '@type': 'Brand', name: g.platform },
    offers: {
      '@type': 'Offer', url: absUrl(`/game/${g.slug}`), priceCurrency: 'THB', price: (finalPrice(g) / 100).toFixed(2),
      availability: stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  };
  if (g.review_count > 0) jsonLd.aggregateRating = { '@type': 'AggregateRating', ratingValue: String(g.rating), reviewCount: g.review_count, bestRating: '5', worstRating: '1' };
  return {
    found: true, game: g,
    meta: { title: `${g.title} – Geme Store`, description: g.description.slice(0, 200), path: `/game/${g.slug}`, image, type: 'product', jsonLd },
  };
}

// ---------- sitemap.xml / robots.txt ----------
const STATIC_URLS = ['/', '/games.html', '/privacy', '/terms', '/refund-policy'];

export function sitemapXml() {
  const games = db.prepare('SELECT slug FROM games WHERE active = 1 ORDER BY id').all();
  const urls = [...STATIC_URLS, ...games.map((g) => `/game/${g.slug}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(absUrl(u))}</loc></url>`).join('\n')}\n</urlset>\n`;
}

export const robotsTxt = () => [
  'User-agent: *',
  'Allow: /',
  ...['/admin', '/api/', '/cart', '/checkout', '/profile', '/order/', '/login', '/register', '/forgot', '/reset', '/verify'].map((p) => `Disallow: ${p}`),
  '',
  `Sitemap: ${absUrl('/sitemap.xml')}`,
  '',
].join('\n');

// ---------- รูป Open Graph 1200x630 (PNG — บางแพลตฟอร์มไม่รองรับ SVG) ----------
const og = new Map();
const FONT = "Sarabun, Tahoma, 'Noto Sans Thai', 'Leelawadee UI', sans-serif";

// ตัดบรรทัดตามคำ (Thai ไม่มีช่องว่าง ใช้ Intl.Segmenter) ไม่เกิน maxChars ต่อบรรทัด สูงสุด 3 บรรทัด
function wrap(text, maxChars) {
  const words = [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map((s) => s.segment);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + w).length > maxChars && cur.trim()) { lines.push(cur.trim()); cur = w; } else cur += w;
  }
  if (cur.trim()) lines.push(cur.trim());
  if (lines.length > 3) { lines.length = 3; lines[2] = lines[2].replace(/.{1}$/, '…'); }
  return lines;
}
const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function buildOg({ title, subtitle, color1, color2, coverFile }) {
  const lines = wrap(title, 16);
  const text = lines.map((l, i) => `<text x="70" y="${330 - (lines.length - 1) * 40 + i * 92}" font-size="84" font-weight="800" fill="#fff" font-family="${FONT}">${xmlEsc(l)}</text>`).join('');
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".15"/><stop offset="1" stop-color="#000" stop-opacity=".78"/></linearGradient></defs>
    <rect width="1200" height="630" fill="url(#g)"/>${text}
    <text x="70" y="520" font-size="40" fill="#fff" fill-opacity=".92" font-family="${FONT}">${xmlEsc(subtitle)}</text>
    <text x="70" y="585" font-size="34" font-weight="700" fill="#00d4ff" font-family="${FONT}">🎮 Geme Store</text></svg>`;
  const bg = coverFile
    ? sharp(coverFile).resize(1200, 630, { fit: 'cover' })
    : sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color1}"/><stop offset="1" stop-color="${color2}"/></linearGradient></defs><rect width="1200" height="630" fill="url(#b)"/></svg>`));
  return bg.composite([{ input: Buffer.from(overlay) }]).png({ compressionLevel: 9 }).toBuffer();
}

export async function ogImage(slug) {
  let spec;
  if (slug === 'default') spec = { title: 'Geme Store', subtitle: 'ร้านขายเกมออนไลน์ เกมแท้ ราคาโดนใจ', color1: '#3b2a9e', color2: '#0a7fa8' };
  else {
    const g = db.prepare('SELECT title, genre, platform, price, discount, color1, color2, cover_image FROM games WHERE slug = ? AND active = 1').get(slug);
    if (!g) return null;
    const p = finalPrice(g);
    spec = { title: g.title, subtitle: `${g.platform} • ${g.genre} • ${p === 0 ? 'ฟรี' : `฿${(p / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`}`, color1: g.color1, color2: g.color2, coverFile: g.cover_image ? path.join(UPLOAD_DIR, g.cover_image) : null };
  }
  const key = JSON.stringify(spec);
  if (!og.has(key)) {
    if (og.size >= 300) og.delete(og.keys().next().value); // จำกัดขนาดแคช
    og.set(key, await buildOg(spec).catch(() => buildOg({ ...spec, coverFile: null })));
  }
  return og.get(key);
}
