// โค้ดที่ใช้ร่วมกันทุกหน้า: API, ผู้ใช้, ตะกร้า, wishlist, header/footer, การ์ดเกม
import { t, applyI18n, lang, setLang, genreName, errText, descOf } from './i18n.js';
export { t, applyI18n, lang, genreName, descOf };

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// เงินจากเซิร์ฟเวอร์เป็นสตางค์ (จำนวนเต็ม) → แสดงเป็นบาท
export const money = (satang) => '฿' + (satang / 100).toLocaleString(lang === 'th' ? 'th-TH' : 'en-US', { minimumFractionDigits: satang % 100 ? 2 : 0, maximumFractionDigits: 2 });
export const fmtDateTime = (s) => new Date(typeof s === 'number' ? s : s.replace(' ', 'T') + 'Z').toLocaleString(lang === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
// ราคาทุกที่ในระบบเป็น "สตางค์" (จำนวนเต็ม) — แสดงผลเป็นบาท; 0 = ฟรี
export const priceText = (satang) => (satang === 0 ? t('price.free') : money(satang));

const csrfToken = () => document.cookie.split('; ').find((c) => c.startsWith('csrf='))?.slice(5) ?? '';

export async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (method !== 'GET') opts.headers['x-csrf-token'] = csrfToken();
  const r = await fetch('/api' + path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(errText(data.error || r.statusText, data.code, data.params));
    e.status = r.status;
    e.code = data.code;
    throw e;
  }
  return data;
}

export function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.append(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.id);
  toast.id = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- ผู้ใช้ ----------
export const user = (await api('/auth/me').catch(() => ({ user: null }))).user;
export const loginUrl = () => '/login?next=' + encodeURIComponent(location.pathname + location.search);

// ---------- ตะกร้า: ล็อกอินแล้วเก็บในฐานข้อมูล, ยังไม่ล็อกอินเก็บใน localStorage ----------
const slim = (g) => ({ slug: g.slug, title: g.title, platform: g.platform, finalPrice: g.finalPrice, cover: g.cover });
// คีย์ cart2: รูปแบบเก่า (cart) เก็บราคาเป็นบาท จึงไม่นำมาใช้ต่อหลังย้ายเป็นสตางค์
const CART_KEY = 'cart2';
const localCart = {
  get() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; } },
  set(v) { try { localStorage.setItem(CART_KEY, JSON.stringify(v)); } catch {} },
};
let cartItems = user ? (await api('/cart').catch(() => ({ items: [] }))).items.map(slim) : localCart.get();

export const cart = {
  get: () => cartItems,
  save() {
    let done = Promise.resolve();
    if (user) done = api('/cart', { method: 'PUT', body: { slugs: cartItems.map((i) => i.slug) } }).catch(() => toast(t('common.error')));
    else localCart.set(cartItems);
    document.dispatchEvent(new Event('cart:change'));
    return done;
  },
  add(game, e) {
    if (cartItems.some((i) => i.slug === game.slug)) return toast(t('cart.exists'));
    cartItems = [...cartItems, slim(game)];
    this.save();
    if (e) flyToCart(e, game);
    toast(t('cart.added'));
  },
  remove(slug) { cartItems = cartItems.filter((i) => i.slug !== slug); return this.save(); },
  clear() { cartItems = []; this.save(); },
  // โหลดตะกร้าจากเซิร์ฟเวอร์ใหม่ (เช่นหลังชำระเงิน เกมที่ซื้อจะถูกเอาออกจากตะกร้า)
  async refresh() {
    if (!user) return;
    cartItems = (await api('/cart').catch(() => ({ items: cartItems }))).items.map(slim);
    document.dispatchEvent(new Event('cart:change'));
  },
};

// เรียกหลังล็อกอิน/สมัครสำเร็จ: รวมตะกร้าใน localStorage เข้ากับตะกร้าบนเซิร์ฟเวอร์
export async function mergeLocalCart() {
  const local = localCart.get();
  if (local.length) {
    const server = (await api('/cart')).items.map((i) => i.slug);
    const slugs = [...new Set([...server, ...local.map((i) => i.slug)])];
    await api('/cart', { method: 'PUT', body: { slugs } });
  }
  try { localStorage.removeItem(CART_KEY); } catch {}
}

// ---------- รายการโปรด ----------
const wishIds = new Set(user ? (await api('/wishlist').catch(() => ({ items: [] }))).items.map((g) => g.id) : []);

