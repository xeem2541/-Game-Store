// ใช้: npm run check:env   — ตรวจ .env ว่าพร้อมสำหรับ production หรือไม่ (ใช้กฎชุดเดียวกับที่เซิร์ฟเวอร์ใช้ตอนสตาร์ท)
import 'dotenv/config';
import { checkProductionEnv } from '../envcheck.js';

const { errors, warnings } = checkProductionEnv(process.env);
for (const w of warnings) console.log(`⚠️  ${w}`);
for (const e of errors) console.log(`✖  ${e}`);
if (errors.length) {
  console.log(`\nไม่ผ่าน: ${errors.length} ข้อ — NODE_ENV=production จะไม่ยอมสตาร์ท`);
  process.exit(1);
}
console.log(`\n✓ ผ่านการตรวจค่าความลับ/ตั้งค่าหลักสำหรับ production${warnings.length ? ` (มีคำเตือน ${warnings.length} ข้อ)` : ''}`);
