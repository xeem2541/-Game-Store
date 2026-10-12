// ส่วนประกอบที่หน้าตะกร้า / ยืนยันสั่งซื้อ / คำสั่งซื้อ ใช้ร่วมกัน (UI เฟส 16)
// แถบขั้นตอน, ตัวเลขยอดที่นับขึ้น-ลง, แถบยอดรวมติดล่างจอบนมือถือ, คูปองโค้ดเกม และพลุฉลองหลังจ่ายเงิน
import { t, toast, esc, $ } from './common.js';
import { prefersReducedMotion, flash } from './motion.js';

// แถบขั้นตอน (HTML อยู่ในหน้าแล้ว กันเลย์เอาต์ขยับ) — ขั้นก่อนหน้า = เสร็จแล้ว, ขั้นปัจจุบัน = aria-current
export function setStep(n) {
  document.querySelectorAll('.steps li').forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle('is-done', s < n);
    if (s === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
}

// นับตัวเลขจาก from → to ในข้อความของ el (format แปลงสตางค์เป็นข้อความ) — ขอลดการเคลื่อนไหว = แสดงค่าสุดท้ายทันที
export function countUp(el, from, to, format, ms = 600) {
  if (!el || from === to || prefersReducedMotion()) { if (el) el.textContent = format(to); return; }
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - p) ** 3;
    el.textContent = format(Math.round(from + (to - from) * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// มือถือ: แถบยอดรวม + ปุ่มหลักติดล่างจอ ซ่อนเองเมื่อกล่องสรุปจริงเลื่อนเข้ามาในจอ (ไม่มีปุ่มซ้ำให้เห็นพร้อมกัน)
let barObserver;
export function summaryBar(view, { total, label, href, proxy, disabled }) {
  barObserver?.disconnect();
  const bar = document.createElement('div');
  bar.className = 'sum-bar';
  bar.innerHTML = `<div class="sum-bar-total"><span>${t('cart.total')}</span><strong>${esc(total)}</strong></div>
    ${href
      ? `<a class="btn primary ${disabled ? 'disabled' : ''}" href="${esc(href)}" ${disabled ? 'aria-disabled="true" tabindex="-1"' : ''}>${esc(label)}</a>`
      : `<button class="btn primary" type="button" ${disabled ? 'disabled' : ''}>${esc(label)}</button>`}`;
  if (proxy) bar.querySelector('button').addEventListener('click', () => $(proxy)?.click());
  view.append(bar);
  const side = view.querySelector('.side');
  if (side && 'IntersectionObserver' in window) {
    barObserver = new IntersectionObserver(([e]) => bar.classList.toggle('is-off', e.isIntersecting), { threshold: 0.35 });
    barObserver.observe(side);
  }
  return bar;
}

// ---------- คูปองโค้ดเกม (หน้าคำสั่งซื้อหลังจ่ายเงิน) ----------
// โค้ดซ่อนไว้เป็นค่าเริ่มต้น (กันคนข้างหลังเห็นจอ) กด "แสดง" เพื่อเปิด, "คัดลอก" มีสถานะสำเร็จบนปุ่ม
// สร้างด้วย DOM API + textContent เท่านั้น: โค้ดไม่ผ่าน HTML string / attribute
const MASK = '•••••-•••••-•••••';
const REDEEM = {
  PC: { url: 'https://store.steampowered.com/account/registerkey', key: 'order.redeemSteam' },
  PS5: { url: 'https://store.playstation.com/redeem', key: 'order.redeemPsn' },
  Switch: { url: 'https://ec.nintendo.com/redeem', key: 'order.redeemNintendo' },
};
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

async function copyCode(code, btn) {
  try {
    await navigator.clipboard.writeText(code);
    if (btn) {
      const label = btn.textContent;
      btn.textContent = t('order.copyDone');
      btn.classList.add('is-done');
      clearTimeout(btn._copyTimer);
      btn._copyTimer = setTimeout(() => { btn.textContent = label; btn.classList.remove('is-done'); }, 1600);
    }
    toast(t('order.copied'));
    return true;
  } catch { toast(t('common.error')); return false; }
}

export function renderVouchers(container, keys) {
  container.replaceChildren();
  keys.forEach((k, i) => {
    const v = el('article', 'voucher');
    v.style.setProperty('--i', i);
    const art = el('div', 'voucher-art');
    art.style.backgroundImage = `url("/api/games/${encodeURIComponent(k.slug)}/scene.svg")`;
    art.append(el('span', 'voucher-platform', k.platform));

    const body = el('div', 'voucher-body');
    const brand = el('span', 'voucher-brand');
    brand.append('GAME ', el('b', null, 'STORE'), ' · GAME KEY');
    const title = el('h3', 'voucher-title', k.title);
    const label = el('span', 'voucher-label', t('order.yourCode'));
    const code = el('code', 'key', MASK);
    code.dataset.masked = '1';

    const actions = el('div', 'voucher-actions');
    const show = el('button', 'btn', t('order.show'));
    show.type = 'button';
    show.dataset.act = 'show';
    show.setAttribute('aria-pressed', 'false');
    show.onclick = () => {
      const visible = code.dataset.masked === '1';
      code.textContent = visible ? k.code : MASK;
      code.dataset.masked = visible ? '0' : '1';
      show.textContent = t(visible ? 'order.hide' : 'order.show');
      show.setAttribute('aria-pressed', String(visible));
      if (visible) flash(code, 'is-revealed', 700);
    };
    const copy = el('button', 'btn primary', t('order.copy'));
    copy.type = 'button';
    copy.dataset.act = 'copy';
    copy.onclick = () => copyCode(k.code, copy);
    actions.append(show, copy);

    const store = REDEEM[k.platform];
    if (store) {
      // เปิดหน้าร้านของแพลตฟอร์มในแท็บใหม่ และคัดลอกโค้ดไว้ให้วางได้ทันที (ไม่ใส่โค้ดใน URL)
      const a = el('a', 'btn voucher-redeem', t(store.key));
      a.href = store.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.addEventListener('click', () => { copyCode(k.code); });
      actions.append(a);
    }

    const foot = el('div', 'voucher-foot');
    foot.append(el('span', 'voucher-barcode'), el('span', 'voucher-stamp', t('order.ready')));
    foot.firstChild.setAttribute('aria-hidden', 'true');
    body.append(brand, title, label, code, actions, foot);
    const shine = el('span', 'voucher-shine');
    shine.setAttribute('aria-hidden', 'true');
    v.append(art, body, shine);
    container.append(v);
  });
}

// ---------- พลุฉลอง (canvas ชั้นเดียว ลบทิ้งเมื่อจบ ~2.4 วินาที) — ขอลดการเคลื่อนไหว = ไม่แสดง ----------
export function confetti() {
  if (prefersReducedMotion()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#a3ff5f', '#00e5ff', '#ff4fd8', '#ffd84d', '#7c5cff', '#ffffff'];
  const n = W < 600 ? 90 : 160;
  const parts = Array.from({ length: n }, (_, i) => {
    const fromLeft = i % 2 === 0;
    const angle = (fromLeft ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.9;
    const speed = 9 + Math.random() * 9;
    return {
      x: fromLeft ? -10 : W + 10, y: H * 0.75, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
      c: colors[i % colors.length],
    };
  });
  const start = performance.now();
  const frame = (now) => {
    const life = (now - start) / 2400;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, life - 0.6) / 0.4);
    for (const p of parts) {
      p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
      ctx.restore();
    }
    if (life < 1) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
}
