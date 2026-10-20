// เคอร์เซอร์วงแสง + สีพื้นหลังตามเกมที่ชี้ + แถวการ์ดเอียงตามความเร็วการเลื่อน (UI เฟส 26) — เรียกจาก fx.js ทุกหน้าร้าน
// - เคอร์เซอร์ของระบบยังอยู่ (ไม่ซ่อน): วงแสงเป็นตัวตามหลังแบบหน่วง ขยายเมื่ออยู่บนลิงก์/ปุ่ม และขึ้นคำว่า "ดู" บนการ์ดเกม
// - วงแสงและการเอียงเฉพาะอุปกรณ์ที่มีเมาส์ และไม่ได้ขอลดการเคลื่อนไหว (fx.js ตรวจก่อนเรียก)
// - สีพื้นหลังตามเกมทำงานกับโฟกัสคีย์บอร์ดด้วย (ไม่ใช่การเคลื่อนไหว จึงไม่ขึ้นกับ reduced motion)
import { t } from './i18n.js';
import { setAmbient } from './ambient.js';

const GAME_SEL = '[data-c1]';
const LINK_SEL = 'a[href], button:not(:disabled), [role="button"], summary, label[for], select';
const TEXT_SEL = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable="true"]';

// ---------- สีพื้นหลังตามเกม (ทุกอุปกรณ์: ชี้ด้วยเมาส์หรือโฟกัสด้วยคีย์บอร์ด) ----------
export function initAmbientHover() {
  let current = null;
  let leaveTimer = 0;
  const enter = (el) => {
    clearTimeout(leaveTimer);
    if (el === current) return;
    current = el;
    setAmbient(el.dataset.c1);
  };
  const leave = () => {
    clearTimeout(leaveTimer);
    // หน่วงเล็กน้อย: เลื่อนเมาส์ข้ามช่องว่างระหว่างการ์ดแล้วสีไม่กะพริบกลับไปมา
    leaveTimer = setTimeout(() => { current = null; setAmbient(null); }, 350);
  };
  document.addEventListener('pointerover', (e) => {
    const g = e.target.closest?.(GAME_SEL);
    g ? enter(g) : current && leave();
  }, { passive: true });
  document.addEventListener('focusin', (e) => {
    const g = e.target.closest?.(GAME_SEL);
    g ? enter(g) : current && leave();
  });
}

// ---------- เคอร์เซอร์วงแสง ----------
export function initCursor() {
  const cur = document.createElement('div');
  cur.className = 'cursor';
  cur.setAttribute('aria-hidden', 'true');
  cur.innerHTML = '<span class="cursor-ring"></span><span class="cursor-label"></span>';
  document.body.append(cur);
  const label = cur.lastElementChild;

  const pos = { x: -100, y: -100 };
  const target = { x: -100, y: -100 };
  let frame = 0;
  let state = '';
  const setState = (s) => {
    if (s === state) return;
    state = s;
    cur.dataset.state = s;
    label.textContent = s === 'game' ? t('cursor.view') : '';
  };
  // ตามแบบหน่วง (lerp) — หยุดวน rAF เมื่อถึงตำแหน่งแล้ว ไม่กินเครื่องตอนเมาส์นิ่ง
  const loop = () => {
    pos.x += (target.x - pos.x) * 0.22;
    pos.y += (target.y - pos.y) * 0.22;
    cur.style.transform = `translate3d(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px, 0)`;
    frame = Math.abs(target.x - pos.x) + Math.abs(target.y - pos.y) > 0.3 ? requestAnimationFrame(loop) : 0;
  };
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    target.x = e.clientX;
    target.y = e.clientY;
    if (!cur.classList.contains('on')) { pos.x = target.x; pos.y = target.y; cur.classList.add('on'); } // ไม่บินมาจากมุมจอตอนเริ่ม
    const el = e.target;
    setState(el.closest?.(TEXT_SEL) || el.closest?.('iframe') ? 'text'
      : el.closest?.(`${GAME_SEL} .cover, ${GAME_SEL}.deck-card, ${GAME_SEL}.ring-item, .ring-item a`) ? 'game'
        : el.closest?.(LINK_SEL) ? 'link' : '');
    frame ||= requestAnimationFrame(loop);
  }, { passive: true });
  document.addEventListener('pointerdown', () => cur.classList.add('down'), { passive: true });
  document.addEventListener('pointerup', () => cur.classList.remove('down'), { passive: true });
  document.documentElement.addEventListener('pointerleave', () => cur.classList.remove('on'));
  // เปิด dialog แบบ modal (ค้นหา/ตัวกรอง) → วงแสงอยู่ใต้ top layer อยู่แล้ว ซ่อนไปเลยจะไม่ดูค้าง
  new MutationObserver(() => cur.classList.toggle('hidden', Boolean(document.querySelector('dialog[open]'))))
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
}

// ---------- แถวการ์ดเอียงตามความเร็วการเลื่อน (desktop) ----------
export const SKEW_MAX = 3; // องศา
export const skewFor = (velocity) => Math.max(-SKEW_MAX, Math.min(SKEW_MAX, velocity * 0.12)); // velocity = px ต่อ 16 ms

export function initScrollSkew() {
  const visible = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) visible.add(e.target);
      else { visible.delete(e.target); e.target.style.transform = ''; }
    }
  });
  const watched = new WeakSet();
  const watch = () => {
    for (const g of document.querySelectorAll('main .grid:not(.bento-home)')) if (!watched.has(g)) { watched.add(g); io.observe(g); }
  };
  watch();
  new MutationObserver(watch).observe(document.querySelector('main') ?? document.body, { childList: true, subtree: true });

  let lastY = scrollY;
  let lastT = performance.now();
  let skew = 0;
  let frame = 0;
  const loop = (now) => {
    // lastY คือตำแหน่งก่อนเริ่มเลื่อน (ไม่อัปเดตตอนรับ scroll event — ไม่งั้นการเลื่อนด้วยล้อเมาส์ทีละก้อนจะวัดความเร็วได้ 0)
    const dt = Math.min(50, Math.max(1, now - lastT));
    const v = ((scrollY - lastY) / dt) * 16;
    lastY = scrollY;
    lastT = now;
    skew += (skewFor(v) - skew) * 0.2;
    if (Math.abs(skew) < 0.02 && Math.abs(v) < 0.5) {
      skew = 0;
      for (const g of visible) g.style.transform = '';
      frame = 0;
      return;
    }
    for (const g of visible) g.style.transform = `skewY(${skew.toFixed(2)}deg)`;
    frame = requestAnimationFrame(loop);
  };
  addEventListener('scroll', () => {
    if (frame) return;
    lastT = performance.now() - 16;
    frame = requestAnimationFrame(loop);
  }, { passive: true });
}
