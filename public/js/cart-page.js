import { markReady, api, cart, user, loginUrl, money, priceText, summaryHtml, unavailableHtml, bindRemoveUnavailable, esc, $, t, toast, emptyArt } from './common.js';
import { prefersReducedMotion, replay } from './motion.js';
import { setStep, countUp, summaryBar } from './checkout-ui.js';

const view = $('#view');
const getCoupon = () => { try { return sessionStorage.getItem('coupon') || ''; } catch { return ''; } };
const setCoupon = (c) => { try { c ? sessionStorage.setItem('coupon', c) : sessionStorage.removeItem('coupon'); } catch {} };
let couponMsg = null; // { text, ok }
let lastTotal = null; // ยอดรวมก่อนวาดใหม่ → นับตัวเลขจากค่าเดิมไปค่าใหม่ (เห็นว่าส่วนลด/การลบเกมเปลี่ยนยอดเท่าไร)
let focusAfter = null; // หลังลบเกม: โฟกัสปุ่มลบของรายการถัดไป (ไม่ให้โฟกัสหลุดไปต้นหน้า)

setStep(1);
const emptyHtml = () => `<div class="empty">${emptyArt('empty-cart')}<p>${t('cartpage.empty')}</p><p><a class="btn primary big" href="/games.html">${t('cartpage.browse')}</a></p></div>`;

// การ์ดเกมในตะกร้า: ห่อด้วย .swipe ที่มีพื้นสีแดง "ลบ" อยู่ข้างหลัง (มือถือปัดการ์ดไปทางซ้ายเพื่อลบ)
// เกมดิจิทัล 1 บัญชีใช้ได้ 1 โค้ด จึงไม่มีปุ่มเพิ่ม/ลดจำนวน
const lineHtml = (i, price) => `
  <div class="swipe" data-slug="${esc(i.slug)}">
    <span class="swipe-del" aria-hidden="true"><svg class="icon"><use href="/icons.svg#icon-trash" /></svg>${t('cart.remove')}</span>
    <div class="line ${i.owned ? 'owned' : ''}">
      <img class="thumb" src="${esc(i.cover)}" alt="" width="72" height="72">
      <div class="t"><a href="/game/${esc(i.slug)}">${esc(i.title)}</a><div class="meta"><span class="plat">${esc(i.platform)}</span></div>
        ${i.owned ? `<div class="msg">${t('cartpage.owned')}</div>` : ''}</div>
      <strong>${price}</strong>
      <button class="rm" data-rm="${esc(i.slug)}" type="button" aria-label="${esc(t('cart.removeTitle', { title: i.title }))}"><svg class="icon"><use href="/icons.svg#icon-trash" /></svg></button>
    </div>
  </div>`;

const linesHtml = (lines) => `<div class="lines-head"><span>${t('cartpage.count', { n: lines.length })}</span><span class="swipe-hint">${t('cartpage.swipeHint')}</span></div>
  <div class="lines">${lines.join('')}</div>`;

const grandEl = () => view.querySelector('.summary .sum-row.grand strong');
function afterRender(total) {
  countUp(grandEl(), lastTotal ?? total, total, money);
  lastTotal = total;
  if (focusAfter) {
    const next = view.querySelector(`[data-rm="${CSS.escape(focusAfter)}"]`) ?? view.querySelector('[data-rm]') ?? $('main h1');
    if (next?.matches('h1')) next.tabIndex = -1;
    next?.focus();
    focusAfter = null;
  }
}

