// ตัวช่วยจัดการข้อความที่ใช้ร่วมกันฝั่งเซิร์ฟเวอร์ (เดิมเขียนซ้ำหลายไฟล์)

// escape สำหรับใส่ใน HTML/SVG/XML ทั้งเนื้อหาและค่า attribute
export const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ค้นหาแบบ LIKE ... ESCAPE '\\' โดย escape ตัวอักษรพิเศษของ LIKE (% _ \) — ผู้ใช้พิมพ์ % หรือ _ จะค้นตัวอักษรนั้นจริง ๆ
export const likeArg = (q) => `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// "Dragon Realm: Origins" → "dragon-realm-origins"
export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