function paintHearts() {
  document.querySelectorAll('[data-wish]').forEach((b) => {
    const on = wishIds.has(+b.dataset.wish);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
    b.setAttribute('aria-label', t(on ? 'wish.remove' : 'wish.add'));
    b.textContent = on ? '♥' : '♡';
  });
}

async function toggleWish(id) {
  if (!user) { location.href = loginUrl(); return; }
  const on = wishIds.has(id);
  on ? wishIds.delete(id) : wishIds.add(id);
  paintHearts();
  try {
    if (on) await api('/wishlist/' + id, { method: 'DELETE' });
    else await api('/wishlist', { method: 'POST', body: { gameId: id } });
  } catch {
    on ? wishIds.add(id) : wishIds.delete(id); // ย้อนกลับถ้าล้มเหลว
    paintHearts();
    toast(t('common.error'));
  }
}

export const heartHtml = (id) => `<button class="heart" data-wish="${id}" type="button"></button>`;
export function renderHearts() { paintHearts(); }

// สรุปราคาที่เซิร์ฟเวอร์คำนวณ (สตางค์)
export function summaryHtml(s) {
  const row = (label, val, cls = '') => `<div class="sum-row ${cls}"><span>${label}</span><strong>${val}</strong></div>`;
  return `<div class="summary">
    ${row(t('summary.subtotal'), money(s.subtotal))}
    ${s.gameDiscount ? row(t('summary.gameDiscount'), '−' + money(s.gameDiscount), 'neg') : ''}
    ${s.couponDiscount ? row(`${t('summary.coupon')} (${esc(s.coupon?.code ?? '')})`, '−' + money(s.couponDiscount), 'neg') : ''}
    ${row(t('cart.total'), money(s.total), 'grand')}
  </div>`;
}

// เกมในตะกร้าที่หยุดขายแล้ว (จาก /cart/summary → unavailable): แจ้งชื่อเกม + ปุ่มนำออก (ใช้ร่วมกันในหน้าตะกร้า/ชำระเงิน)
export const unavailableHtml = (list) => (list?.length
  ? `<div class="banner" role="alert"><span>${t('cartpage.unavailable', { titles: list.map((g) => esc(g.title)).join(', ') })}</span><button class="btn" id="rmUnavailable" type="button">${t('cartpage.removeUnavailable')}</button></div>`
  : '');
// ตะกร้าในหน้าเว็บไม่มีเกมที่หยุดขายอยู่แล้ว → บันทึกตะกร้าปัจจุบันทับ = ลบเกมเหล่านั้นออกจากเซิร์ฟเวอร์
export function bindRemoveUnavailable(rerender) {
  $('#rmUnavailable')?.addEventListener('click', async () => { await cart.save(); await rerender(); });
}

// ---------- การ์ดเกม ----------
export const priceHtml = (g) => (g.discount ? `<span class="old">${priceText(g.price)}</span>${priceText(g.finalPrice)}` : priceText(g.price));

export function cardHtml(g) {
  return `
  <article class="card">
    <a class="cover" href="/game/${esc(g.slug)}">
      <img src="${esc(g.cover)}?size=sm" alt="${esc(g.title)}" loading="lazy" decoding="async" width="400" height="300">
      ${g.discount ? `<span class="badge">-${g.discount}%</span>` : ''}
    </a>
    ${heartHtml(g.id)}
    <div class="info">
      <a class="title" href="/game/${esc(g.slug)}">${esc(g.title)}</a>
      <div class="meta">${esc(genreName(g.genre))} • ${esc(g.platform)} • ⭐ ${g.rating}${g.review_count ? ` (${g.review_count})` : ''}</div>
      <div class="price-row">
        <span class="price">${priceHtml(g)}</span>
        <button class="btn" data-add="${esc(g.slug)}">${t('cart.add')}</button>
      </div>
    </div>
  </article>`;
}

function flyToCart(e, game) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const badge = $('#cartCount');
    badge.style.transition = 'none';
    badge.style.transform = 'scale(1.5)';
    setTimeout(() => {
      badge.style.transition = 'transform var(--dur-2) var(--ease-out)';
      badge.style.transform = '';
    }, 150);
    return;
  }
  const btn = e?.target?.closest('button') || e?.target;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const dest = $('#cartBtn').getBoundingClientRect();
  const fly = document.createElement('img');
  fly.src = game.cover + '?size=sm';
  Object.assign(fly.style, {
    position: 'fixed', left: rect.left + 'px', top: rect.top + 'px',
    width: rect.width + 'px', height: rect.height + 'px',
    objectFit: 'cover', borderRadius: '10px', zIndex: 9999, pointerEvents: 'none',
    transition: 'all 0.6s cubic-bezier(0.2, 1, 0.3, 1)'
  });
  document.body.append(fly);
  requestAnimationFrame(() => {
    fly.style.transform = `translate(${dest.left - rect.left}px, ${dest.top - rect.top}px) scale(0.2) rotate(15deg)`;
    fly.style.opacity = '0';
  });
  setTimeout(() => fly.remove(), 600);
}

