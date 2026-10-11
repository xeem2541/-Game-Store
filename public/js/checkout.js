import { markReady, api, cart, user, loginUrl, money, summaryHtml, unavailableHtml, bindRemoveUnavailable, esc, $, t, toast } from './common.js';

if (!user) { location.replace(loginUrl()); throw new Error('redirect'); }

const view = $('#view');
const getCoupon = () => { try { return sessionStorage.getItem('coupon') || ''; } catch { return ''; } };

// idempotency key: ผูกกับ "ตะกร้า+คูปอง" ชุดนี้ กดซ้ำ/รีเฟรชแล้วยังได้ออเดอร์เดิม ไม่สร้างซ้ำ
function keyFor(sig) {
  try {
    const saved = JSON.parse(sessionStorage.getItem('idem') || 'null');
    if (saved?.sig === sig) return saved.key;
    const key = crypto.randomUUID();
    sessionStorage.setItem('idem', JSON.stringify({ sig, key }));
    return key;
  } catch { return crypto.randomUUID(); }
}

async function load() {
  const code = getCoupon();
  let s = await api('/cart/summary' + (code ? '?coupon=' + encodeURIComponent(code) : ''));
  if (s.couponError) { try { sessionStorage.removeItem('coupon'); } catch {} s = await api('/cart/summary'); }
  if (!s.items.length) {
    view.innerHTML = `${unavailableHtml(s.unavailable)}<p class="empty">${t('checkout.empty')} <a href="/games.html">${t('cartpage.browse')}</a></p>`;
    bindRemoveUnavailable(load);
    return;
  }

  // มีเกมที่หยุดขายค้างในตะกร้า → ให้นำออกก่อน (ยอดที่เห็นไม่รวมเกมนั้น จะได้ไม่สั่งซื้อโดยไม่รู้ตัว)
  const blocked = s.items.some((i) => i.owned) || s.unavailable?.length > 0;
  const needVerify = !user.emailVerified;
  view.innerHTML = `
    ${unavailableHtml(s.unavailable)}
    ${needVerify ? `<div class="banner"><span>${t('checkout.verifyNeeded')}</span><button class="btn" id="resendBtn" type="button">${t('profile.resend')}</button></div>` : ''}
    <div class="cart-layout">
      <div>
        <h2 class="sec">${t('checkout.review')}</h2>
        <div class="lines">${s.items.map((i) => `
          <div class="line ${i.owned ? 'owned' : ''}">
            <img class="thumb" src="${esc(i.cover)}" alt="">
            <div class="t"><a href="/game/${esc(i.slug)}">${esc(i.title)}</a><div class="meta">${esc(i.platform)}</div>
              ${i.owned ? `<div class="msg">${t('cartpage.owned')}</div>` : ''}</div>
            <strong>${i.discountPercent ? `<span class="old">${money(i.listPrice)}</span>` : ''}${money(i.unitPrice)}</strong>
          </div>`).join('')}</div>
        <h2 class="sec">${t('checkout.paymentTitle')}</h2>
        <div class="payment-box">${t('checkout.paymentNote')}</div>
      </div>
      <aside class="side">
        ${summaryHtml(s)}
        <p class="msg" id="msg" role="alert"></p>
        <button class="btn primary big block" id="placeBtn" type="button" ${blocked || needVerify ? 'disabled' : ''}>${t('checkout.confirm')}</button>
        <a class="alt-link" href="/cart">← ${t('cartpage.title')}</a>
      </aside>
    </div>`;

  bindRemoveUnavailable(load);
  $('#resendBtn')?.addEventListener('click', async () => {
    await api('/auth/resend', { method: 'POST', body: {} }).catch(() => {});
    toast(t('profile.resent'));
  });

  $('#placeBtn').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true'); // วงหมุนแทนข้อความ (CSS) — ข้อความยังอยู่ให้ screen reader อ่าน
    btn.textContent = t('checkout.placing');
    const sig = s.items.map((i) => i.slug).join(',') + '|' + (s.coupon?.code ?? '');
    try {
      const body = { idempotencyKey: keyFor(sig) };
      if (s.coupon) body.couponCode = s.coupon.code;
      const { order } = await api('/orders', { method: 'POST', body });
      try { sessionStorage.removeItem('coupon'); sessionStorage.removeItem('idem'); } catch {}
      location.href = '/order/' + order.id;
    } catch (err) {
      if (err.code === 'GAME_UNAVAILABLE') { // เกมถูกหยุดขายระหว่างอยู่หน้านี้: เซิร์ฟเวอร์นำออกจากตะกร้าแล้ว → โหลดยอดใหม่ให้ตรวจก่อนสั่งอีกครั้ง
        await cart.refresh();
        await load();
        $('#msg').textContent = err.message;
        return;
      }
      $('#msg').textContent = err.message;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.textContent = t('checkout.confirm');
    }
  };
}

load().catch((e) => { view.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }).finally(markReady);
