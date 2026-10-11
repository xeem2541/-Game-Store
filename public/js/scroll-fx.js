// สำรองของ parallax / ค่อย ๆ ปรากฏตามการเลื่อน สำหรับเบราว์เซอร์ที่ยังไม่รองรับ CSS scroll-driven animation
// (Firefox, Safari รุ่นเก่า) — เบราว์เซอร์ที่รองรับใช้ CSS ใน story.css อย่างเดียว ไฟล์นี้ไม่ทำอะไร
// ค่าเดียวกับ story.css: ฉากหลังเลื่อนลง 28% ของความสูงตัวเอง (ชั้นแสงสี 14%) ตลอดการเลื่อน 1 หน้าจอ, ภาพปกเกมขึ้น 56px ตลอด 0.8 หน้าจอ
import { onReducedMotionChange, prefersReducedMotion } from './motion.js';

export const supportsScrollTimeline = () => typeof CSS !== 'undefined' && CSS.supports('animation-timeline: scroll()');

const PARALLAX = [
  { sel: '.hero-bg', range: 1, move: (el, p) => p * 0.28 * el.offsetHeight },
  { sel: '.game-backdrop', range: 1, move: (el, p) => p * 0.28 * el.offsetHeight },
  { sel: '.game-glow', range: 1, move: (el, p) => p * 0.14 * el.offsetHeight },
  { sel: '.detail-cover-wrap', range: 0.8, move: (_el, p) => -56 * p },
];

export function initScrollFx() {
  if (supportsScrollTimeline() || prefersReducedMotion()) return () => {};
  const root = document.documentElement;

  // ---- parallax: คำนวณไม่เกินเฟรมละครั้ง ขยับด้วย transform เท่านั้น ----
  let frame = 0;
  const update = () => {
    frame = 0;
    for (const { sel, range, move } of PARALLAX) {
      for (const el of document.querySelectorAll(sel)) {
        const p = Math.min(1, scrollY / (innerHeight * range));
        el.style.transform = p > 0 ? `translateY(${move(el, p).toFixed(1)}px)` : '';
      }
    }
  };
  const onScroll = () => { frame ||= requestAnimationFrame(update); };
  addEventListener('scroll', onScroll, { passive: true });

  // ---- ค่อย ๆ ปรากฏ: ส่วนที่อยู่ในจออยู่แล้วแสดงทันที (ไม่กะพริบหาย) ที่เหลือรอเลื่อนถึง ----
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('revealed'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -10% 0px' });
  const watch = () => {
    for (const el of document.querySelectorAll('.reveal-scroll:not(.revealed)')) {
      if (el.getBoundingClientRect().top < innerHeight) el.classList.add('revealed');
      else io.observe(el);
    }
  };
  watch();
  root.classList.add('scroll-fx'); // เปิดสไตล์ซ่อน-แล้วปรากฏ หลังทำเครื่องหมายส่วนที่อยู่ในจอแล้ว
  const mo = new MutationObserver(watch); // หน้าเกมเติมเนื้อหาทีหลัง (หลังโหลดข้อมูล)
  mo.observe(document.body, { childList: true, subtree: true });

  const stop = () => {
    removeEventListener('scroll', onScroll);
    cancelAnimationFrame(frame);
    io.disconnect();
    mo.disconnect();
    root.classList.remove('scroll-fx');
    for (const { sel } of PARALLAX) for (const el of document.querySelectorAll(sel)) el.style.transform = '';
  };
  onReducedMotionChange((reduce) => { if (reduce) stop(); }); // ผู้ใช้เปิดลดการเคลื่อนไหวระหว่างดู → หยุดทันที
  update();
  return stop;
}
