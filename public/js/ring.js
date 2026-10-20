// วงล้อเกม 3 มิติ (UI เฟส 25): ฉากค้างกลางจอ (position: sticky) แล้ววงล้อปกเกมหมุนตามการเลื่อน — เกมที่หันหน้ามาข้างหน้าแสดงชื่อ/ราคา
// - CSS 3D transform ล้วน (ไม่ใช้ WebGL): ทุกเครื่องรวมมือถือ, คำนวณไม่เกินเฟรมละครั้ง, ขยับด้วย transform/opacity เท่านั้น
// - เนื้อหาจริงเป็น <ul> ของลิงก์ — screen reader อ่านเป็นรายการปกติ; Tab ไปที่เกมไหน หน้าเลื่อนให้วงล้อหมุนเกมนั้นมาข้างหน้า
// - ขอลดการเคลื่อนไหว: ไม่สร้างวงล้อ (CSS แสดงเป็นแถวปัดแนวนอน และไม่จองความสูงสำหรับการเลื่อน)
import { esc, priceHtml } from './common.js';
import { prefersReducedMotion } from './motion.js';

const pad = (n) => String(n).padStart(2, '0');

export function mountRing(sec, games) {
  const ring = sec?.querySelector('.ring');
  if (!ring) return;
  if (games.length < 3) { sec.hidden = true; return; }
  ring.innerHTML = games.map((g) => `
    <li class="ring-item" data-c1="${esc(g.color1 ?? '')}">
      <a href="/game/${esc(g.slug)}">
        <img src="${esc(g.cover)}?size=sm" alt="" width="400" height="300" loading="lazy" decoding="async">
        <span class="ring-cap">${esc(g.title)}</span>
      </a>
    </li>`).join('');
  ring.removeAttribute('aria-busy');
  const items = [...ring.children];

  const name = sec.querySelector('.ring-name');
  const price = sec.querySelector('.ring-price');
  const count = sec.querySelector('.ring-count');
  const n = items.length;
  let front = -1;
  const setFront = (i) => {
    if (i === front) return;
    front = i;
    items.forEach((li, j) => li.classList.toggle('is-front', j === i));
    name.textContent = games[i].title;
    price.innerHTML = priceHtml(games[i]);
    count.textContent = `${pad(i + 1)} / ${pad(n)}`;
  };
  setFront(0);
  if (prefersReducedMotion()) return; // แถวปัดแนวนอน (CSS) — ชื่อ/ราคาอ่านจากการ์ดได้อยู่แล้ว

  sec.classList.add('is-ring');
  const step = 360 / n;
  // มุมประจำตำแหน่งของแต่ละการ์ด — ตั้งผ่าน CSSOM (CSP ไม่อนุญาต style แบบ inline ใน HTML)
  items.forEach((li, i) => li.style.setProperty('--a', `${i * step}deg`));
  let radius = 0;
  const layout = () => {
    const w = items[0].offsetWidth || 1;
    radius = Math.round((w / 2) / Math.tan(Math.PI / n) * 1.18); // วงพอดีให้การ์ดข้าง ๆ ไม่ทับกัน
    sec.style.setProperty('--ring-r', `${radius}px`);
  };
  layout();
  new ResizeObserver(layout).observe(ring);

  // ความคืบหน้าการเลื่อนผ่านส่วนนี้ 0 → 1 (ช่วงที่ฉากค้างอยู่กลางจอ) → มุมของวงล้อ
  const progress = () => {
    const r = sec.getBoundingClientRect();
    const span = r.height - innerHeight;
    return span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
  };
  let frame = 0;
  const apply = () => {
    frame = 0;
    const p = progress();
    const angle = p * step * (n - 1);
    ring.style.transform = `translateZ(${-radius}px) rotateX(-8deg) rotateY(${(-angle).toFixed(2)}deg)`;
    items.forEach((li, i) => {
      let rel = ((i * step - angle) % 360 + 540) % 360 - 180; // มุมจากด้านหน้า −180..180
      rel = Math.abs(rel) / 180;
      li.style.setProperty('--d', rel.toFixed(3));
    });
    setFront(Math.round(p * (n - 1)));
  };
  const queue = () => { frame ||= requestAnimationFrame(apply); };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue, { passive: true });
  apply();

  // คีย์บอร์ด: Tab ไปเกมไหน เลื่อนหน้าให้เกมนั้นหมุนมาข้างหน้า (ไม่งั้นโฟกัสอยู่บนการ์ดที่หันหลัง)
  ring.addEventListener('focusin', (e) => {
    const i = items.indexOf(e.target.closest('.ring-item'));
    if (i < 0) return;
    const r = sec.getBoundingClientRect();
    const top = scrollY + r.top + (i / (n - 1)) * (r.height - innerHeight);
    scrollTo({ top, behavior: 'instant' });
  });
}
