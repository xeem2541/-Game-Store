import { markReady, api, cart, user, loginUrl, money, summaryHtml, fmtDateTime, esc, $, t, toast } from './common.js';
import { setStep, renderVouchers, confetti } from './checkout-ui.js';

if (!user) { location.replace(loginUrl()); throw new Error('redirect'); }

const view = $('#view');
const id = Number(location.pathname.split('/').pop());
let timer;
let verifying = false;
let sawPending = false; // เห็นออเดอร์นี้ตอนยังไม่จ่ายในหน้านี้ → เปลี่ยนเป็นจ่ายแล้วเมื่อไร = ฉลอง
const celebrated = () => { try { return sessionStorage.getItem('celebrated') === String(id); } catch { return true; } };
const markCelebrated = () => { try { sessionStorage.setItem('celebrated', String(id)); } catch {} };

const config = await api('/config').catch(() => ({ devPay: false, payments: { stripe: false } }));

// กลับจาก Stripe: query string "ไม่ใช่หลักฐานการจ่ายเงิน" ใช้เป็นแค่สัญญาณให้ poll สถานะจากเซิร์ฟเวอร์ (ซึ่งยืนยันจาก webhook)
const returnedFromStripe = new URLSearchParams(location.search).get('checkout');
if (returnedFromStripe) history.replaceState(null, '', location.pathname);
if (returnedFromStripe === 'canceled') toast(t('order.checkoutCanceled'));

