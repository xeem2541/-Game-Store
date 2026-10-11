// npm run vendor — สร้างไลบรารีฝั่งหน้าเว็บจาก node_modules เป็นไฟล์ ESM ที่ minify แล้วใน public/js/vendor/
// (หน้าเว็บตอนพัฒนาเสิร์ฟไฟล์ใน public/ ตรง ๆ โดยไม่ bundle จึง import "gsap" / "three" จากเบราว์เซอร์ไม่ได้)
//  • gsap.js  — GSAP core + ScrollTrigger (~45 KB gzip) ใช้ในหน้าที่มีแอนิเมชันตามการเลื่อนเท่านั้น
//  • three.js — เฉพาะคลาสที่ฉาก 3D ใช้ (~135 KB gzip) โหลดแบบ lazy ด้วย import() เมื่อเครื่องรองรับ
// แก้รายการ export ด้านล่างเมื่อโค้ดหน้าเว็บต้องใช้คลาสเพิ่ม แล้วรันใหม่ (ไฟล์ผลลัพธ์ถูก commit ไว้)
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/js/vendor');

const ENTRIES = {
  gsap: `export { gsap } from 'gsap';\nexport { ScrollTrigger } from 'gsap/ScrollTrigger';\n`,
  three: `export {
  Scene, PerspectiveCamera, WebGLRenderer, Clock, Group, Mesh,
  TorusKnotGeometry, IcosahedronGeometry, MeshPhysicalMaterial, MeshBasicMaterial,
  AmbientLight, DirectionalLight,
} from 'three';\n`,
};

for (const [name, contents] of Object.entries(ENTRIES)) {
  await build({
    stdin: { contents, resolveDir: ROOT, sourcefile: `${name}-entry.js` },
    outfile: path.join(OUT, `${name}.js`),
    bundle: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'eof', logLevel: 'warning',
  });
}
console.log('✓ vendor →', path.relative(ROOT, OUT));
