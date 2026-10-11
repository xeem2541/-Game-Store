// ค้นหาเกมด้วย SQLite FTS5 (tokenizer แบบ trigram)
// - trigram จับข้อความย่อยได้ทุกภาษา รวมภาษาไทยที่ไม่มีช่องว่างระหว่างคำ (unicode61 ตัดคำไทยไม่ได้ — ทั้งประโยคกลายเป็นคำเดียว)
// - remove_diacritics: "cafe" เจอ "Café" แต่ไม่ตัดสระ/วรรณยุกต์ไทย ("มงกร" ไม่เจอ "มังกร")
// - คำที่สั้นกว่า 3 ตัวอักษร trigram หาไม่ได้ → ใช้ LIKE แทนเฉพาะคำนั้น
import fs from 'node:fs';
import { likeArg } from './text.js';

const MAX_TERMS = 8;
// น้ำหนักคอลัมน์ของ bm25 (ลำดับเดียวกับ games_fts ใน views.sql): ชื่อเกมสำคัญที่สุด รองลงมาแนวเกม/แพลตฟอร์ม แล้วจึงคำอธิบาย
export const BM25_WEIGHTS = '10.0, 1.0, 1.0, 4.0, 4.0';

// แยกคำค้นตามช่องว่าง → คำยาว (≥ 3 ตัวอักษร) ใช้ FTS, คำสั้นใช้ LIKE
export function parseQuery(q) {
  const terms = String(q ?? '').normalize('NFC').trim().split(/\s+/).filter(Boolean).slice(0, MAX_TERMS);
  const long = terms.filter((t) => [...t].length >= 3);
  const short = terms.filter((t) => [...t].length < 3);
  return { terms, long, short };
}

// แนวเกมในฐานข้อมูลเป็นภาษาไทย → ผู้ใช้ภาษาอังกฤษพิมพ์ "action" / "sim" ให้เจอ "แอ็กชัน" / "จำลอง" ด้วย
// ใช้ชื่ออังกฤษจากไฟล์แปลของหน้าเว็บ (genre.<ชื่อไทย>) ที่เดียวกับที่หน้าเว็บแสดง
const GENRES_EN = (() => {
  try {
    const en = JSON.parse(fs.readFileSync(new URL('../../public/i18n/en.json', import.meta.url), 'utf8'));
    return Object.entries(en).filter(([k]) => k.startsWith('genre.')).map(([k, v]) => ({ th: k.slice(6), en: v.toLowerCase() }));
  } catch { return []; }
})();
const synonyms = (term) => {
  const t = term.toLowerCase();
  return GENRES_EN.filter((g) => g.en.startsWith(t)).map((g) => g.th);
};

const phrase = (t) => `"${t.replace(/"/g, '""')}"`;
// ภาษาไทยมักพิมพ์ติดกันเป็นวลี ("เกมยิงซอมบี้") ซึ่งต้องตรงทั้งก้อน → ขั้นผ่อนปรน: แยกเป็นคำด้วย Intl.Segmenter
// ("เกม" "ยิง" "ซอมบี้") แล้วหาเกมที่มีครบทุกคำ (ไม่ต้องติดกัน) — คืน null ถ้าแยกแล้วได้เท่าเดิม
const thaiSeg = new Intl.Segmenter('th', { granularity: 'word' });
export function segmentThai(terms) {
  const out = terms.flatMap((t) => (/[\u0E00-\u0E7F]/.test(t) ? [...thaiSeg.segment(t)].filter((x) => x.isWordLike).map((x) => x.segment) : [t]));
  if (out.length <= terms.length) return null;
  return { terms: out, long: out.filter((t) => [...t].length >= 3), short: out.filter((t) => [...t].length < 3) };
}

// ทุกคำเป็น phrase ในเครื่องหมายคำพูด (ตัวอักษรพิเศษของ FTS เช่น * - : ( ) จึงไม่มีความหมาย)
// คำที่ตรงกับชื่อแนวเกมภาษาอังกฤษ → (คำนั้น OR ชื่อแนวเกมภาษาไทย); any = true: คำใดคำหนึ่งก็ได้
export const ftsMatch = (long, { any = false } = {}) => long.map((t) => {
  const alts = [t, ...synonyms(t)].map(phrase);
  return alts.length > 1 ? `(${alts.join(' OR ')})` : alts[0];
}).join(any ? ' OR ' : ' AND ');

// เงื่อนไข LIKE ของคำสั้น (ชื่อเกม หรือคำอธิบายไทย/อังกฤษ)
export function shortTermSql(short, alias = 'g') {
  const sql = short.map(() => `(${alias}.title LIKE ? ESCAPE '\\' OR ${alias}.description LIKE ? ESCAPE '\\' OR ${alias}.description_en LIKE ? ESCAPE '\\')`);
  const args = short.flatMap((t) => [likeArg(t), likeArg(t), likeArg(t)]);
  return { sql, args };
}