// ผู้เยี่ยมชม (ยังไม่ล็อกอิน): แสดงรายการจาก localStorage ราคาจริงจะคำนวณที่เซิร์ฟเวอร์หลังล็อกอิน
function renderGuest() {
  const items = cart.get();
  if (!items.length) { view.innerHTML = emptyHtml(); return; }
  const total = items.reduce((s, i) => s + i.finalPrice, 0);
  view.innerHTML = `
    <div class="cart-layout">
      <div>${linesHtml(items.map((i) => lineHtml(i, priceText(i.finalPrice))))}</div>
      <aside class="side">
        <div class="summary"><div class="sum-row grand"><span>${t('cart.total')}</span><strong>${priceText(total)}</strong></div></div>
        <p class="meta">${t('cartpage.loginNeeded')}</p>
        <a class="btn primary big block" href="${esc(loginUrl())}">${t('header.login')}</a>
      </aside>
    </div>`;
  summaryBar(view, { total: priceText(total), label: t('header.login'), href: loginUrl() });
  afterRender(total);
}

function couponHtml(s) {
  if (s.coupon) {
    return `<div class="coupon is-applied">
      <span class="coupon-label">${t('coupon.label')}</span>
      <div class="coupon-tag">
        <span class="coupon-code">${esc(s.coupon.code)}</span>
        <span class="coupon-save">−${money(s.couponDiscount)}</span>
        <button class="coupon-x" type="button" id="couponRemove" aria-label="${t('coupon.remove')} ${esc(s.coupon.code)}">✕</button>
      </div>
      <p class="msg ok" role="status">${esc(couponMsg?.ok ? couponMsg.text : '')}</p>
    </div>`;
  }
  return `<form id="couponForm" class="coupon" novalidate>
    <label for="couponInput">${t('coupon.label')}</label>
    <div class="row">
      <input id="couponInput" maxlength="40" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${t('coupon.placeholder')}" aria-describedby="couponMsg" ${couponMsg && !couponMsg.ok ? 'aria-invalid="true"' : ''}>
      <button class="btn" type="submit" disabled>${t('coupon.apply')}</button>
    </div>
    <p class="msg" id="couponMsg" role="alert">${esc(couponMsg && !couponMsg.ok ? couponMsg.text : '')}</p>
  </form>`;
}

async function renderUser() {
  const code = getCoupon();
  let s = await api('/cart/summary' + (code ? '?coupon=' + encodeURIComponent(code) : ''));
  if (s.couponError) { // โค้ดที่เก็บไว้ใช้ไม่ได้แล้ว (หมดอายุ/ยอดไม่ถึง) → เอาออกและแจ้งเหตุผล
    couponMsg = { text: s.couponError.message, ok: false };
    setCoupon('');
    s = await api('/cart/summary');
  }
  if (!s.items.length) { view.innerHTML = unavailableHtml(s.unavailable) + emptyHtml(); bindRemoveUnavailable(renderUser); lastTotal = 0; return; }
  const blocked = s.items.some((i) => i.owned);
  const saved = (s.gameDiscount || 0) + (s.couponDiscount || 0);
  const failed = couponMsg && !couponMsg.ok;
  const fresh = couponMsg?.ok; // เพิ่งใช้โค้ดสำเร็จ → เล่นแอนิเมชันส่วนลด
  view.innerHTML = `
    ${unavailableHtml(s.unavailable)}
    <div class="cart-layout">
      <div>${linesHtml(s.items.map((i) => lineHtml(i, `${i.discountPercent ? `<span class="old">${money(i.listPrice)}</span>` : ''}${money(i.unitPrice)}`)))}</div>
      <aside class="side ${fresh ? 'is-fresh' : ''}">
        ${couponHtml(s)}
        ${summaryHtml(s)}
        ${saved ? `<p class="savings">${t('summary.saved', { amount: money(saved) })}</p>` : ''}
        <a class="btn primary big block ${blocked ? 'disabled' : ''}" href="/checkout" ${blocked ? 'aria-disabled="true" tabindex="-1"' : ''}>${t('cartpage.toCheckout')}</a>
      </aside>
    </div>`;
  couponMsg = null;
  summaryBar(view, { total: money(s.total), label: t('cartpage.toCheckout'), href: '/checkout', disabled: blocked });
  afterRender(s.total);
  bindRemoveUnavailable(renderUser);

  const input = $('#couponInput');
  if (input) {
    const apply = $('#couponForm button[type=submit]');
    if (failed) { replay(input, 'shake'); input.focus(); }
    // ตอบสนองทันทีขณะพิมพ์: ตัวพิมพ์ใหญ่, ปุ่ม "ใช้โค้ด" กดได้เมื่อมีข้อความ, ล้างข้อความผิดเดิม
    input.addEventListener('input', () => {
      const pos = input.selectionStart;
      input.value = input.value.toUpperCase().replace(/\s+/g, '');
      input.setSelectionRange(pos, pos);
      apply.disabled = !input.value;
      input.removeAttribute('aria-invalid');
      $('#couponMsg').textContent = '';
    });
    $('#couponForm').onsubmit = async (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      apply.disabled = true;
      apply.setAttribute('aria-busy', 'true');
      try {
        const r = await api('/coupons/validate', { method: 'POST', body: { code: v } });
        setCoupon(r.summary.coupon.code);
        couponMsg = { text: t('coupon.applied'), ok: true };
      } catch (err) { couponMsg = { text: err.message, ok: false }; }
      await renderUser();
    };
  }
  $('#couponRemove')?.addEventListener('click', async () => { setCoupon(''); await renderUser(); $('#couponInput')?.focus(); });
}

