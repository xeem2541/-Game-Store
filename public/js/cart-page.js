import { markReady, api, cart, user, loginUrl, money, priceText, summaryHtml, unavailableHtml, bindRemoveUnavailable, esc, $, t, toast, emptyArt } from './common.js';

const view = $('#view');
const getCoupon = () => { try { return sessionStorage.getItem('coupon') || ''; } catch { return ''; } };
const setCoupon = (c) => { try { c ? sessionStorage.setItem('coupon', c) : sessionStorage.removeItem('coupon'); } catch {} };
let couponMsg = null; // { text, ok }

const emptyHtml = () => `<div class="empty">${emptyArt('empty-cart')}<p>${t('cartpage.empty')}</p><p><a class="btn primary big" href="/games.html">${t('cartpage.browse')}</a></p></div>`;

// ผู้เยี่ยมชม (ยังไม่ล็อกอิน): แสดงรายการจาก localStorage ราคาจริงจะคำนวณที่เซิร์ฟเวอร์หลังล็อกอิน
function renderGuest() {
  const items = cart.get();
  if (!items.length) { view.innerHTML = emptyHtml(); return; }
  const total = items.reduce((s, i) => s + i.finalPrice, 0);
  view.innerHTML = `
    <div class="cart-layout">
      <div class="lines">${items.map((i) => `
        <div class="line">
          <img class="thumb" src="${esc(i.cover)}" alt="">
          <div class="t"><a href="/game/${esc(i.slug)}">${esc(i.title)}</a><div class="meta">${esc(i.platform)}</div></div>
          <strong>${priceText(i.finalPrice)}</strong>
          <button class="rm" data-rm="${esc(i.slug)}" type="button" aria-label="${t('cart.remove')}"><svg class="icon"><use href="/icons.svg#icon-trash" /></svg></button>
        </div>`).join('')}</div>
      <aside class="side">
        <div class="summary"><div class="sum-row grand"><span>${t('cart.total')}</span><strong>${priceText(total)}</strong></div></div>
        <p class="meta">${t('cartpage.loginNeeded')}</p>
        <a class="btn primary big block" href="${esc(loginUrl().replace('next=%2Fcart', 'next=%2Fcart'))}">${t('header.login')}</a>
      </aside>
    </div>`;
}

async function renderUser() {
  const code = getCoupon();
  let s = await api('/cart/summary' + (code ? '?coupon=' + encodeURIComponent(code) : ''));
  if (s.couponError) { // โค้ดที่เก็บไว้ใช้ไม่ได้แล้ว (หมดอายุ/ยอดไม่ถึง) → เอาออกและแจ้งเหตุผล
    couponMsg = { text: s.couponError.message, ok: false };
    setCoupon('');
    s = await api('/cart/summary');
  }
  if (!s.items.length) { view.innerHTML = unavailableHtml(s.unavailable) + emptyHtml(); bindRemoveUnavailable(renderUser); return; }
  const blocked = s.items.some((i) => i.owned);
  view.innerHTML = `
    ${unavailableHtml(s.unavailable)}
    <div class="cart-layout">
      <div class="lines">${s.items.map((i) => `
        <div class="line ${i.owned ? 'owned' : ''}">
          <img class="thumb" src="${esc(i.cover)}" alt="">
          <div class="t"><a href="/game/${esc(i.slug)}">${esc(i.title)}</a><div class="meta">${esc(i.platform)}</div>
            ${i.owned ? `<div class="msg">${t('cartpage.owned')}</div>` : ''}</div>
          <strong>${i.discountPercent ? `<span class="old">${money(i.listPrice)}</span>` : ''}${money(i.unitPrice)}</strong>
          <button class="rm" data-rm="${esc(i.slug)}" type="button" aria-label="${t('cart.remove')}"><svg class="icon"><use href="/icons.svg#icon-trash" /></svg></button>
        </div>`).join('')}</div>
      <aside class="side">
        <form id="couponForm" class="coupon">
          <label for="couponInput">${t('coupon.label')}</label>
          <div class="row">
            <input id="couponInput" maxlength="40" autocomplete="off" placeholder="${t('coupon.placeholder')}" value="${esc(s.coupon?.code ?? '')}" ${s.coupon ? 'readonly' : ''}>
            ${s.coupon ? `<button class="btn" type="button" id="couponRemove">${t('coupon.remove')}</button>` : `<button class="btn" type="submit">${t('coupon.apply')}</button>`}
          </div>
          <p class="msg ${couponMsg?.ok ? 'ok' : ''}" role="alert">${esc(couponMsg?.text ?? '')}</p>
        </form>
        ${summaryHtml(s)}
        <a class="btn primary big block ${blocked ? 'disabled' : ''}" href="/checkout" ${blocked ? 'aria-disabled="true" tabindex="-1"' : ''}>${t('cartpage.toCheckout')}</a>
      </aside>
    </div>`;
  couponMsg = null;
  bindRemoveUnavailable(renderUser);
  $('#couponForm').onsubmit = async (e) => {
    e.preventDefault();
    const v = $('#couponInput').value.trim();
    if (!v) return;
    try {
      const r = await api('/coupons/validate', { method: 'POST', body: { code: v } });
      setCoupon(r.summary.coupon.code);
      couponMsg = { text: t('coupon.applied'), ok: true };
    } catch (err) { couponMsg = { text: err.message, ok: false }; }
    renderUser();
  };
  $('#couponRemove')?.addEventListener('click', () => { setCoupon(''); renderUser(); });
}

const render = async () => (user ? renderUser() : renderGuest());

view.addEventListener('click', async (e) => {
  const slug = e.target.dataset?.rm;
  if (slug) { await cart.remove(slug); render().catch(() => toast(t('common.error'))); }
});
view.addEventListener('click', (e) => { if (e.target.closest('a.disabled')) e.preventDefault(); });

render().catch((e) => { view.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }).finally(markReady);

