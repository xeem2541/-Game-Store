// โค้ดที่ใช้ร่วมกันทุกหน้า: API, ผู้ใช้, ตะกร้า, wishlist, header/footer, การ์ดเกม
import { t, applyI18n, lang, setLang, genreName, errText, descOf } from './i18n.js';
import { flash, prefersReducedMotion, replay } from './motion.js';
export { t, applyI18n, lang, genreName, descOf };

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// เงินจากเซิร์ฟเวอร์เป็นสตางค์ (จำนวนเต็ม) → แสดงเป็นบาท
// ภาพประกอบสถานะว่าง (ตกแต่งเท่านั้น alt ว่าง) — กำหนดขนาดไว้ จึงไม่ดันเนื้อหาตอนโหลดภาพ
// (ประกาศไว้ต้นไฟล์: mountLayout() ด้านล่างเรียกใช้ตอนโหลดโมดูล)
export const emptyArt = (name) => `<img class="empty-art" src="/img/${name}.svg" alt="" width="240" height="190" decoding="async">`;

export const money = (satang) => '฿' + (satang / 100).toLocaleString(lang === 'th' ? 'th-TH' : 'en-US', { minimumFractionDigits: satang % 100 ? 2 : 0, maximumFractionDigits: 2 });
export const fmtDateTime = (s) => new Date(typeof s === 'number' ? s : s.replace(' ', 'T') + 'Z').toLocaleString(lang === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
// ราคาทุกที่ในระบบเป็น "สตางค์" (จำนวนเต็ม) — แสดงผลเป็นบาท; 0 = ฟรี
export const priceText = (satang) => (satang === 0 ? t('price.free') : money(satang));

// โทเคน CSRF: อ่านจากคุกกี้ หรือจาก header X-CSRF-Token ของคำตอบล่าสุด (Safari อาจยังไม่เห็นคุกกี้ที่เพิ่งตั้งใน document.cookie)
let lastCsrf = '';
const csrfToken = () => document.cookie.split('; ').find((c) => c.startsWith('csrf='))?.slice(5) || lastCsrf;

export async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (method !== 'GET') {
    if (!csrfToken()) lastCsrf = (await fetch('/api/health', { credentials: 'same-origin' })).headers.get('x-csrf-token') || '';
    opts.headers['x-csrf-token'] = csrfToken();
  }
  const r = await fetch('/api' + path, opts);
  lastCsrf = r.headers.get('x-csrf-token') || lastCsrf;
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
    flash(e?.target?.closest?.('.btn'), 'is-done', 1200); // ปุ่มที่กดเป็นสีเขียวชั่วครู่ (ข้อความแจ้งผ่าน toast ที่ screen reader อ่าน)
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
  if (!on) document.querySelectorAll(`[data-wish="${id}"]`).forEach((b) => replay(b, 'pop'));
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
  if (prefersReducedMotion()) return; // ไม่มีภาพบิน — ตัวเลขตะกร้าเปลี่ยน + toast บอกผลแทน
  const btn = e?.target?.closest('button') || e?.target;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  // ปลายทาง: ปุ่มตะกร้าที่มองเห็นอยู่ (header บนจอกว้าง / แถบล่างจอบนมือถือ)
  const target = [$('#cartBtn'), $('.tabbar [data-nav="cart"]')].find((el) => el?.getClientRects().length);
  if (!target) return;
  const dest = target.getBoundingClientRect();
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
// เว็บตัวอย่าง (เซิร์ฟเวอร์ DEMO_MODE=1 ตั้งคุกกี้ demo=1): ป้าย DEMO ข้างโลโก้ + คำอธิบายใน footer
export const isDemo = /(?:^|;\s*)demo=1(?:;|$)/.test(document.cookie);
function mountLayout() {
  const authHtml = user
    ? `<details class="usermenu"><summary><svg class="icon" aria-hidden="true"><use href="/icons.svg#icon-user" /></svg><span class="user-name">${esc(user.name)}</span></summary>
         <div class="menu"><a href="/profile">${t('header.profile')}</a><button id="logoutBtn" type="button">${t('header.logout')}</button></div></details>`
    : `<a class="btn login" href="/login"><svg class="icon" aria-hidden="true"><use href="/icons.svg#icon-user" /></svg><span class="btn-label">${t('header.login')}</span></a><a class="btn primary register" href="/register">${t('header.register')}</a>`;

  // header/footer มี placeholder อยู่ใน HTML แล้ว (จองที่ว่างกัน layout shift) — เติมเนื้อหาเข้าไป; ถ้าหน้าไหนไม่มีก็สร้างให้
  let header = $('header.topbar');
  if (!header) { header = document.createElement('header'); header.className = 'topbar'; document.body.prepend(header); }
  header.innerHTML = `
    <a class="logo" href="/"><svg class="icon"><use href="/icons.svg#icon-gamepad" /></svg> Game <span>Store</span>${isDemo ? `<span class="demo-badge" title="${t('footer.demo')}">Demo</span>` : ''}</a>
    <nav class="nav" aria-label="main"><a href="/games.html">${t('nav.games')}</a><a href="/games.html?onSale=1">${t('nav.promo')}</a></nav>
    <form class="search" action="/games.html" autocomplete="off" role="search">
      <input id="search" name="q" type="search" placeholder="${t('search.placeholder')}" aria-label="${t('search.placeholder')}">
      <kbd class="search-kbd" title="${t('search.hint')}" aria-hidden="true">/</kbd>
      <ul id="suggest" class="suggest" hidden></ul>
    </form>
    <div class="actions">
      <button id="langBtn" class="icon-btn" type="button" title="${t('header.lang')}" aria-label="${lang === 'th' ? 'EN' : 'TH'} - ${t('header.lang')}">${lang === 'th' ? 'EN' : 'TH'}</button>
      ${authHtml}
      <button id="cartBtn" class="cart-btn" type="button"><svg class="icon"><use href="/icons.svg#icon-cart" /></svg> <span class="cart-label">${t('cart.btn')}</span> <span id="cartCount">0</span></button>
    </div>`;
  let footer = $('body > footer');
  if (!footer) { footer = document.createElement('footer'); document.body.append(footer); }
  footer.innerHTML = `<nav class="foot-links" aria-label="legal"><a href="/privacy">${t('footer.privacy')}</a><a href="/terms">${t('footer.terms')}</a><a href="/refund-policy">${t('footer.refund')}</a></nav><div>${t('footer.text')}</div>${isDemo ? `<p class="demo-note">${t('footer.demo')}</p>` : ''}`;
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

  // มือถือ (≤640px): แถบเมนูล่างจอแบบแอป — ปุ่มบัญชี/ตะกร้าใน header ซ่อนด้วย CSS (ย้ายมาอยู่ที่นี่ กดถึงด้วยนิ้วโป้ง)
  // หน้ายืนยันสั่งซื้อ/คำสั่งซื้อไม่แสดง (ให้โฟกัสกับการจ่ายเงิน และมีแถบยอดรวมของหน้านั้นอยู่ล่างจอแล้ว)
  const path = location.pathname;
  if (!/^\/(checkout|order\/)/.test(path)) {
    const here = path === '/' || path === '/index.html' ? 'home'
      : /^\/(games\.html|game\/)/.test(path) ? 'games'
        : path === '/cart' ? 'cart'
          : /^\/(profile|login|register|forgot|reset|verify)/.test(path) ? 'account' : '';
    const tab = (id, href, icon, label, extra = '') => `<a class="tab" href="${href}" data-nav="${id}" ${here === id ? 'aria-current="page"' : ''}>
      <svg class="icon" aria-hidden="true"><use href="/icons.svg#icon-${icon}" /></svg><span class="tab-label">${label}</span>${extra}</a>`;
    document.body.insertAdjacentHTML('beforeend', `<nav class="tabbar" aria-label="${t('tabbar.label')}">
      ${tab('home', '/', 'home', t('tabbar.home'))}
      ${tab('games', '/games.html', 'grid', t('tabbar.games'))}
      <button class="tab" type="button" id="tabSearch"><svg class="icon" aria-hidden="true"><use href="/icons.svg#icon-search" /></svg><span class="tab-label">${t('tabbar.search')}</span></button>
      ${tab('cart', '/cart', 'cart', t('cart.btn'), '<span class="tab-badge" id="tabCartCount"></span>')}
      ${tab('account', user ? '/profile' : '/login', 'user', user ? t('tabbar.account') : t('header.login'))}
    </nav>`);
    document.body.classList.add('has-tabbar');
    // ค้นหา: เปิดหน้าค้นหาเต็มจอ (search-dialog.js)
    $('#tabSearch').addEventListener('click', () => openSearchDialog());
    // คีย์บอร์ดบนจอเปิดอยู่ (โฟกัสช่องพิมพ์) → ซ่อนแถบ ไม่ให้ลอยขึ้นมาทับช่องที่กำลังพิมพ์
    const typing = (el) => el?.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select');
    // ออกจากช่องพิมพ์: รอ 350ms ค่อยแสดงแถบกลับ (คีย์บอร์ดปิดก่อน) — ถ้าแสดงทันที แถบจะโผล่มารับการกดปุ่มที่อยู่ขอบล่างจอ
    // (เช่น กด "สมัครสมาชิก" ตรงที่แถบเคยอยู่: ช่องรหัสผ่านเสียโฟกัสตอนกดลง แถบกลับมาก่อนปล่อยนิ้ว แล้วการกดไปโดนแถบแทน)
    let showTimer;
    document.addEventListener('focusin', (e) => { clearTimeout(showTimer); if (typing(e.target)) document.body.classList.add('is-typing'); });
    document.addEventListener('focusout', () => {
      clearTimeout(showTimer);
      showTimer = setTimeout(() => document.body.classList.toggle('is-typing', typing(document.activeElement)), 350);
    });
  }

  let shownCount = cart.get().length;
  const renderCart = () => {
    const items = cart.get();
    $('#cartCount').textContent = items.length;
    const tabCount = $('#tabCartCount');
    if (tabCount) tabCount.textContent = items.length || '';
    if (items.length > shownCount) { replay($('#cartCount'), 'bump'); replay(tabCount, 'bump'); }
    shownCount = items.length;
    $('#cartTotal').textContent = priceText(items.reduce((s, i) => s + i.finalPrice, 0)).replace(t('price.free'), '฿0');
    $('#cartItems').innerHTML = items.length
      ? items.map((i) => `
        <div class="cart-item">
          <img class="thumb" src="${esc(i.cover)}" alt="">
          <div class="t"><a href="/game/${esc(i.slug)}">${esc(i.title)}</a><div class="meta">${esc(i.platform)}</div></div>
          <strong>${priceText(i.finalPrice)}</strong>
          <button class="rm" data-rm="${esc(i.slug)}" type="button" aria-label="${t('cart.remove')}"><svg class="icon"><use href="/icons.svg#icon-trash" /></svg></button>
        </div>`).join('')
      : `<div class="empty">${emptyArt('empty-cart')}<p>${t('cart.empty')}</p></div>`;
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
  $('#logoutBtn')?.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    location.href = '/';
  });

  // ช่องค้นหา + รายการแนะนำ (ARIA combobox): ลูกศรขึ้น/ลงเลือก, Enter เปิด, Esc ปิด, คำที่ตรงเป็นตัวเน้น
  const input = $('#search');
  const box = $('#suggest');
  const pageQ = location.pathname.startsWith('/games') ? new URLSearchParams(location.search).get('q') : null;
  if (pageQ) input.value = pageQ; // หน้ารายการเกม: ช่องค้นหาแสดงคำที่ค้นอยู่
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'suggest');
  input.setAttribute('aria-expanded', 'false');
  box.setAttribute('role', 'listbox');
  box.setAttribute('aria-label', t('search.suggestions'));
  let timer;
  let seq = 0; // กันผลของคำค้นเก่าที่ตอบช้ามาเขียนทับคำค้นใหม่
  let active = -1;
  const options = () => [...box.querySelectorAll('[role="option"]')];
  const show = (open) => {
    box.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (!open) { active = -1; input.removeAttribute('aria-activedescendant'); }
  };
  const select = (i) => {
    const opts = options();
    if (!opts.length) return;
    active = (i + opts.length) % opts.length;
    opts.forEach((o, n) => o.setAttribute('aria-selected', String(n === active)));
    input.setAttribute('aria-activedescendant', opts[active].id);
    opts[active].scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { show(false); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      const rows = await api('/games/suggest?q=' + encodeURIComponent(q)).catch(() => []);
      if (mine !== seq || input.value.trim() !== q) return;
      const all = `/games.html?q=${encodeURIComponent(q)}`;
      // ตัวเลือกเป็น option ล้วน (ห้ามมีลิงก์ซ้อนใน option) — ปลายทางอยู่ใน data-href
      box.innerHTML = rows.map((r, i) => `<li id="sug-${i}" role="option" aria-selected="false" data-href="/game/${esc(r.slug)}">${highlight(r.title, q)} <small>${esc(genreName(r.genre))}</small></li>`).join('')
        + `<li id="sug-all" role="option" aria-selected="false" class="suggest-all" data-href="${esc(all)}">${t('search.all', { q: esc(q) })}</li>`;
      show(true);
    }, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); select(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(active - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); show(false); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); location.href = options()[active].dataset.href; }
  });
  box.addEventListener('mousedown', (e) => e.preventDefault()); // คลิกตัวเลือกแล้วโฟกัสยังอยู่ที่ช่องค้นหา (รายการไม่ปิดก่อนคลิกสำเร็จ)
  box.addEventListener('click', (e) => { const o = e.target.closest('[role="option"]'); if (o) location.href = o.dataset.href; });
  input.addEventListener('blur', () => show(false));
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) show(false); });
}