const render = async () => (user ? renderUser() : renderGuest());

// ลบเกม: การ์ดเลื่อนออก + ยุบความสูง แล้วค่อยลบจริงและวาดยอดใหม่
async function removeLine(slug) {
  const wrap = view.querySelector(`.swipe[data-slug="${CSS.escape(slug)}"]`);
  const title = wrap?.querySelector('.t a')?.textContent ?? '';
  const next = wrap?.nextElementSibling?.dataset.slug ?? wrap?.previousElementSibling?.dataset.slug;
  if (wrap) {
    wrap.classList.add('is-gone');
    await new Promise((r) => setTimeout(r, prefersReducedMotion() ? 0 : 320));
  }
  await cart.remove(slug);
  focusAfter = next ?? '';
  await render().catch(() => toast(t('common.error')));
  toast(t('cartpage.removed', { title }));
}

view.addEventListener('click', (e) => {
  const rm = e.target.closest('[data-rm]');
  if (rm) { removeLine(rm.dataset.rm); return; }
  if (e.target.closest('a.disabled')) e.preventDefault();
});

// ปัดซ้ายเพื่อลบ (นิ้ว/ปากกาเท่านั้น — เมาส์ใช้ปุ่มถังขยะ) ปัดไม่ถึง 40% ของความกว้าง = เด้งกลับ
// CSS ตั้ง touch-action: pan-y ไว้ เลื่อนหน้าขึ้นลงได้ตามปกติ
let drag = null;
view.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || e.target.closest('a, button, input')) return;
  const line = e.target.closest('.swipe .line');
  if (!line) return;
  drag = { line, x: e.clientX, y: e.clientY, dx: 0, active: false, id: e.pointerId };
});
view.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  if (!drag.active) {
    if (Math.abs(e.clientY - drag.y) > 12) { drag = null; return; } // เลื่อนแนวตั้ง = เลื่อนหน้า ไม่ใช่ปัด
    if (dx > -12) return;
    drag.active = true;
    try { drag.line.setPointerCapture(e.pointerId); } catch {}
    drag.line.classList.add('is-dragging');
  }
  drag.dx = Math.min(0, dx);
  drag.line.style.transform = `translateX(${drag.dx}px)`;
  drag.line.parentElement.classList.toggle('is-armed', -drag.dx > drag.line.offsetWidth * 0.4);
});
const endDrag = (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const { line, dx, active } = drag;
  drag = null;
  if (!active) return;
  line.classList.remove('is-dragging');
  if (-dx > line.offsetWidth * 0.4) {
    line.style.transform = 'translateX(-110%)';
    removeLine(line.parentElement.dataset.slug);
  } else {
    line.style.transform = '';
    line.parentElement.classList.remove('is-armed');
  }
};
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);

render().catch((e) => { view.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }).finally(markReady);
