// ภาพตัวอย่างเกม (screenshot) สร้างอัตโนมัติสำหรับข้อมูลตัวอย่าง: ฉากตามแนวเกม 16:9 + HUD ของแนวเกมนั้น
// (หลอด HP / มินิแมป / มาตรวัดความเร็ว / สกอร์บอร์ด ฯลฯ) ให้ดูเป็นภาพในเกม ไม่ใช่ภาพปก
// ข้อความใน HUD ใช้ตัวอักษรอังกฤษ/ตัวเลขเท่านั้น — เครื่องเซิร์ฟเวอร์ที่แปลง SVG เป็นรูปอาจไม่มีฟอนต์ไทย
import { sceneSvg } from './coverArt.js';

const W = 1280;
const H = 720;
const FONT = 'font-family="Segoe UI,Tahoma,Arial,sans-serif"';
const panel = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#000" fill-opacity=".45" stroke="#fff" stroke-opacity=".15"/>`;
const text = (x, y, s, size = 22, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" font-weight="700" ${/\bfill=/.test(extra) ? '' : 'fill="#fff"'} ${FONT} ${extra}>${s}</text>`;
const bar = (x, y, w, pct, color) => `<rect x="${x}" y="${y}" width="${w}" height="12" rx="6" fill="#000" fill-opacity=".5"/><rect x="${x}" y="${y}" width="${Math.round(w * pct)}" height="12" rx="6" fill="${color}"/>`;
const minimap = (n, y = 24) => `${panel(1080, y, 176, 176)}<circle cx="1168" cy="${y + 88}" r="70" fill="#fff" fill-opacity=".08" stroke="#fff" stroke-opacity=".3"/>
  <path d="M1168 ${y + 74} l10 24 l-10 -6 l-10 6 Z" fill="#ffd200"/>${[0, 1, 2].map((i) => `<circle cx="${1120 + ((n * 37 + i * 53) % 90)}" cy="${y + 46 + ((n * 23 + i * 41) % 90)}" r="5" fill="#ff4d6d"/>`).join('')}`;
const hotbar = (n) => `${panel(470, 632, 340, 64)}${[0, 1, 2, 3, 4].map((i) => `<rect x="${482 + i * 66}" y="${642}" width="54" height="44" rx="8" fill="#fff" fill-opacity="${i === n % 5 ? 0.35 : 0.1}" stroke="#fff" stroke-opacity=".3"/>${text(487 + i * 66, 660, String(i + 1), 13)}`).join('')}`;
const vitals = (n) => `${panel(24, 24, 300, 92)}${text(40, 56, 'HP', 18)}${bar(80, 44, 220, 0.55 + (n % 4) * 0.1, '#ff4d6d')}${text(40, 92, 'MP', 18)}${bar(80, 80, 220, 0.35 + (n % 3) * 0.2, '#56ccf2')}`;

const HUD = {
  RPG: (n) => `${vitals(n)}${minimap(n)}${hotbar(n)}${panel(24, 560, 360, 64)}${text(44, 600, `Quest: The Dragon's Lair  ${n + 1}/3`, 20)}`,
  'ผจญภัย': (n) => `${vitals(n)}${minimap(n)}${panel(24, 620, 300, 64)}${text(44, 660, `Area ${n + 2}  ·  Relics ${4 + n}/12`, 20)}`,
  'แอ็กชัน': (n) => `${vitals(n)}${minimap(n)}${panel(1040, 600, 216, 96)}${text(1060, 640, `${24 - n * 5} / 120`, 30)}${text(1060, 674, 'AMMO', 16, 'fill-opacity=".7"')}
    ${text(560, 120, `COMBO x${8 + n * 3}`, 44, 'fill="#ffd200" text-anchor="middle"')}`,
  'แข่งรถ': (n) => `${panel(24, 24, 200, 110)}${text(44, 78, `${n + 1}`, 56)}${text(84, 78, `/ 8`, 28)}${text(44, 116, `LAP ${n + 1}/3`, 20)}
    ${panel(1056, 520, 200, 176)}<circle cx="1156" cy="620" r="70" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="10"/>
    <path d="M1156 620 L${1156 + Math.round(60 * Math.cos(Math.PI * (0.9 + n * 0.25)))} ${620 + Math.round(60 * Math.sin(Math.PI * (0.9 + n * 0.25)))}" stroke="#ff5a1f" stroke-width="6" stroke-linecap="round"/>
    ${text(1156, 680, `${180 + n * 37} km/h`, 22, 'text-anchor="middle"')}${minimap(n)}`,
  'กีฬา': (n) => `${panel(440, 20, 400, 64)}${text(470, 62, 'HOME', 22)}${text(640, 64, `${n + 1} - ${n % 2}`, 32, 'text-anchor="middle"')}${text(810, 62, 'AWAY', 22, 'text-anchor="end"')}
    ${panel(1100, 20, 156, 64)}${text(1178, 62, `${54 + n * 11}:${String(12 + n * 7).padStart(2, '0')}`, 26, 'text-anchor="middle"')}`,
  'จำลอง': (n) => `${panel(24, 24, 420, 64)}${text(44, 66, `DAY ${12 + n * 9}  ·  ฿ ${(4280 + n * 1730).toLocaleString('en-US')}`.replace('฿', 'THB'), 24)}
    ${panel(1040, 24, 216, 64)}${text(1060, 66, `${7 + n}:30 AM`, 24)}${hotbar(n)}`,
  'ปริศนา': (n) => `${panel(24, 24, 260, 92)}${text(44, 62, `LEVEL ${14 + n * 6}`, 26)}${text(44, 100, `MOVES ${23 - n * 4}`, 20, 'fill-opacity=".8"')}
    ${panel(1056, 24, 200, 64)}${text(1076, 66, `★ ${(12840 + n * 3120).toLocaleString('en-US')}`, 24, 'fill="#ffd200"')}`,
  'วางแผน': (n) => `${panel(24, 20, 1232, 52)}${text(48, 54, `GOLD ${1200 + n * 450}`, 20, 'fill="#ffd200"')}${text(260, 54, `FOOD ${880 + n * 120}`, 20)}${text(470, 54, `UNITS ${36 + n * 8}/60`, 20)}${text(1232, 54, `TURN ${18 + n * 5}`, 20, 'text-anchor="end"')}
    ${panel(24, 560, 280, 136)}${text(44, 600, 'Commander', 20)}${bar(44, 618, 240, 0.8, '#a3ff5f')}${text(44, 670, 'Orders: Advance', 18, 'fill-opacity=".8"')}${minimap(n, 90)}`,
};

// n = ลำดับภาพ (0, 1, 2 …) — ฉากสุ่มคนละชุดและ HUD ต่างกันเล็กน้อยในแต่ละภาพ
export function screenshotSvg(game, n = 0) {
  const scene = sceneSvg(game, { variant: `#shot${n}`, shade: false })
    .replace('width="800" height="600"', `width="${W}" height="${H}"`);
  const hud = (HUD[game.genre] ?? HUD['แอ็กชัน'])(n);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${scene}
<rect width="${W}" height="${H}" fill="url(#vig)"/><defs><radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient></defs>
${hud}</svg>`;
}
