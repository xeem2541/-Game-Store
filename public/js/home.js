import { api, cardHtml, remember, $, markReady, esc, t, genreName, priceHtml, lang, toast, getRecent, clearRecent, topGenre } from './common.js';
import { canRender3D, prefersReducedMotion, whenIdle } from './motion.js';
import { splitWords } from './kinetic.js';
import { initScrollFx } from './scroll-fx.js';
import { gsap } from './vendor/gsap.js';

initScrollFx(); // parallax สำรองสำหรับเบราว์เซอร์ที่ไม่รองรับ CSS scroll-driven animation

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

// มือถือ/แท็บเล็ต: กองปกเกมแนะนำแบบปัดได้ (จอกว้างซ่อนด้วย CSS — ภาพ lazy จึงไม่โหลดบนจอกว้าง)
// เอียง 3D ตามตำแหน่งการ์ดใช้ CSS scroll-driven animation; จุดบอกตำแหน่งอัปเดตด้วย IntersectionObserver
const deckGames = data.featured.slice(0, 6);
const track = $('#deckTrack');
// การ์ดแรกเป็นภาพใหญ่สุดของจอแรกบนมือถือ (LCP) → โหลดทันทีความสำคัญสูง; จอกว้างกองนี้ซ่อน จึงไม่โหลด
const deckShown = matchMedia('(max-width: 900px)').matches;
if (deckGames.length) {
  track.innerHTML = deckGames.map((g, i) => `
    <a class="deck-card" href="/game/${esc(g.slug)}">
      <img src="${esc(g.cover)}" alt="" width="400" height="300" ${i === 0 && deckShown ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"'}>
      ${g.discount ? `<span class="deck-badge">-${g.discount}%</span>` : ''}
      <span class="deck-info"><span class="deck-title">${esc(g.title)}</span><span class="deck-meta"><span>${esc(g.platform)}</span><span class="deck-price">${priceHtml(g)}</span></span></span>
      <span class="sr-only">${t('hero.deckPos', { n: i + 1, total: deckGames.length })}</span>
    </a>`).join('');
  track.removeAttribute('aria-busy');
  const dots = $('#deckDots');
  dots.innerHTML = deckGames.map(() => '<span></span>').join('');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const i = [...track.children].indexOf(e.target);
      [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
    }
  }, { root: track, threshold: 0.6 });
  [...track.children].forEach((c) => io.observe(c));
} else {
  $('#heroDeck').hidden = true;
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

// ---- แถวเฉพาะคน: "เกมที่คุณเพิ่งดู" + "เพราะคุณสนใจแนว…" (อ่านจากประวัติการดูในเครื่อง ไม่ส่งไปเซิร์ฟเวอร์) ----
async function personalRows() {
  const recent = getRecent();
  const sec = $('#recentSec');
  const forSec = $('#forYouSec');
  if (!recent.length) { sec.hidden = true; forSec.hidden = true; return; }
  const seen = new Set(recent.map((r) => r.slug));
  const genre = topGenre(recent);
  const [mine, more] = await Promise.all([
    api(`/games?limit=12&slugs=${recent.map((r) => r.slug).join(',')}`).catch(() => ({ items: [] })),
    api(`/games?genre=${encodeURIComponent(genre)}&sort=bestseller&limit=12`).catch(() => ({ items: [] })),
  ]);
  const order = new Map(recent.map((r, i) => [r.slug, i]));
  const viewed = mine.items.sort((a, b) => order.get(a.slug) - order.get(b.slug)).slice(0, 8); // ใหม่สุดก่อน
  const picks = more.items.filter((g) => !seen.has(g.slug)).slice(0, 8);
  remember([...viewed, ...picks]);
  const fill = (el, list) => { el.innerHTML = list.map(cardHtml).join(''); };
  sec.hidden = !viewed.length;
  fill($('#recent'), viewed);
  forSec.hidden = picks.length < 3;
  if (!forSec.hidden) {
    $('#forYouText').textContent = t('home.becauseGenre', { genre: genreName(genre) });
    $('#forYouAll').setAttribute('href', `/games.html?genre=${encodeURIComponent(genre)}&sort=bestseller`);
    fill($('#forYou'), picks);
  }
}
$('#recentClear').addEventListener('click', () => {
  clearRecent();
  $('#recentSec').hidden = true;
  $('#forYouSec').hidden = true;
  toast(t('home.recentCleared'));
});
personalRows();

// ---- ซื้อยังไง 3 ขั้น: ขั้นที่อยู่กลางจอเป็นขั้นปัจจุบัน → ภาพด้านซ้ายเปลี่ยนตาม (ทำงานแม้ขอลดการเคลื่อนไหว เพราะเป็นข้อมูล แค่ไม่มีแอนิเมชัน) ----
const visual = $('.howto-visual');
const progress = $('.howto-progress');
const steps = [...document.querySelectorAll('.howto-step')];
// มือถือ: ภาพประกอบของแต่ละขั้นอยู่ในการ์ดของขั้นนั้น (desktop ใช้ภาพเดียวติดกับที่ด้านซ้าย — สำเนานี้ CSS ซ่อนไว้)
for (const step of steps) {
  const src = $(`.hv-${step.dataset.step}`);
  if (!src) continue;
  const mini = document.createElement('div');
  mini.className = `howto-mini hv-${step.dataset.step}`;
  if (src.hasAttribute('aria-hidden')) mini.setAttribute('aria-hidden', 'true');
  mini.append(...[...src.childNodes].map((n) => n.cloneNode(true)));
  step.prepend(mini);
}
// ปกเกมในฉาก 1 (ทั้งภาพหลักและสำเนาในการ์ดมือถือ) — ตั้งผ่าน CSSOM (CSP ไม่อนุญาต style แบบ inline)
for (const box of document.querySelectorAll('.hv-covers')) {
  data.featured.slice(1, 4).forEach((g, i) => { if (box.children[i]) box.children[i].style.backgroundImage = `url('${g.cover}?size=sm')`; });
}
// ฉาก 3: คูปองเป็นของเกมที่ถูกเลือกในฉาก 1 (ปกใบกลาง)
const picked = data.featured[2];
if (picked) {
  for (const v of document.querySelectorAll('.hv-voucher')) {
    v.querySelector('.hv-v-art').style.backgroundImage = `url('/api/games/${encodeURIComponent(picked.slug)}/scene.svg')`; // ฉากไม่มีชื่อเกม (ชื่ออยู่ฝั่งขวาแล้ว)
    v.querySelector('.hv-v-title').textContent = picked.title;
    v.querySelector('.hv-v-platform').textContent = picked.platform;
  }
}
function setStep(el) {
  for (const s of steps) s.classList.toggle('is-active', s === el);
  visual.dataset.step = el.dataset.step;
  if (!progress.classList.contains('scrub')) progress.style.setProperty('--p', el.dataset.step / steps.length);
}
// ขั้นปัจจุบัน = ขั้นที่ครอบกลางจอ (หรือใกล้กลางจอที่สุด) — คำนวณทันทีตอนเลื่อน (อ่านตำแหน่งแค่ 3 กล่อง ไม่แพง)
// ไม่ใช้ IntersectionObserver แถบบาง ๆ กลางจอ หรือรอ requestAnimationFrame: Safari/WebKit พลาดการแจ้งเมื่อเลื่อนข้ามขั้นแบบทันที
const stepsList = $('.howto-steps');
const pickStep = () => {
  const mid = innerHeight / 2;
  // desktop + มีแอนิเมชัน: แถบความคืบหน้าเลื่อนตามจริง (0 เมื่อขั้นแรกถึงกลางจอ → 1 เมื่อขั้นสุดท้ายพ้นกลางจอ)
  if (progress.classList.contains('scrub')) {
    const r = stepsList.getBoundingClientRect();
    progress.style.setProperty('--p', Math.min(1, Math.max(0, (mid - r.top) / r.height)).toFixed(3));
  }
  let best = steps[0];
  let bestDist = Infinity;
  for (const s of steps) {
    const r = s.getBoundingClientRect();
    const dist = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
    if (dist < bestDist) { bestDist = dist; best = s; }
  }
  if (best.dataset.step !== visual.dataset.step) setStep(best);
};
setStep(steps[0]);
addEventListener('scroll', pickStep, { passive: true });

// ฉาก 2: ลองกดสลับวิธีชำระ บัตร ↔ PromptPay (ภาพเปลี่ยนตาม — CSS ทำแอนิเมชัน) ทั้งภาพหลักและในการ์ดมือถือ
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.hv-methods button[data-method]');
  if (!btn) return;
  btn.closest('.hv-pay').dataset.method = btn.dataset.method;
  for (const b of btn.parentElement.children) b.setAttribute('aria-pressed', String(b === btn));
});
// เนื้อหาด้านบนโหลดทีหลังแล้วดันส่วนนี้ลง (Safari ไม่มี scroll anchoring → ไม่มี scroll event) ให้เลือกขั้นใหม่ด้วย
new ResizeObserver(pickStep).observe(document.body);
// สำรอง: ขั้นใดเข้า/ออกจอหรือเปลี่ยนสัดส่วนที่เห็น → คำนวณใหม่ (กรณีเบราว์เซอร์ไม่ส่ง scroll event ตอนเลื่อนแบบทันที)
const stepIo = new IntersectionObserver(pickStep, { threshold: [0, 0.25, 0.5, 0.75, 1] });
for (const s of steps) stepIo.observe(s);
pickStep();

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

  // แอนิเมชันตอนเลื่อนถึง: ใช้ IntersectionObserver (ไม่อ่านเลย์เอาต์ทั้งหน้าแบบ ScrollTrigger ที่ทำให้หน้าแรกค้างบนมือถือ)
  // เริ่มก่อนเข้าจอเล็กน้อย; ส่วนที่อยู่ในจออยู่แล้วตอนโหลดเริ่มทันที (ไม่กะพริบ: แสดง → ซ่อน → ลอยขึ้น)
  const howtoTitle = $('#howtoTitle > span');
  const reveals = [
    // หัวข้อ "ซื้อง่ายใน 3 ขั้น" แยกคำแล้วลอยขึ้น
    [howtoTitle, () => gsap.fromTo(splitWords(howtoTitle, { locale: lang }), { yPercent: 80, opacity: 0 }, {
      yPercent: 0, opacity: 1, duration: 0.6, stagger: 0.06, ease: 'power3.out', clearProps: 'opacity,transform',
    })],
    ...[...document.querySelectorAll('.content-wrapper .grid:not([data-late])')].map((grid) => [grid, () => gsap.fromTo(grid.querySelectorAll(':scope > .tile, .card'), { y: 32, opacity: 0 }, {
      ...done, duration: 0.6, stagger: 0.05, ease: 'power2.out',
    })]),
  ];
  // อ่านตำแหน่งทุกส่วนก่อนเขียน style ใด ๆ (อ่านสลับเขียน = บังคับคำนวณเลย์เอาต์ใหม่ทุกครั้ง)
  const inViewNow = reveals.map(([el]) => el.getBoundingClientRect().top < innerHeight);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      reveals.find(([el]) => el === e.target)[1]();
    }
  }, { rootMargin: '0px 0px 80px 0px' });
  reveals.forEach(([el, run], i) => (inViewNow[i] ? run() : io.observe(el)));

  // แถบความคืบหน้าเลื่อนตามจริง (คำนวณใน pickStep) แทนการกระโดดทีละขั้น — desktop เท่านั้น (มือถือไม่มีภาพประกอบ)
  if (matchMedia('(min-width: 901px)').matches) {
    progress.classList.add('scrub');
    requestAnimationFrame(pickStep);
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
