import { renderVouchers } from './checkout-ui.js';
import { bindPasswordToggles, bindStrengthMeter } from './password-ui.js';
import { markReady, api, $, esc, t, user, loginUrl, cardHtml, remember, toast, money, fmtDateTime, emptyArt, lang } from './common.js';

if (!user) { location.replace(loginUrl()); throw new Error('redirect'); }

const panel = $('#panel');
// ออกจากระบบจากหน้าบัญชี (บนมือถือเมนูผู้ใช้ใน header ถูกแทนด้วยแถบล่างจอ)
$('#profileLogout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  location.href = '/';
});
const tabs = [...document.querySelectorAll('[data-tab]')];

if (!user.emailVerified) {
  $('#verifyBanner').hidden = false;
  $('#resendBtn').onclick = async () => {
    await api('/auth/resend', { method: 'POST', body: {} }).catch(() => {});
    toast(t('profile.resent'));
  };
}

const views = {
  info() {
    panel.innerHTML = `
      <form id="infoForm" class="auth-form">
        <label><span>${t('auth.name')}</span><input name="name" required maxlength="80" value="${esc(user.name)}"></label>
        <label><span>${t('auth.email')}</span><input name="email" type="email" required value="${esc(user.email)}"></label>
        <small>${t('profile.emailChangeNote')}</small>
        <label id="curPwRow" hidden><span>${t('profile.currentPassword')}</span><input name="cur" type="password" autocomplete="current-password"></label>
        <p class="msg" id="msg" role="alert"></p>
        <button class="btn primary" type="submit">${t('common.save')}</button>
      </form>`;
    // เปลี่ยนอีเมลต้องยืนยันด้วยรหัสผ่านปัจจุบัน → แสดงช่องรหัสผ่านเมื่ออีเมลต่างจากเดิม
    const emailChanged = () => $('#infoForm').email.value.trim().toLowerCase() !== user.email.toLowerCase();
    $('#infoForm').email.oninput = () => {
      $('#curPwRow').hidden = !emailChanged();
      $('#infoForm').cur.required = emailChanged();
    };
    $('#infoForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const body = { name: f.name.value, email: f.email.value };
        if (emailChanged()) body.currentPassword = f.cur.value;
        await api('/me', { method: 'PUT', body });
        $('#msg').classList.add('ok');
        $('#msg').textContent = t('profile.saved');
        setTimeout(() => location.reload(), 600);
      } catch (err) { $('#msg').classList.remove('ok'); $('#msg').textContent = err.message; }
    };
  },
  password() {
    const field = (name, label, ac, extra = '') => `<div class="pw-wrap"><label><span>${label}</span>
          <input name="${name}" type="password" required autocomplete="${ac}" maxlength="72" ${extra}></label>
          <button class="pw-toggle" type="button" aria-pressed="false" aria-label="${t('auth.showPassword')}"><svg class="icon" aria-hidden="true"><use href="/icons.svg#icon-eye" /></svg></button></div>`;
    panel.innerHTML = `
      <form id="pwForm" class="auth-form">
        ${field('cur', t('profile.currentPassword'), 'current-password')}
        ${field('next', t('auth.newPassword'), 'new-password', 'minlength="8" aria-describedby="pwHint"')}
        <div class="pw-meter" aria-hidden="true" data-level="0"><i></i><i></i><i></i><i></i></div>
        <small id="pwHint" class="pw-hint" aria-live="polite">${t('auth.passwordHint')}</small>
        <p class="msg" id="msg" role="alert"></p>
        <button class="btn primary" type="submit">${t('common.save')}</button>
      </form>
      <div class="auth-form">
        <small>${t('profile.logoutAllNote')}</small>
        <button class="btn danger" id="logoutAllBtn" type="button">${t('profile.logoutAll')}</button>
      </div>`;
    bindPasswordToggles(panel);
    bindStrengthMeter($('#pwForm'), $('.pw-meter'), $('#pwHint'), { field: 'next', email: user.email, name: user.name });
    $('#logoutAllBtn').onclick = async () => {
      try { await api('/auth/logout-all', { method: 'POST', body: {} }); location.href = '/login'; } catch (err) { toast(err.message); }
    };
    $('#pwForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const msg = $('#msg');
      if (f.next.value.length < 8) { msg.classList.remove('ok'); msg.textContent = t('auth.shortPassword'); return; }
      try {
        await api('/me/password', { method: 'POST', body: { currentPassword: f.cur.value, newPassword: f.next.value } });
        f.reset();
        $('.pw-meter').dataset.level = '0';
        $('#pwHint').textContent = t('auth.passwordHint');
        msg.classList.add('ok');
        msg.textContent = t('profile.passwordChanged');
      } catch (err) { msg.classList.remove('ok'); msg.textContent = err.message; }
    };
  },
  async orders(page = 1) {
    const data = await api('/me/orders?page=' + page);
    if (!data.items.length) { panel.innerHTML = `<div class="empty">${emptyArt('empty-cart')}<p>${t('profile.noOrders')}</p></div>`; return; }
    panel.innerHTML = `
      <div class="order-list">${data.items.map((o) => `
        <div class="order-row">
          <div class="grow">
            <a href="/order/${o.id}"><strong>${t('order.title', { id: o.id })}</strong></a>
            <span class="status ${o.status}">${t('order.status.' + o.status)}</span>
            <div class="meta">${fmtDateTime(o.createdAt)} • ${esc(o.titles.join(', '))}</div>
          </div>
          <strong>${money(o.total)}</strong>
          <a class="btn" href="/order/${o.id}">${t('order.view')}</a>
          ${o.status === 'paid' ? `<a class="btn" href="/api/orders/${o.id}/receipt.pdf" download>${t('order.receipt')}</a>` : ''}
          ${o.status === 'pending' ? `<button class="btn danger" data-cancel="${o.id}" type="button">${t('order.cancel')}</button>` : ''}
        </div>`).join('')}</div>
      ${data.pages > 1 ? `<div class="pager">
        <button class="btn" data-opage="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${t('profile.prev')}</button>
        <span class="meta">${page} / ${data.pages}</span>
        <button class="btn" data-opage="${page + 1}" ${page >= data.pages ? 'disabled' : ''}>${t('profile.next')}</button></div>` : ''}`;
    panel.onclick = async (e) => {
      const cancel = e.target.dataset.cancel;
      const op = e.target.dataset.opage;
      if (cancel) {
        if (!confirm(t('order.confirmCancel'))) return;
        try { await api(`/orders/${cancel}/cancel`, { method: 'POST', body: {} }); toast(t('order.cancelled')); } catch (err) { toast(err.message); }
        views.orders(page);
      } else if (op) views.orders(+op);
    };
  },
  async library() {
    const { items } = await api('/me/library');
    if (!items.length) { panel.innerHTML = `<div class="empty">${emptyArt('empty-library')}<p>${t('profile.noLibrary')}</p></div>`; return; }
    // เกมที่ซื้อ = คูปองโค้ดเหมือนหน้าคำสั่งซื้อ (แสดง/คัดลอก/เปิดในร้านของแพลตฟอร์ม)
    panel.innerHTML = '<div class="vouchers lib-vouchers" id="libKeys"></div>';
    renderVouchers($('#libKeys'), items.flatMap((g) => g.keys.map((k) => ({ slug: g.slug, title: g.title, platform: g.platform, code: k.code }))));
  },
  async wishlist() {
    const { items } = await api('/wishlist');
    remember(items);
    panel.innerHTML = items.length ? `<div class="grid">${items.map(cardHtml).join('')}</div>` : `<div class="empty">${emptyArt('empty-wishlist')}<p>${t('profile.noWishlist')}</p></div>`;
  },
};