function render(o) {
  document.title = t('order.title', { id: o.id }) + ' – Game Store';
  const pending = o.status === 'pending';
  const paid = o.status === 'paid';
  // แถบขั้นตอนแสดงเฉพาะออเดอร์ที่กำลังจ่าย/จ่ายแล้ว (ยกเลิก/คืนเงิน ไม่อยู่ในเส้นทางซื้อ)
  const steps = $('.steps');
  if (steps) steps.hidden = !(pending || paid);
  setStep(paid ? 4 : 3);
  if (pending) sawPending = true;
  view.innerHTML = `
    <h1 class="sec">${t('order.title', { id: o.id })} <span class="status ${o.status}">${t('order.status.' + o.status)}</span></h1>
    <div class="meta">${t('order.created')} ${fmtDateTime(o.createdAt)}${o.paidAt ? ` • ${t('order.paidAt')} ${fmtDateTime(o.paidAt)}` : ''}${o.invoiceNumber ? ` • ${esc(o.invoiceNumber)}` : ''}</div>
    ${o.status === 'cancelled' && o.cancelReason ? `<p class="msg">${t('order.reason.' + o.cancelReason)}</p>` : ''}
    ${verifying && pending ? `<div class="banner info"><span class="spinner" aria-hidden="true"></span><span>${t('order.verifying')}</span></div>` : ''}
    <div class="cart-layout">
      <div>
        ${paid ? `
          <div class="paid-hero">
            <span class="paid-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
            <div><h2>${t('order.successTitle')}</h2><p>${t('order.successSub', { n: o.keys?.length ?? o.items.length })}</p></div>
          </div>
          <h2 class="sec">${t('order.keys')}</h2><div id="keys" class="vouchers"></div><p class="meta keys-note">${t('order.keysNote')}</p>` : ''}
        <h2 class="sec">${t('order.items')}</h2>
        <div class="lines">${o.items.map((i) => `
          <div class="line">
            <img class="thumb" src="${esc(i.cover)}" alt="" width="72" height="72">
            <div class="t"><a href="/game/${esc(i.slug)}">${esc(i.title)}</a><div class="meta">${esc(i.platform)}</div></div>
            <strong>${i.discountPercent ? `<span class="old">${money(i.listPrice)}</span>` : ''}${money(i.unitPrice)}</strong>
          </div>`).join('')}</div>
      </div>
      <aside class="side">
        ${summaryHtml({ ...o, coupon: { code: o.couponCode } })}
        ${pending ? `
          <p class="meta" id="countdown"></p>
          ${config.demo
            // เว็บตัวอย่าง (DEMO_MODE): จ่ายแบบจำลองเป็นปุ่มหลัก พร้อมบอกชัดว่าไม่เก็บเงินจริง
            ? `<div class="payment-box">${t('order.demoNote')}</div><button class="btn primary big block" id="devPay" type="button">${t('order.demoPay')}</button>`
            : `${config.payments?.stripe
              ? `<button class="btn primary big block" id="payBtn" type="button">${t('order.pay')}</button><small class="meta">${t('order.payMethods')}</small>`
              : `<div class="payment-box">${t('order.payNotConfigured')}${config.devPay ? `<br><small>${t('order.payNotConfiguredDev')}</small>` : ''}</div>`}
            ${config.devPay ? `<button class="btn block" id="devPay" type="button">${t('order.devPay')}</button><small class="meta">${t('order.devNote')}</small>` : ''}`}
          <button class="btn danger block" id="cancelBtn" type="button">${t('order.cancel')}</button>` : ''}
        ${paid ? `
          <p class="msg ok">${t('order.paidNote')}</p>
          <a class="btn primary block" href="/api/orders/${o.id}/receipt.pdf" download>${t('order.receipt')}</a>
          <button class="btn block" id="resendBtn" type="button">${t('order.resend')}</button>
          <a class="btn block" href="/profile#library">${t('order.gotoLibrary')}</a>` : ''}
        ${o.status === 'refunded' ? `<p class="msg">${t('order.refundedNote')}</p>` : ''}
        <a class="alt-link" href="/profile#orders">← ${t('order.back')}</a>
      </aside>
    </div>`;

  if (paid && o.keys) renderVouchers($('#keys'), o.keys);
  // ฉลองครั้งเดียวต่อออเดอร์: จ่ายสำเร็จระหว่างอยู่หน้านี้ หรือเพิ่งกลับจากหน้าชำระเงิน
  if (paid && (sawPending || returnedFromStripe === 'return') && !celebrated()) {
    markCelebrated();
    confetti();
    $('.paid-hero')?.classList.add('is-new');
  }

  clearInterval(timer);
  if (pending) {
    const tick = () => {
      const left = Math.ceil((o.expiresAt - Date.now()) / 60000);
      if (left <= 0) { clearInterval(timer); load(); return; }
      $('#countdown').textContent = t('order.expiresIn', { m: left });
    };
    tick();
    timer = setInterval(tick, 15000);
  }

  $('#payBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      const { url } = await api(`/orders/${o.id}/pay`, { method: 'POST', body: {} });
      location.href = url; // ไปหน้าชำระเงินของ Stripe (บัตร / PromptPay QR)
    } catch (err) { toast(err.message); btn.disabled = false; btn.removeAttribute('aria-busy'); }
  });
  $('#cancelBtn')?.addEventListener('click', async () => {
    if (!confirm(t('order.confirmCancel'))) return;
    try { render((await api(`/orders/${o.id}/cancel`, { method: 'POST', body: {} })).order); toast(t('order.cancelled')); }
    catch (e) { toast(e.message); }
  });
  $('#devPay')?.addEventListener('click', async () => {
    try { await api(`/orders/${o.id}/dev-pay`, { method: 'POST', body: {} }); await load(); cart.refresh(); }
    catch (e) { toast(e.message); }
  });
  $('#resendBtn')?.addEventListener('click', async () => {
    try { await api(`/orders/${o.id}/resend-email`, { method: 'POST', body: {} }); toast(t('order.resent')); }
    catch (e) { toast(e.message); }
  });
}

async function load() {
  try {
    const { order } = await api('/orders/' + id);
    if (order.status !== 'pending') { verifying = false; cart.refresh(); }
    render(order);
    return order;
  } catch {
    view.innerHTML = `<p class="empty">${t('order.notfound')} <a href="/profile#orders">${t('order.back')}</a></p>`;
    return null;
  }
}

await load();
markReady();

// หลังกลับจาก Stripe: รอ webhook ยืนยัน (poll จากเซิร์ฟเวอร์ ทุก 2.5 วินาที สูงสุด ~2 นาที)
if (returnedFromStripe === 'return' && view.querySelector('.status.pending')) {
  verifying = true;
  render((await api('/orders/' + id)).order);
  for (let i = 0; i < 48 && verifying; i += 1) {
    await new Promise((r) => setTimeout(r, 2500));
    const o = await load();
    if (!o || o.status !== 'pending') break;
  }
  if (verifying) { verifying = false; toast(t('order.verifyTimeout')); await load(); }
}
