// Kinetic typography: แยกหัวข้อเป็นคำ ๆ ให้แต่ละคำขยับได้ โดยไม่ทำให้ภาษาไทยแตก
// - ใช้ Intl.Segmenter ตัดตามคำ (ภาษาไทยไม่มีช่องว่างระหว่างคำ) — ไม่ตัดเป็นตัวอักษร เพราะสระ/วรรณยุกต์จะหลุดจากพยัญชนะ
// - screen reader อ่านข้อความเต็มจาก span ที่ซ่อนด้วยสายตา ส่วนคำที่แยกแล้วเป็น aria-hidden (ไม่อ่านทีละคำซ้ำ)
// - เบราว์เซอร์ที่ไม่มี Intl.Segmenter: ตัดตามช่องว่างแทน (คำไทยติดกันจะเป็นก้อนเดียว ไม่แตก)

const segmenters = new Map();
function segmentWords(text, locale) {
  if (typeof Intl.Segmenter !== 'function') return text.split(/(\s+)/).filter(Boolean);
  if (!segmenters.has(locale)) segmenters.set(locale, new Intl.Segmenter(locale, { granularity: 'word' }));
  return Array.from(segmenters.get(locale).segment(text), (s) => s.segment);
}

// แยกข้อความใน el เป็น <span class="kt-word"> คืนรายการคำที่แยกได้ (ไม่รวมช่องว่าง)
// คำหลังช่องว่างสุดท้ายได้ class kt-accent (เช่น "ราคาโดนใจ" ใน "เกมแท้ ราคาโดนใจ") ไว้เน้นสี
export function splitWords(el, { locale = document.documentElement.lang || 'th' } = {}) {
  const text = el.textContent.trim();
  if (!text || el.dataset.split) return [];
  const parts = segmentWords(text, locale);
  const lastSpace = parts.findLastIndex((p) => /^\s+$/.test(p));

  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = text;
  const visual = document.createElement('span');
  visual.className = 'kt';
  visual.setAttribute('aria-hidden', 'true');

  const words = [];
  parts.forEach((part, i) => {
    if (/^\s+$/.test(part)) { visual.append(' '); return; } // ช่องว่างเป็นจุดขึ้นบรรทัดใหม่ได้ตามปกติ
    const w = document.createElement('span');
    w.className = 'kt-word' + (lastSpace > 0 && i > lastSpace ? ' kt-accent' : '');
    w.textContent = part;
    visual.append(w);
    words.push(w);
  });
  el.replaceChildren(sr, visual);
  el.dataset.split = '1';
  return words;
}
