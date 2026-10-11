import { api, cardHtml, remember, $, markReady, esc, t } from './common.js';
import { canRender3D, prefersReducedMotion, whenIdle } from './motion.js';
import { gsap, ScrollTrigger } from './vendor/gsap.js';

gsap.registerPlugin(ScrollTrigger);

// hero อยู่ใน index.html แล้ว (แสดงผลทันทีไม่ต้องรอ API) — ที่นี่เติมแค่ลิงก์เกมแนะนำ
const data = await api('/games/home');
const heroGame = data.featured[0];
if (heroGame) {
  $('#heroFeatured').innerHTML = `${t('hero.featured')} <a href="/game/${esc(heroGame.slug)}">${esc(heroGame.title)}</a>`; // บรรทัดนี้จองที่ไว้ใน HTML แล้ว
}

for (const key of ['featured', 'bestsellers', 'newest', 'onSale']) {
  let items = data[key];
  if (key === 'featured') items = items.slice(1, 5); // เกมแรกอยู่ใน hero แล้ว; bento มี 4 ช่อง
  remember(items);
  const grid = $('#' + key);
  grid.innerHTML = items.map(cardHtml).join('');
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
    gsap.fromTo(grid.querySelectorAll('.card'), { y: 32, opacity: 0 }, {
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
