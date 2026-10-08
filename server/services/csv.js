// CSV: ป้องกัน CSV/formula injection และใส่ BOM ให้ Excel เปิดภาษาไทยได้ถูกต้อง
const DANGEROUS = /^[=+\-@\t\r]/;

export function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (DANGEROUS.test(s)) s = `'${s}`; // ข้อความที่ขึ้นต้นด้วย = + - @ จะไม่ถูกตีเป็นสูตร
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (header, rows) => '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function sendCsv(res, filename, header, rows) {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
  res.send(toCsv(header, rows));
}

// สตางค์ → บาท (ทศนิยม 2 ตำแหน่ง) สำหรับคอลัมน์เงินใน CSV (ส่งเป็นตัวเลข ไม่ใช่ข้อความ)
export const baht = (satang) => Math.round(satang) / 100;

// ---------- นำเข้าโค้ดเกมจาก CSV ----------
export const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$/;
export const MAX_KEY_ROWS = 5000;

// รูปแบบ: หนึ่งโค้ดต่อบรรทัด (คอลัมน์แรก) บรรทัดหัว "code" ไม่บังคับ, ครอบด้วย " ได้
export function parseKeyCsv(text) {
  const valid = [];
  const invalid = [];
  const seen = new Set();
  let duplicatesInFile = 0;
  let rows = 0;
  let first = true;
  text.replace(/^﻿/, '').split(/\r?\n/).forEach((raw, i) => {
    const v = raw.split(',')[0].trim().replace(/^"(.*)"$/, '$1').trim();
    if (!v) return;
    if (first) { first = false; if (v.toLowerCase() === 'code') return; } // หัวตาราง ไม่นับเป็นข้อมูล
    rows += 1;
    if (!KEY_PATTERN.test(v)) { invalid.push({ line: i + 1, reason: 'รูปแบบไม่ถูกต้อง (ใช้ A-Z a-z 0-9 - _ ยาว 4-64 ตัว)' }); return; }
    if (seen.has(v)) { duplicatesInFile += 1; return; }
    seen.add(v);
    valid.push(v);
  });
  return { valid, invalid, duplicatesInFile, rows };
}