// แคชข้อมูลเกมที่แสดงอยู่ เพื่อให้ปุ่มเพิ่มตะกร้าหาข้อมูลเจอ
const known = new Map();
export const remember = (list) => { list.forEach((g) => known.set(g.slug, g)); queueMicrotask(paintHearts); };
document.addEventListener('click', (e) => {
  const slug = e.target.dataset?.add;
  if (slug && known.has(slug)) cart.add(known.get(slug), e);
  const wish = e.target.dataset?.wish;
  if (wish) toggleWish(+wish);
});

// ---------- header / footer / ลิ้นชักตะกร้า ----------
function mountLayout() {
  const authHtml = user
    ? `<details class="usermenu"><summary><svg class="icon"><use href="/icons.svg#icon-user" /></svg> ${esc(user.name)}</summary>
         <div class="menu"><a href="/profile">${t('header.profile')}</a><button id="logoutBtn" type="button">${t('header.logout')}</button></div></details>`
    : `<a class="btn" href="/login">${t('header.login')}</a><a class="btn primary" href="/register">${t('header.register')}</a>`;

  // header/footer มี placeholder อยู่ใน HTML แล้ว (จองที่ว่างกัน layout shift) — เติมเนื้อหาเข้าไป; ถ้าหน้าไหนไม่มีก็สร้างให้
  let header = $('header.topbar');
  if (!header) { header = document.createElement('header'); header.className = 'topbar'; document.body.prepend(header); }
  header.innerHTML = `
    <a class="logo" href="/"><svg class="icon"><use href="/icons.svg#icon-gamepad" /></svg> Game <span>Store</span></a>
    <nav class="nav" aria-label="main"><a href="/games.html">${t('nav.games')}</a><a href="/games.html?onSale=1">${t('nav.promo')}</a></nav>
    <form class="search" action="/games.html" autocomplete="off" role="search">
      <input id="search" name="q" type="search" placeholder="${t('search.placeholder')}" aria-label="${t('search.placeholder')}">
      <ul id="suggest" class="suggest" hidden></ul>
    </form>
    <div class="actions">
      <button id="langBtn" class="icon-btn" type="button" title="${t('header.lang')}" aria-label="${lang === 'th' ? 'EN' : 'TH'} - ${t('header.lang')}">${lang === 'th' ? 'EN' : 'TH'}</button>
      <button id="themeBtn" class="icon-btn" type="button" title="${t('header.theme')}" aria-label="${t('header.theme')}">◐</button>
      ${authHtml}
      <button id="cartBtn" class="cart-btn" type="button"><svg class="icon"><use href="/icons.svg#icon-cart" /></svg> <span class="cart-label">${t('cart.btn')}</span> <span id="cartCount">0</span></button>
    </div>`;
  let footer = $('body > footer');
  if (!footer) { footer = document.createElement('footer'); document.body.append(footer); }
  footer.innerHTML = `<nav class="foot-links" aria-label="legal"><a href="/privacy">${t('footer.privacy')}</a><a href="/terms">${t('footer.terms')}</a><a href="/refund-policy">${t('footer.refund')}</a></nav><div>${t('footer.text')}</div>`;
  document.body.insertAdjacentHTML('beforeend', `
  <div id="cartScrim" class="scrim" hidden></div>
  <aside id="cart" class="cart" hidden aria-label="${t('cart.title')}">
    <div class="cart-head"><h2>${t('cart.title')}</h2><button class="close" id="closeCart" type="button" aria-label="${t('common.close')}">✕</button></div>
    <div id="cartItems" class="cart-items"></div>
    <div class="cart-foot">
      <div class="total">${t('cart.total')} <strong id="cartTotal">฿0</strong></div>
      <button id="checkout" class="btn primary" type="button">${t('cart.viewCart')}</button>
    </div>
  </aside>`);

  const renderCart = () => {
    const items = cart.get();
    $('#cartCount').textContent = items.length;
    $('#cartTotal').textContent = priceText(items.reduce((s, i) => s + i.finalPrice, 0)).replace(t('price.free'), '฿0');
    $('#cartItems').innerHTML = items.length
      ? items.map((i) => `
        <div class="cart-item">
          <img class="thumb" src="${esc(i.cover)}" alt="">
          <div class="t"><a href="/game/${esc(i.slug)}">${esc(i.title)}</a><div class="meta">${esc(i.platform)}</div></div>
          <strong>${priceText(i.finalPrice)}</strong>
          <button class="rm" data-rm="${esc(i.slug)}" type="button" aria-label="${t('cart.remove')}"><svg class="icon"><use href="/icons.svg#icon-trash" /></svg></button>
        </div>`).join('')
      : `<p class="empty">${t('cart.empty')}</p>`;
  };
  document.addEventListener('cart:change', renderCart);
  renderCart();

  let lastFocus;
  // ย้ายโฟกัสเองทุกครั้งที่กด Tab (ไม่พึ่งลำดับ Tab ของเบราว์เซอร์): ช่วงที่ drawer กำลังเลื่อนเข้า Chromium ข้ามปุ่มใน drawer
  // ทำให้โฟกัสหลุดออกไปหน้าเว็บด้านหลังถ้ากด Tab เร็ว ๆ — และถ้าโฟกัสอยู่นอก drawer อยู่แล้ว Tab จะดึงกลับเข้ามา
  const trapFocus = (e) => {
    if (e.key === 'Escape') { closeCart(); return; }
    if (e.key !== 'Tab') return;
    const focusable = [...$('#cart').querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.getClientRects().length);
    if (!focusable.length) return;
    e.preventDefault();
    const i = focusable.indexOf(document.activeElement);
    const n = focusable.length;
    focusable[e.shiftKey ? (i <= 0 ? n - 1 : i - 1) : (i + 1) % n].focus();
  };
  const openCart = () => {
    lastFocus = document.activeElement;
    $('#cart').hidden = false;
    $('#cartScrim').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('#closeCart').focus(), 400);
    document.addEventListener('keydown', trapFocus);
  };
  const closeCart = () => {
    $('#cart').hidden = true;
    $('#cartScrim').hidden = true;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', trapFocus);
    if (lastFocus) lastFocus.focus();
  };

  $('#cartBtn').onclick = openCart;
  $('#closeCart').onclick = closeCart;
  $('#cartScrim').onclick = closeCart;
  $('#cartItems').onclick = (e) => e.target.dataset.rm && cart.remove(e.target.dataset.rm);
  $('#checkout').onclick = () => (cart.get().length ? (location.href = '/cart') : toast(t('cart.empty')));

  $('#langBtn').onclick = () => setLang(lang === 'th' ? 'en' : 'th');
  $('#themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
  };
  $('#logoutBtn')?.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    location.href = '/';
  });

  // autocomplete
  const input = $('#search');
  const box = $('#suggest');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { box.hidden = true; return; }
    timer = setTimeout(async () => {
      const rows = await api('/games/suggest?q=' + encodeURIComponent(q)).catch(() => []);
      box.innerHTML = rows.map((r) => `<li><a href="/game/${esc(r.slug)}">${esc(r.title)} <small>${esc(genreName(r.genre))}</small></a></li>`).join('');
      box.hidden = !rows.length;
    }, 200);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) box.hidden = true; });
}

mountLayout();
applyI18n();

// footer ซ่อนอยู่จนกว่าหน้าจะโหลดข้อมูลเสร็จ (body[data-async]) — ไม่ให้ footer ถูกดันลงมา (layout shift) ตอนเนื้อหาเข้ามา
export const markReady = () => document.body.classList.add('ready');
if (!document.body.hasAttribute('data-async')) markReady();

// Premium 3D subtle tilt for all game cards globally
const mqlTilt = window.matchMedia('(prefers-reduced-motion: reduce)');
if (!mqlTilt.matches) {
  document.addEventListener('mousemove', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rotateX = ((rect.height / 2 - y) / (rect.height / 2)) * 4;
    const rotateY = ((x - rect.width / 2) / (rect.width / 2)) * 4;
    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
    card.style.transition = 'none';
    card.style.zIndex = '10';
  }, { passive: true });
  
  document.addEventListener('mouseout', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    if (card.contains(e.relatedTarget)) return;
    card.style.transform = '';
    card.style.transition = 'all var(--dur-3) var(--ease-out)';
    card.style.zIndex = '';
  }, { passive: true });
}

// Navbar dynamic scroll state
window.addEventListener('scroll', () => {
  const tb = $('.topbar');
  if (tb) tb.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });
