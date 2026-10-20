// เอฟเฟกต์เสริม (UI เฟส 24): Spotlight บนการ์ดเกม, ปุ่มแม่เหล็ก, ตัวเลขนับขึ้น — ทุกหน้าร้านโหลดผ่าน common.js
// - ขอลดการเคลื่อนไหว → ไม่ทำอะไรเลย (ตัวเลขเป็นค่าจริงตั้งแต่แรก การ์ด/ปุ่มอยู่นิ่ง)
// - spotlight และแม่เหล็กเฉพาะอุปกรณ์ที่มีเมาส์ (hover: hover) — จอสัมผัสไม่มี "เคอร์เซอร์" ให้ตาม
// - ตั้งค่าผ่าน CSSOM (style.setProperty) เท่านั้น: CSP ไม่อนุญาต style แบบ inline ใน HTML
// - คำนวณไม่เกินเฟรมละครั้ง ขยับด้วย transform/translate (ไม่กระทบ layout)
import { prefersReducedMotion } from './motion.js';
import { initAmbientHover, initCursor, initScrollSkew } from './cursor-fx.js';
import { initScramble } from './scramble.js';
import { initCardPreview } from './card-preview.js';

const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

// เรียก cb เมื่อมี element ใหม่ถูกเพิ่มเข้าหน้า (การ์ด/ปุ่มที่ JS สร้างทีหลัง) — รวมการเปลี่ยนแปลงทั้งเฟรมเป็นครั้งเดียว
function onDomAdded(cb) {
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; cb(); });
  }).observe(document.body, { childList: true, subtree: true });
}

// ---------- Spotlight: วงแสงตามเคอร์เซอร์บนการ์ดเกม (CSS วาดด้วย radial-gradient ที่ --x/--y ใน effects.css) ----------
function initSpotlight() {
  let frame = 0;
  let last = null;
  const apply = () => {
    frame = 0;
    const card = last?.target?.closest?.('.grid .card:not(.sk)');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--x', `${Math.round(last.clientX - r.left)}px`);
    card.style.setProperty('--y', `${Math.round(last.clientY - r.top)}px`);
  };
  document.addEventListener('pointermove', (e) => { last = e; frame ||= requestAnimationFrame(apply); }, { passive: true });
}

// ---------- Magnetic: ปุ่มหลักขนาดใหญ่ขยับเข้าหาเมาส์เล็กน้อยเมื่อเข้าใกล้ (ไม่เกิน MAG_MAX px) ----------
// ใช้คุณสมบัติ CSS `translate` แยกจาก `transform` → ไม่ชนกับการกดยุบ (:active) และแอนิเมชันตอนโหลดของ GSAP
export const MAGNET_SEL = '.btn.primary.big:not(:disabled):not([aria-disabled="true"])';
export const MAG_MAX = 8; // px
const MAG_REACH = 56; // ระยะรอบปุ่มที่เริ่มดูด (px)

// ระยะที่ปุ่มควรขยับ เมื่อเมาส์อยู่ห่างจากกึ่งกลางปุ่ม (dx, dy) — คืน null เมื่ออยู่นอกระยะดูด
export function magnetOffset(dx, dy, w, h, max = MAG_MAX, reach = MAG_REACH) {
  if (Math.abs(dx) > w / 2 + reach || Math.abs(dy) > h / 2 + reach) return null;
  const clamp = (v) => Math.max(-max, Math.min(max, v));
  return { x: clamp(dx * 0.2), y: clamp(dy * 0.3) };
}

function initMagnetic() {
  // ปุ่มทั้งหมดที่ตรงเงื่อนไข (หน้าหนึ่งมีไม่กี่ปุ่ม) — ตรวจตำแหน่งตอนเมาส์ขยับเลย ไม่รอ IntersectionObserver
  // (ซึ่งแจ้งแบบ async: เมาส์ที่ขยับทันทีหลังหน้าโหลดจะถูกมองข้าม)
  const buttons = new Set();
  const watch = () => {
    for (const el of buttons) if (!el.isConnected) buttons.delete(el);
    for (const el of document.querySelectorAll(MAGNET_SEL)) buttons.add(el);
  };
  watch();
  onDomAdded(watch);

  let frame = 0;
  let pt = null;
  const apply = () => {
    frame = 0;
    for (const btn of buttons) {
      const r = btn.getBoundingClientRect();
      const usable = btn.isConnected && btn.matches(MAGNET_SEL) && r.width > 0 && r.bottom > 0 && r.top < innerHeight;
      const off = usable && pt && magnetOffset(pt.x - (r.left + r.width / 2), pt.y - (r.top + r.height / 2), r.width, r.height);
      btn.classList.toggle('is-magnet', Boolean(off));
      if (off) { btn.style.setProperty('--mag-x', `${off.x.toFixed(1)}px`); btn.style.setProperty('--mag-y', `${off.y.toFixed(1)}px`); }
      else { btn.style.removeProperty('--mag-x'); btn.style.removeProperty('--mag-y'); }
    }
  };
  document.addEventListener('pointermove', (e) => { pt = { x: e.clientX, y: e.clientY }; frame ||= requestAnimationFrame(apply); }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { pt = null; frame ||= requestAnimationFrame(apply); });
}

// ---------- Count-up: ตัวเลขวิ่งจาก 0 ไปค่าจริงเมื่อเลื่อนมาถึง (ครั้งเดียวต่อ element) ----------
// ค่าจริงอยู่ใน DOM ตั้งแต่แรกเสมอ (JS ไม่ทำงาน = เห็นตัวเลขจริง) — แอนิเมชันจบที่ข้อความเดิมทุกตัวอักษร
// ข้อความที่มีตัวเลขถูกห่อด้วย span ตัวเลขกว้างเท่ากัน (tabular-nums) และเติมช่องว่างกว้างเท่าตัวเลขให้ยาวเท่าค่าจริง → ข้อความรอบ ๆ แทบไม่ขยับ
export const COUNT_SEL = '.grid .card .price, .tile-deal .deal-pct, .tile-deal .price, .gt-count, .stat-val, .big-price .price, .big-price .save';
const COUNT_MS = 900;
const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;

// ข้อความของตัวเลข value ในรูปแบบเดียวกับ template (จำนวนทศนิยม, มี/ไม่มีจุลภาคคั่นหลักพัน)
export function formatLike(template, value) {
  const decimals = (template.split('.')[1] ?? '').length;
  const s = value.toFixed(decimals);
  if (!template.includes(',')) return s;
  const [int, frac] = s.split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : '');
}

// ห่อข้อความที่มีตัวเลขทั้งก้อน (รวม "฿" / "%" ที่ติดกัน) ด้วย span.cu-num เดียว — คืนรายการ { span, text }
// ห่อเฉพาะตัวเลขไม่ได้: .price เป็น flex → "฿" กับตัวเลขกลายเป็นคนละ flex item มีช่องว่างคั่น และขึ้นคนละบรรทัดได้ในการ์ดแคบ
function wrapNumbers(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (/\d/.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
  return nodes.map((node) => {
    const span = document.createElement('span');
    span.className = 'cu-num';
    span.textContent = node.nodeValue;
    node.replaceWith(span);
    return { span, text: span.textContent };
  });
}

// ข้อความระหว่างนับ: ตัวเลขทุกก้อนเป็น ค่าจริง × eased ในรูปแบบเดิม เติมช่องว่างกว้างเท่าตัวเลข (U+2007) ให้ยาวเท่าค่าจริง
// (ตัวเลขกว้างคงที่ด้วย tabular-nums ข้อความรอบ ๆ จึงแทบไม่ขยับ)
const toNum = (m) => Number(m.replace(/,/g, ''));
const frameText = (text, eased) => text.replace(NUM_RE, (m) => formatLike(m, toNum(m) * eased).padStart(m.length, '\u2007'));

function runCountUp(el) {
  const items = wrapNumbers(el).filter((n) => [...n.text.matchAll(NUM_RE)].some((m) => toNum(m[0]) > 0));
  if (!items.length) return;
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / COUNT_MS);
    const eased = 1 - (1 - p) ** 3;
    // แก้ข้อความใน text node เดิม (ไม่สร้าง node ใหม่ทุกเฟรม → ไม่ปลุก MutationObserver ที่เฝ้า childList)
    for (const n of items) n.span.firstChild.nodeValue = p < 1 ? frameText(n.text, eased) : n.text;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function initCountUp() {
  const seen = new WeakSet();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      if (!prefersReducedMotion()) runCountUp(e.target);
    }
  }, { threshold: 0.6 });
  const watch = () => {
    for (const el of document.querySelectorAll(COUNT_SEL)) if (!seen.has(el)) { seen.add(el); io.observe(el); }
  };
  watch();
  onDomAdded(watch);
}

export function initFx() {
  initAmbientHover(); // สีพื้นหลังตามเกม — ไม่ใช่การเคลื่อนไหว ทำงานเสมอ (รวมโฟกัสด้วยคีย์บอร์ด)
  if (prefersReducedMotion()) return;
  initCountUp();
  initScramble();
  if (finePointer()) { initSpotlight(); initMagnetic(); initCursor(); initScrollSkew(); initCardPreview(); }
}
