import { renderKeys } from './keys-ui.js';
import { markReady, api, $, esc, t, user, loginUrl, cardHtml, remember, toast, money, fmtDateTime } from './common.js';

if (!user) { location.replace(loginUrl()); throw new Error('redirect'); }

const panel = $('#panel');
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
        <p class="msg" id="msg" role="alert"></p>
        <button class="btn primary" type="submit">${t('common.save')}</button>
      </form>`;
    $('#infoForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api('/me', { method: 'PUT', body: { name: f.name.value, email: f.email.value } });
        $('#msg').classList.add('ok');
        $('#msg').textContent = t('profile.saved');
        setTimeout(() => location.reload(), 600);
      } catch (err) { $('#msg').classList.remove('ok'); $('#msg').textContent = err.message; }
    };
  },
  password() {
    panel.innerHTML = `
      <form id="pwForm" class="auth-form">
        <label><span>${t('profile.currentPassword')}</span><input name="cur" type="password" required autocomplete="current-password"></label>
        <label><span>${t('auth.newPassword')}</span><input name="next" type="password" required minlength="8" maxlength="72" autocomplete="new-password"></label>
        <small>${t('auth.passwordHint')}</small>
        <p class="msg" id="msg" role="alert"></p>
        <button class="btn primary" type="submit">${t('common.save')}</button>
      </form>`;
    $('#pwForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const msg = $('#msg');
      if (f.next.value.length < 8) { msg.classList.remove('ok'); msg.textContent = t('auth.shortPassword'); return; }
      try {
        await api('/me/password', { method: 'POST', body: { currentPassword: f.cur.value, newPassword: f.next.value } });
        f.reset();
        msg.classList.add('ok');
        msg.textContent = t('profile.passwordChanged');
      } catch (err) { msg.classList.remove('ok'); msg.textContent = err.message; }
    };
  },
  async orders(page = 1) {
    const data = await api('/me/orders?page=' + page);
    if (!data.items.length) { panel.innerHTML = `<p class="empty">${t('profile.noOrders')}</p>`; return; }
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
    if (!items.length) { panel.innerHTML = `<p class="empty">${t('profile.noLibrary')}</p>`; return; }
    panel.innerHTML = `<div class="order-list">${items.map((g, i) => `
      <div class="order-row lib-row">
        <img class="thumb" src="${esc(g.cover)}" alt="">
        <div class="grow"><a href="/game/${esc(g.slug)}"><strong>${esc(g.title)}</strong></a>
          <div class="meta">${esc(g.platform)} • ${t('profile.purchased')} ${fmtDateTime(g.purchasedAt)}</div></div>
        <div class="keys full" id="lib-keys-${i}"></div>
      </div>`).join('')}</div>`;
    items.forEach((g, i) => renderKeys($('#lib-keys-' + i), g.keys));
  },
  async wishlist() {
    const { items } = await api('/wishlist');
    remember(items);
    panel.innerHTML = items.length ? `<div class="grid">${items.map(cardHtml).join('')}</div>` : `<p class="empty">${t('profile.noWishlist')}</p>`;
  },
};

async function show(name) {
  if (!views[name]) name = 'info';
  tabs.forEach((b) => { const on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  panel.onclick = null;
  panel.innerHTML = `<p class="empty">${t('common.loading')}</p>`;
  try { await views[name](); } catch (e) { panel.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}

tabs.forEach((b) => b.addEventListener('click', () => { history.replaceState(null, '', '#' + b.dataset.tab); show(b.dataset.tab); }));
show(location.hash.slice(1)).finally(markReady);
