// ภาพปกอัตโนมัติ (เกมที่แอดมินยังไม่อัปโหลดรูปปก): ฉากตามแนวเกม วาดด้วย SVG จากสีของเกม
// ผลลัพธ์ขึ้นกับ slug เท่านั้น (สุ่มแบบกำหนด seed) — เกมเดิมได้ภาพเดิมทุกครั้ง แคชได้
import { escHtml } from './text.js';

const W = 800;
const H = 600;

function seeded(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const f = (n) => Math.round(n * 10) / 10;
// ภูเขา/เนินเป็นแนว: จุดสุ่มตามแนวนอน แล้วปิดรูปที่ขอบล่าง
function ridge(r, { base, amp, step, fill, opacity = 1 }) {
  let d = `M0 ${H} L0 ${f(base - r() * amp)}`;
  for (let x = step; x <= W + step; x += step) d += ` L${Math.min(x, W)} ${f(base - r() * amp)}`;
  return `<path d="${d} L${W} ${H} Z" fill="${fill}" opacity="${opacity}"/>`;
}
const stars = (r, n, maxY) => Array.from({ length: n }, () => `<circle cx="${f(r() * W)}" cy="${f(r() * maxY)}" r="${f(0.6 + r() * 1.8)}" fill="#fff" opacity="${f(0.3 + r() * 0.6)}"/>`).join('');

// ฉากของแต่ละแนวเกม (ชื่อแนวเกมในฐานข้อมูลเป็นภาษาไทย)
const SCENES = {
  RPG: (r) => `${stars(r, 40, 260)}<circle cx="${f(520 + r() * 160)}" cy="140" r="70" fill="#fff" opacity=".85"/>
    ${ridge(r, { base: 380, amp: 160, step: 80, fill: '#000', opacity: 0.35 })}
    <path d="M300 420 v-120 h30 v-30 h20 v30 h40 v-60 h20 v-30 h20 v30 h20 v60 h40 v-30 h20 v30 h30 v120 Z" fill="#0b0b18" opacity=".8"/>
    ${ridge(r, { base: 500, amp: 70, step: 60, fill: '#000', opacity: 0.55 })}`,
  'แข่งรถ': (r) => `<circle cx="400" cy="250" r="${f(110 + r() * 30)}" fill="#fff" opacity=".18"/>
    <path d="M0 260 H${W}" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>
    <path d="M330 260 L60 ${H} H740 L470 260 Z" fill="#000" opacity=".45"/>
    ${[0, 1, 2, 3, 4].map((i) => { const y = 280 + i * i * 14 + i * 20; const w = 4 + i * 5; return `<rect x="${400 - w / 2}" y="${y}" width="${w}" height="${12 + i * 10}" fill="#fff" opacity=".8"/>`; }).join('')}
    ${Array.from({ length: 10 }, () => { const y = f(60 + r() * 180); return `<path d="M${f(r() * 300)} ${y} h${f(80 + r() * 200)}" stroke="#fff" stroke-opacity=".4" stroke-width="3" stroke-linecap="round"/>`; }).join('')}`,
  'แอ็กชัน': (r) => `<circle cx="${f(420 + r() * 120)}" cy="${f(220 + r() * 60)}" r="190" fill="#fff" opacity=".12"/>
    ${Array.from({ length: 7 }, () => { const x = f(r() * W); const t = f(10 + r() * 30); return `<path d="M${x} -20 L${f(x + 40)} -20 L${f(x - 260)} ${H + 20} L${f(x - 260 - t)} ${H + 20} Z" fill="#fff" opacity="${f(0.06 + r() * 0.12)}"/>`; }).join('')}
    <path d="M0 ${H} L0 430 L180 380 L260 420 L420 340 L560 400 L800 330 L${W} ${H} Z" fill="#000" opacity=".5"/>`,
  'จำลอง': (r) => `<circle cx="${f(560 + r() * 120)}" cy="130" r="60" fill="#fff6c8" opacity=".9"/>
    ${[0, 1, 2].map(() => { const x = f(r() * 600); const y = f(60 + r() * 120); return `<g fill="#fff" opacity=".7"><ellipse cx="${x}" cy="${y}" rx="60" ry="22"/><ellipse cx="${f(x + 40)}" cy="${f(y - 14)}" rx="40" ry="22"/></g>`; }).join('')}
    <path d="M0 400 Q200 330 400 390 T800 370 V${H} H0 Z" fill="#000" opacity=".25"/>
    <path d="M0 470 Q250 410 520 460 T800 440 V${H} H0 Z" fill="#000" opacity=".4"/>
    <g transform="translate(${f(140 + r() * 380)} 360)" opacity=".85"><path d="M0 60 V20 L40 -10 L80 20 V60 Z" fill="#fff"/><rect x="30" y="32" width="20" height="28" fill="#000" opacity=".5"/></g>`,
  'ผจญภัย': (r) => `${stars(r, 20, 200)}
    <g transform="translate(${f(380 + r() * 200)} ${f(140 + r() * 60)})" opacity=".85"><path d="M-110 0 H110 L50 70 L0 120 L-60 60 Z" fill="#000" opacity=".45"/><ellipse cx="0" cy="0" rx="112" ry="16" fill="#fff" opacity=".5"/></g>
    ${Array.from({ length: 5 }, () => { const x = f(100 + r() * 400); const y = f(80 + r() * 140); return `<path d="M${x} ${y} q8 -8 16 0 q8 -8 16 0" stroke="#fff" stroke-width="2.5" fill="none" opacity=".7"/>`; }).join('')}
    ${ridge(r, { base: 450, amp: 110, step: 100, fill: '#000', opacity: 0.35 })}${ridge(r, { base: 520, amp: 60, step: 70, fill: '#000', opacity: 0.5 })}`,
  'ปริศนา': (r) => Array.from({ length: 6 }, (_, row) => Array.from({ length: 8 }, (_, col) => {
    const on = r() < 0.18;
    return `<rect x="${col * 100 + 14}" y="${row * 100 + 14}" width="72" height="72" rx="10" fill="#fff" opacity="${on ? 0.55 : f(0.05 + r() * 0.1)}" transform="rotate(${f((r() - 0.5) * 8)} ${col * 100 + 50} ${row * 100 + 50})"/>`;
  }).join('')).join(''),
  'วางแผน': (r) => {
    const hex = (cx, cy, o) => `<path d="M${cx - 40} ${cy} l20 -34 h40 l20 34 l-20 34 h-40 Z" fill="#fff" fill-opacity="${o}" stroke="#fff" stroke-opacity=".25"/>`;
    let g = '';
    for (let y = 0; y < 9; y += 1) for (let x = 0; x < 14; x += 1) g += hex(x * 60, y * 68 + (x % 2) * 34, r() < 0.12 ? 0.35 : 0.04);
    return `${g}<g transform="translate(${f(260 + r() * 280)} 170)"><path d="M0 0 V160" stroke="#fff" stroke-width="5"/><path d="M0 0 L80 22 L0 44 Z" fill="#fff" opacity=".85"/></g>`;
  },
  'กีฬา': (r) => `<ellipse cx="400" cy="640" rx="560" ry="300" fill="#000" opacity=".25"/>
    <path d="M0 220 Q400 120 800 220" stroke="#fff" stroke-opacity=".25" stroke-width="18" fill="none"/>
    ${Array.from({ length: 30 }, () => `<circle cx="${f(r() * W)}" cy="${f(150 + r() * 70)}" r="3" fill="#fff" opacity=".5"/>`).join('')}
    <path d="M0 420 H800 M400 330 V${H}" stroke="#fff" stroke-opacity=".45" stroke-width="4"/>
    <circle cx="400" cy="420" r="70" stroke="#fff" stroke-opacity=".45" stroke-width="4" fill="none"/>
    <circle cx="${f(250 + r() * 300)}" cy="300" r="34" fill="#fff" opacity=".9"/>`,
};

// ชื่อเกม: ตัดเป็น 1–2 บรรทัด ขนาดตัวอักษรตามความยาว (ภาพย่อในการ์ดยังอ่านออก)
function titleSvg(title) {
  const words = title.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 14 && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  lines.push(cur);
  const size = lines.some((l) => l.length > 11) ? 64 : 76;
  const y0 = H - 56 - (lines.length - 1) * size * 1.05;
  return lines.map((l, i) => `<text x="48" y="${f(y0 + i * size * 1.05)}" font-size="${size}" font-weight="800" fill="#fff" font-family="Segoe UI,Tahoma,Arial,sans-serif" letter-spacing="-1" filter="url(#ts)">${escHtml(l)}</text>`).join('');
}

// ฉากอย่างเดียว (ไม่มีชื่อเกม) ขนาด 800×600 — variant: สุ่มตำแหน่งชุดอื่นจากเกมเดิม (ใช้ทำภาพตัวอย่างหลายภาพ / ภาพแชร์)
export function sceneSvg({ slug, genre, color1, color2 }, { variant = '', shade = true } = {}) {
  const r = seeded(slug + variant);
  const scene = (SCENES[genre] ?? SCENES['แอ็กชัน'])(r);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${escHtml(color1)}"/><stop offset="1" stop-color="${escHtml(color2)}"/></linearGradient>
  <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".65"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>${scene}${shade ? `<rect width="${W}" height="${H}" fill="url(#shade)"/>` : ''}
</svg>`;
}

export function coverSvg(g) {
  // ฉาก + ชื่อเกม: ใส่ชื่อก่อนปิด </svg> ของฉาก
  return sceneSvg(g).replace(/<\/svg>$/, `<defs><filter id="ts" x="-5%" y="-20%" width="110%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-opacity=".55"/></filter></defs>${titleSvg(g.title)}\n</svg>`);
}