// เน้นส่วนของชื่อที่ตรงกับคำค้น (ทุกคำ ไม่สนตัวพิมพ์เล็ก/ใหญ่) — escape ข้อความก่อนเสมอ ใส่ได้แค่ <mark>
// ใช้ regex แบบ i+u บนข้อความเดิม (ไม่หาตำแหน่งจาก toLowerCase() ซึ่งบางตัวอักษรยาวขึ้น เช่น "İ" ตำแหน่งจะเลื่อน)
export function highlight(text, q) {
  const terms = q.split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return esc(text);
  const re = new RegExp(terms.sort((a, b) => b.length - a.length).join('|'), 'giu'); // คำยาวก่อน
  let out = '';
  let pos = 0;
  for (const m of text.matchAll(re)) {
    out += esc(text.slice(pos, m.index)) + `<mark>${esc(m[0])}</mark>`;
    pos = m.index + m[0].length;
  }
  return out + esc(text.slice(pos));
}

mountLayout();
applyI18n();

// ค้นหาเต็มจอ: "/" (ตอนไม่ได้พิมพ์อยู่) หรือ Ctrl/⌘+K — โหลดโค้ดตอนเปิดครั้งแรก
export const openSearchDialog = (q) => import('./search-dialog.js').then((m) => m.openSearch(q)).catch(() => $('#search')?.focus());
document.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
  if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey) { e.preventDefault(); openSearchDialog(); }
  else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector('dialog[open]')) { e.preventDefault(); openSearchDialog(); }
});

