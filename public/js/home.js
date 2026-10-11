import { api, cardHtml, remember, $, markReady, esc, t, genreName, priceHtml, lang } from './common.js';
import { canRender3D, prefersReducedMotion, whenIdle } from './motion.js';
import { splitWords } from './kinetic.js';
import { gsap, ScrollTrigger } from './vendor/gsap.js';

gsap.registerPlugin(ScrollTrigger);

// หัวข้อ hero แยกเป็นคำ (ทำก่อนรอ API เพื่อให้เปลี่ยนเร็วที่สุดหลังแสดงผลแรก) — ขนาดและตำแหน่งข้อความไม่เปลี่ยน แค่ห่อคำด้วย span
const heroWords = splitWords($('#heroTitle'), { locale: lang });

// hero อยู่ใน index.html แล้ว (แสดงผลทันทีไม่ต้องรอ API) — ที่นี่เติมแค่ลิงก์เกมแนะนำ
const [data, facets] = await Promise.all([api('/games/home'), api('/games/facets').catch(() => ({ genres: [], platforms: [] }))]);
const heroGame = data.featured[0];
if (heroGame) {
  $('#heroFeatured').innerHTML = `${t('hero.featured')} <a href="/game/${esc(heroGame.slug)}">${esc(heroGame.title)}</a>`; // บรรทัดนี้จองที่ไว้ใน HTML แล้ว
}
// ภาพปกเกมแนะนำ 3 เกม: ใช้ทั้งในฉาก 3D และภาพนิ่งสำรอง (.hero-stack) สำหรับเครื่องที่ไม่แสดง 3D
const heroCovers = data.featured.slice(0, 3).map((g) => g.cover);
$('#heroStack').innerHTML = heroCovers.map((src) => `<img src="${esc(src)}" alt="" width="400" height="300" decoding="async">`).join('');

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

// ---- ซื้อยังไง 3 ขั้น: ขั้นที่อยู่กลางจอเป็นขั้นปัจจุบัน → ภาพด้านซ้ายเปลี่ยนตาม (ทำงานแม้ขอลดการเคลื่อนไหว เพราะเป็นข้อมูล แค่ไม่มีแอนิเมชัน) ----
const visual = $('.howto-visual');
const progress = $('.howto-progress');
const covers = $('.hv-covers').children;
data.featured.slice(1, 4).forEach((g, i) => { if (covers[i]) covers[i].style.backgroundImage = `url('${g.cover}?size=sm')`; });
const steps = [...document.querySelectorAll('.howto-step')];
function setStep(el) {
  for (const s of steps) s.classList.toggle('is-active', s === el);
  visual.dataset.step = el.dataset.step;
  if (!progress.classList.contains('scrub')) progress.style.setProperty('--p', el.dataset.step / steps.length);
}
setStep(steps[0]);
const stepObserver = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) setStep(e.target);
}, { rootMargin: '-45% 0px -45% 0px' }); // แถบบาง ๆ กลางจอ
steps.forEach((s) => stepObserver.observe(s));

if (!prefersReducedMotion()) {
  // หัวข้อ hero ไม่เริ่มจากโปร่งใส (เป็น LCP element — ถ้าซ่อนไว้ LCP จะช้าตามแอนิเมชัน) ขยับเฉพาะองค์ประกอบรอง
  // fromTo + ค่าปลายทางชัดเจน + clearProps: ไม่อ่านค่าจาก CSS ระหว่าง transition และคืน style ให้ CSS (hover) เมื่อจบ
  const done = { opacity: 1, y: 0, clearProps: 'opacity,transform' };
  gsap.timeline({ defaults: { ease: 'power3.out', duration: 0.6 } })
    // kinetic: คำในหัวข้อลอยขึ้นทีละคำ (แสดงผลแรกเห็นหัวข้อเต็มแล้ว LCP จึงไม่รอแอนิเมชันนี้)
    .fromTo(heroWords, { yPercent: 60, rotate: 4, opacity: 0 }, { yPercent: 0, rotate: 0, opacity: 1, duration: 0.7, stagger: 0.07, clearProps: 'opacity,transform' })
    .fromTo('.hero-eyebrow', { y: 12, opacity: 0 }, { ...done }, 0)
    .fromTo('.hero-actions .btn', { y: 16, opacity: 0 }, { ...done, stagger: 0.08 }, '-=0.35')
    .fromTo('.hero-points li', { y: 12, opacity: 0 }, { ...done, stagger: 0.06 }, '-=0.35');

  // หัวข้อ "ซื้อง่ายใน 3 ขั้น" แยกคำแล้วลอยขึ้นตอนเลื่อนถึง
  const howtoTitle = $('#howtoTitle > span');
  gsap.fromTo(splitWords(howtoTitle, { locale: lang }), { yPercent: 80, opacity: 0 }, {
    yPercent: 0, opacity: 1, duration: 0.6, stagger: 0.06, ease: 'power3.out', clearProps: 'opacity,transform',
    scrollTrigger: { trigger: howtoTitle, start: 'top 85%', once: true },
  });
  // แถบความคืบหน้าเลื่อนตามจริง (scrub) แทนการกระโดดทีละขั้น — desktop เท่านั้น (มือถือไม่มีภาพประกอบ)
  if (matchMedia('(min-width: 901px)').matches) {
    progress.classList.add('scrub');
    gsap.fromTo(progress.firstElementChild, { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { trigger: '.howto-steps', start: 'top center', end: 'bottom center', scrub: true } });
  }

  for (const grid of document.querySelectorAll('.content-wrapper .grid')) {
    gsap.fromTo(grid.querySelectorAll(':scope > .tile, .card'), { y: 32, opacity: 0 }, {
      ...done, duration: 0.6, stagger: 0.05, ease: 'power2.out',
      scrollTrigger: { trigger: grid, start: 'top 88%', once: true },
    });
  }
}

// ฉาก 3D: โหลดแบบ lazy หลังหน้าแสดงผลแล้ว และเฉพาะเครื่องที่รองรับ — ไม่งั้นใช้ภาพนิ่ง (.hero-fallback / .hero-stack) ต่อไป
// เฉพาะจอกว้าง: จอเล็กฉากจะอยู่หลังข้อความแบบจาง ๆ คุ้มน้อยกว่าแบตและเน็ตที่เสีย (131 KB) — ใช้พื้นหลังนิ่งแทน
if (canRender3D() && matchMedia('(min-width: 901px)').matches) {
  whenIdle(async () => {
    try {
      const { mountHeroScene } = await import('./three-hero.js');
      mountHeroScene($('#heroBg'), { covers: heroCovers });
    } catch (e) {
      console.warn('ไม่สามารถแสดงฉาก 3D:', e.message); // เช่น WebGL context สร้างไม่ได้ → ยังเห็นพื้นหลังนิ่ง
    }
  });
}
