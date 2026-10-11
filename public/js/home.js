import { api, cardHtml, remember, $, markReady, esc, t, genreName, priceHtml } from './common.js';
import { canRender3D, prefersReducedMotion, whenIdle } from './motion.js';
import { gsap, ScrollTrigger } from './vendor/gsap.js';

gsap.registerPlugin(ScrollTrigger);

// hero อยู่ใน index.html แล้ว (แสดงผลทันทีไม่ต้องรอ API) — ที่นี่เติมแค่ลิงก์เกมแนะนำ
const [data, facets] = await Promise.all([api('/games/home'), api('/games/facets').catch(() => ({ genres: [], platforms: [] }))]);
const heroGame = data.featured[0];
if (heroGame) {
  $('#heroFeatured').innerHTML = `${t('hero.featured')} <a href="/game/${esc(heroGame.slug)}">${esc(heroGame.title)}</a>`; // บรรทัดนี้จองที่ไว้ใน HTML แล้ว
}

// ---- bento เกมแนะนำ + ทางลัด: ช่อง a = เกมเด่น, b = ดีลลดแรงสุด, c = ตามงบ, d = แพลตฟอร์ม, e/f = เกมแนะนำ, g = แนวเกม ----
const links = (items) => `<ul class="tile-links">${items.map(([href, label]) => `<li><a href="${esc(href)}">${esc(label)}</a></li>`).join('')}</ul>`;
const linkTile = (area, id, title, items) => `<nav class="tile tile-links-wrap area-${area}" aria-labelledby="${id}"><h3 class="tile-label" id="${id}">${title}</h3>${links(items)}</nav>`;
function bentoHtml() {
  const [, big, ...more] = data.featured; // เกมแรกอยู่ใน hero แล้ว
  const deal = data.onSale[0]; // API เรียงตามส่วนลดมากสุด
  const gameTile = (area, g) => (g ? `<div class="area-${area}">${cardHtml(g)}</div>` : '');
  return [
    gameTile('a', big),
    deal ? `<a class="tile tile-deal area-b" href="/game/${esc(deal.slug)}">
        <img class="tile-bg" src="${esc(deal.cover)}?size=sm" alt="" loading="lazy" decoding="async" width="400" height="300">
        <span class="tile-label">${t('home.deal')}</span>
        <strong class="deal-pct">-${deal.discount}%</strong>
        <span class="deal-title">${esc(deal.title)}</span>
        <span class="price">${priceHtml(deal)}</span>
      </a>` : '',
    linkTile('c', 'tileBudget', t('home.budget'), [
      ['/games.html?maxPrice=500&sort=priceAsc', t('home.budget1')],
      ['/games.html?minPrice=500&maxPrice=1000&sort=priceAsc', t('home.budget2')],
      ['/games.html?minPrice=1000&sort=priceAsc', t('home.budget3')],
    ]),
    linkTile('d', 'tilePlatforms', t('home.platforms'), facets.platforms.map((p) => [`/games.html?platform=${encodeURIComponent(p)}`, p])),
    gameTile('e', more[0]),
    gameTile('f', more[1]),
    linkTile('g', 'tileGenres', t('home.genres'), facets.genres.map((g) => [`/games.html?genre=${encodeURIComponent(g)}`, genreName(g)])),
  ].join('');
}
remember(data.featured.slice(1, 4));
$('#featured').innerHTML = bentoHtml();
$('#featured').removeAttribute('aria-busy');

for (const key of ['bestsellers', 'newest', 'onSale']) {
  remember(data[key]);
  const grid = $('#' + key);
  grid.innerHTML = data[key].map(cardHtml).join('');
  grid.removeAttribute('aria-busy');
}
markReady();

if (!prefersReducedMotion()) {
  // หัวข้อ hero ไม่เริ่มจากโปร่งใส (เป็น LCP element — ถ้าซ่อนไว้ LCP จะช้าตามแอนิเมชัน) ขยับเฉพาะองค์ประกอบรอง
  // fromTo + ค่าปลายทางชัดเจน + clearProps: ไม่อ่านค่าจาก CSS ระหว่าง transition และคืน style ให้ CSS (hover) เมื่อจบ
  const done = { opacity: 1, y: 0, clearProps: 'opacity,transform' };
  gsap.timeline({ defaults: { ease: 'power3.out', duration: 0.6 } })
    .fromTo('.hero-eyebrow', { y: 12, opacity: 0 }, { ...done })
    .fromTo('.hero-actions .btn', { y: 16, opacity: 0 }, { ...done, stagger: 0.08 }, '-=0.35')
    .fromTo('.hero-points li', { y: 12, opacity: 0 }, { ...done, stagger: 0.06 }, '-=0.35');

  for (const grid of document.querySelectorAll('.content-wrapper .grid')) {
    gsap.fromTo(grid.querySelectorAll(':scope > .tile, .card'), { y: 32, opacity: 0 }, {
      ...done, duration: 0.6, stagger: 0.05, ease: 'power2.out',
      scrollTrigger: { trigger: grid, start: 'top 88%', once: true },
    });
  }
}

// ฉาก 3D: โหลดแบบ lazy หลังหน้าแสดงผลแล้ว และเฉพาะเครื่องที่รองรับ — ไม่งั้นใช้พื้นหลังนิ่ง (.hero-fallback) ต่อไป
if (canRender3D()) {
  whenIdle(async () => {
    try {
      const { mountHeroScene } = await import('./three-hero.js');
      mountHeroScene($('#heroBg'));
    } catch (e) {
      console.warn('ไม่สามารถแสดงฉาก 3D:', e.message); // เช่น WebGL context สร้างไม่ได้ → ยังเห็นพื้นหลังนิ่ง
    }
  });
}