// เปลี่ยนหน้าแบบ view transition (css/transitions.css): กดการ์ด/ลิงก์เกม → ภาพปกที่กดขยายไปเป็นภาพปกในหน้าเกม
// จำลิงก์ที่กดล่าสุด แล้วตอนออกจากหน้า (pageswap) ตั้งชื่อ game-cover ให้ภาพปกของลิงก์นั้น ถ้าปลายทางเป็นหน้าเกมเดียวกัน
let lastGameLink = null;
document.addEventListener('click', (e) => { lastGameLink = e.target.closest?.('a[href^="/game/"]') ?? null; }, true);
window.addEventListener('pageswap', (e) => {
  if (!e.viewTransition || !lastGameLink) return;
  const to = e.activation?.entry?.url;
  if (!to || new URL(to).pathname !== new URL(lastGameLink.href).pathname) return;
  const img = lastGameLink.querySelector('img') ?? lastGameLink.closest('.card, .tile')?.querySelector('.cover img, img');
  if (img?.getClientRects().length) img.style.viewTransitionName = 'game-cover';
});

// footer ซ่อนอยู่จนกว่าหน้าจะโหลดข้อมูลเสร็จ (body[data-async]) — ไม่ให้ footer ถูกดันลงมา (layout shift) ตอนเนื้อหาเข้ามา
export const markReady = () => document.body.classList.add('ready');
if (!document.body.hasAttribute('data-async')) markReady();

