// ตัวอักษรถอดรหัส (UI เฟส 27): หัวข้อส่วนต่าง ๆ ขึ้นเป็นตัวอักษรสุ่มแบบเกม แล้วถอดรหัสเป็นข้อความจริงทีละตัวเมื่อเลื่อนมาถึง (ครั้งเดียว)
// - ภาษาไทย: สุ่มแทนทีละ "กลุ่มตัวอักษร" (grapheme — พยัญชนะพร้อมสระบน/ล่าง/วรรณยุกต์) สระ/วรรณยุกต์จึงไม่หลุดลอย
// - ระหว่างถอดรหัส หัวข้อมี aria-label เป็นข้อความเต็ม (screen reader อ่านข้อความจริงเสมอ) และกว้างคงที่ ไม่ขึ้นบรรทัดใหม่ (CLS 0)
// - หัวข้อหลายบรรทัดไม่ถอดรหัส (ล็อกความกว้างแล้วจะล้น); fx.js เรียกเฉพาะเมื่อไม่ได้ขอลดการเคลื่อนไหว
const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&@$*+=<>/';
export const SCRAMBLE_MS = 700;
const SEL = 'main h2.sec:not(#howtoTitle) > span:first-child';

const graphemes = (text) => (typeof Intl.Segmenter === 'function'
  ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment)
  : Array.from(text));
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function scramble(el) {
  if (el.children.length) return; // มีลิงก์/ไอคอนข้างใน — ไม่แตะ
  const text = el.textContent;
  const parts = graphemes(text);
  if (parts.length < 2) return;
  const heading = el.parentElement;
  const r = el.getBoundingClientRect();
  const lh = parseFloat(getComputedStyle(el).lineHeight) || r.height;
  if (!r.width || r.height > lh * 1.6) return; // หลายบรรทัด
  heading.setAttribute('aria-label', heading.textContent.trim());
  el.style.width = `${r.width}px`;
  el.classList.add('scrambling');
  const start = performance.now();
  let last = 0;
  const tick = (now) => {
    const p = (now - start) / SCRAMBLE_MS;
    if (p >= 1) {
      el.textContent = text;
      el.classList.remove('scrambling');
      el.style.removeProperty('width');
      heading.removeAttribute('aria-label');
      return;
    }
    if (now - last > 40) { // ~25 ครั้ง/วินาที พอสำหรับเอฟเฟกต์ และไม่สร้าง DOM ทุกเฟรม
      last = now;
      const done = Math.floor(Math.max(0, p - 0.2) / 0.8 * parts.length);
      const rest = parts.slice(done).map((g) => (/\s/.test(g) ? g : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join('');
      el.innerHTML = `${esc(parts.slice(0, done).join(''))}<span class="sc-glyph">${esc(rest)}</span>`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function initScramble() {
  const seen = new WeakSet();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      scramble(e.target);
    }
  }, { threshold: 0.8 });
  const watch = () => {
    for (const el of document.querySelectorAll(SEL)) if (!seen.has(el)) { seen.add(el); io.observe(el); }
  };
  // รอไฟล์แปลใส่ข้อความเสร็จก่อน (ไม่งั้นถอดรหัสข้อความภาษาเดิมแล้วถูกแทนกลางทาง)
  requestAnimationFrame(watch);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; watch(); });
  }).observe(document.body, { childList: true, subtree: true });
}