async function show(name) {
  if (!views[name]) name = 'info';
  tabs.forEach((b) => { const on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  panel.onclick = null;
  panel.innerHTML = `<p class="empty">${t('common.loading')}</p>`;
  try { await views[name](); } catch (e) { panel.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}

const goTo = (name) => { history.replaceState(null, '', '#' + name); show(name); };
tabs.forEach((b) => b.addEventListener('click', () => goTo(b.dataset.tab)));
// เปลี่ยน #แท็บ ที่แถบที่อยู่ / ปุ่มย้อนกลับ (replaceState ข้างบนไม่ทำให้เกิดเหตุการณ์นี้)
window.addEventListener('hashchange', () => show(location.hash.slice(1)));

// หัวโปรไฟล์: อวาตาร์ตัวอักษรแรกของชื่อ + อีเมล + เป็นสมาชิกตั้งแต่
function renderHero() {
  const initial = [...user.name.trim()][0]?.toUpperCase() ?? '?';
  const since = new Date(user.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-US', { year: 'numeric', month: 'long' });
  $('#profileHero').innerHTML = `<span class="avatar" aria-hidden="true">${esc(initial)}</span>
    <div class="ph-text"><strong class="ph-name">${esc(user.name)}</strong><span class="ph-meta">${esc(user.email)} · ${t('profile.since', { d: since })}</span></div>
    ${user.role === 'admin' ? `<a class="btn" href="/admin/">${t('profile.admin')}</a>` : ''}`;
}
renderHero();

// การ์ดสรุปบัญชี (bento) — กดแล้วไปแท็บที่เกี่ยวข้อง
async function renderStats() {
  const box = $('#stats');
  const s = await api('/me/summary').catch(() => null);
  if (!s) { box.hidden = true; return; }
  const tile = (tab, label, val, sub = '', cls = '') => `<button class="tile stat-tile ${cls}" type="button" data-goto="${tab}">
      <span class="tile-label">${label}</span><span class="stat-val">${val}</span>${sub ? `<span class="stat-sub">${sub}</span>` : ''}</button>`;
  box.innerHTML = [
    tile('orders', t('profile.stat.orders'), s.orders, s.pendingOrders ? t('profile.stat.pending', { n: s.pendingOrders }) : ''),
    tile('library', t('profile.stat.library'), s.library),
    tile('wishlist', t('profile.stat.wishlist'), s.wishlist),
    tile('info', t('profile.stat.account'), s.emailVerified ? `✓ ${t('profile.stat.verified')}` : t('profile.stat.unverified'), '', s.emailVerified ? 'ok' : 'warn'),
  ].join('');
  box.removeAttribute('aria-busy');
  box.onclick = (e) => { const b = e.target.closest('[data-goto]'); if (b) goTo(b.dataset.goto); };
}
renderStats();
show(location.hash.slice(1)).finally(markReady);