// การ์ดเกมเอียงตามเมาส์ + แสงสะท้อน: เฉพาะอุปกรณ์ที่มีเมาส์ และไม่ได้ขอลดการเคลื่อนไหว
// ตั้งแค่ตัวแปร CSS (--rx --ry --mx --my) แล้วให้ CSS ทำ transform/transition — คำนวณไม่เกินเฟรมละครั้ง
if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !prefersReducedMotion()) {
  let frame = 0;
  let last = null;
  const applyTilt = () => {
    frame = 0;
    const card = last?.target?.closest?.('.card:not(.sk)');
    if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (last.clientX - r.left) / r.width;
    const y = (last.clientY - r.top) / r.height;
    card.style.setProperty('--rx', `${((0.5 - y) * 6).toFixed(2)}deg`);
    card.style.setProperty('--ry', `${((x - 0.5) * 6).toFixed(2)}deg`);
    card.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    card.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
  };
  document.addEventListener('pointermove', (e) => { last = e; frame ||= requestAnimationFrame(applyTilt); }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    const card = e.target.closest?.('.card');
    if (!card || card.contains(e.relatedTarget)) return;
    for (const v of ['--rx', '--ry', '--mx', '--my']) card.style.removeProperty(v);
  }, { passive: true });
}

// Navbar dynamic scroll state
window.addEventListener('scroll', () => {
  const tb = $('.topbar');
  if (tb) tb.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });
