import { $, $$, api, errorState, esc, hasPerm, loading, state, toast } from './core.js';
import * as dashboard from './dashboard.js';
import * as games from './games.js';
import * as stock from './stock.js';
import * as orders from './orders.js';
import * as users from './users.js';
import * as coupons from './coupons.js';
import * as reviews from './reviews.js';
import * as reports from './reports.js';
import * as audit from './audit.js';
import { renderSetup as renderMfaSetup } from './mfa.js';

// เมนู: roles = บทบาทที่เห็นเมนูนี้ (staff ไม่เห็น ผู้ใช้ / คูปอง / Audit log) — เซิร์ฟเวอร์ตรวจสิทธิ์ซ้ำทุก endpoint อยู่แล้ว
const ROUTES = [
  { key: 'dashboard', label: '📊 Dashboard', roles: ['staff', 'admin'], mod: dashboard },
  { key: 'games', label: '🎮 เกม', roles: ['staff', 'admin'], mod: games },
  { key: 'stock', label: '🔑 สต็อกโค้ด', roles: ['staff', 'admin'], mod: stock },
  { key: 'orders', label: '🧾 ออเดอร์', roles: ['staff', 'admin'], mod: orders },
  { key: 'users', label: '👥 ผู้ใช้', roles: ['admin'], mod: users },
  { key: 'coupons', label: '🏷️ คูปอง', roles: ['staff', 'admin'], perm: 'coupons.manage', mod: coupons },
  { key: 'reviews', label: '⭐ รีวิว', roles: ['staff', 'admin'], mod: reviews },
  { key: 'reports', label: '📁 รายงาน', roles: ['staff', 'admin'], mod: reports },
  { key: 'audit', label: '📜 Audit log', roles: ['admin'], mod: audit },
];

const view = $('#view');

// เมนูบนจอเล็ก (drawer): ปุ่มบอกสถานะเปิด/ปิด, กดพื้นหลังหรือ Esc เพื่อปิด แล้วคืนโฟกัสให้ปุ่มเมนู
function setMenu(open) {
  const sb = $('#sidebar');
  if (sb.classList.contains('open') === open) return;
  sb.classList.toggle('open', open);
  $('#menuBtn').setAttribute('aria-expanded', String(open));
  $('#menuBtn').setAttribute('aria-label', open ? 'ปิดเมนู' : 'เปิดเมนู');
  if (open) $('#nav a')?.focus();
  else if (sb.contains(document.activeElement)) $('#menuBtn').focus();
}
let token = 0; // กันผลลัพธ์ของหน้าเก่ามาเขียนทับหน้าใหม่ที่เปิดทีหลัง

async function route() {
  const [path] = location.hash.replace(/^#\/?/, '').split('?');
  const [key, ...rest] = path.split('/');
  const r = ROUTES.find((x) => x.key === (key || 'dashboard'));
  $$('#nav a').forEach((a) => {
    const on = a.dataset.key === r?.key;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  setMenu(false);
  if (!r || !r.roles.includes(state.me.role) || (r.perm && !hasPerm(r.perm))) {
    view.innerHTML = '<div class="state error">ไม่พบหน้านี้ หรือคุณไม่มีสิทธิ์เข้าถึง</div>';
    return;
  }
  const mine = ++token;
  loading(view);
  try {
    await r.mod.render(view, rest, () => mine === token);
  } catch (e) {
    if (mine === token) errorState(view, e);
  }
}

const whoHtml = () => `<strong>${esc(state.me.name)}</strong><div>${esc(state.me.email)}</div>
    <div><span class="badge ${esc(state.me.role)}">${state.me.role === 'admin' ? 'admin' : 'staff'}</span></div>
    <p><a href="/" target="_blank" rel="noopener">เปิดหน้าร้าน ↗</a></p><button class="btn sm" id="logout" type="button">ออกจากระบบ</button>`;
const bindLogout = () => { $('#logout').onclick = async () => { await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {}); location.href = '/admin/login'; }; };

async function start() {
  let me;
  try {
    me = await api('/auth/me');
    state.me = me.user;
    state.perms = me.permissions ?? [];
  } catch { return; } // 401 → api() พาไปหน้า login แล้ว
  if (me.mfa?.setupRequired) { // ต้องตั้ง 2FA ก่อนใช้หลังบ้าน (เซิร์ฟเวอร์ปฏิเสธ API อื่นอยู่แล้ว — หน้านี้แค่พาไปตั้งค่า)
    $('#who').innerHTML = whoHtml();
    bindLogout();
    renderMfaSetup(view);
    return;
  }
  let warn = null;
  try { warn = sessionStorage.getItem('mfaWarn'); sessionStorage.removeItem('mfaWarn'); } catch { /* ไม่สำคัญ */ }
  const left = me.mfa?.enabled ? me.mfa.recoveryCodesLeft : null;
  if (warn !== null || (left !== null && left <= 2)) {
    toast(`เหลือรหัสกู้คืน 2FA ${left ?? warn} รหัส — ให้ admin ล้าง 2FA แล้วตั้งใหม่เพื่อรับรหัสชุดใหม่`, true);
  }
  $('#nav').innerHTML = ROUTES.filter((r) => r.roles.includes(state.me.role) && (!r.perm || hasPerm(r.perm))).map((r) => `<a href="#/${r.key}" data-key="${r.key}">${r.label}</a>`).join('');
  $('#who').innerHTML = whoHtml();
  bindLogout();
  $('#menuBtn').onclick = () => setMenu(!$('#sidebar').classList.contains('open'));
  $('#navScrim').onclick = () => setMenu(false);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/dashboard'; else route();
}

window.addEventListener('unhandledrejection', (e) => { if (e.reason?.message) toast(e.reason.message, true); });
start();
