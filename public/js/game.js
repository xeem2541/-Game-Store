import { markReady, api, descOf, cart, cardHtml, remember, priceHtml, esc, $, t, user, loginUrl, genreName, heartHtml, renderHearts, toast, lang } from './common.js';

const slug = $('#detail').dataset.slug;
const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
const fmtDate = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-US');

let game;
try {
  game = await api('/games/' + encodeURIComponent(slug));
} catch {
  $('#detail').innerHTML = `<p class="empty">${t('game.notfound')} <a href="/games.html">${t('game.back')}</a></p>`;
}

if (game) {
  const g = game;
  remember([g, ...g.related]);
  const specs = g.spec_min || g.spec_rec ? `
    <h2 class="sec">${t('game.specs')}</h2>
    <div class="specs">
      ${g.spec_min ? `<div><h3>${t('game.min')}</h3><p>${esc(g.spec_min)}</p></div>` : ''}
      ${g.spec_rec ? `<div><h3>${t('game.rec')}</h3><p>${esc(g.spec_rec)}</p></div>` : ''}
    </div>` : '';
  const trailer = g.trailer_url ? `<iframe class="trailer" src="${esc(g.trailer_url)}" title="${t('game.trailer')}" allowfullscreen loading="lazy"></iframe>` : '';

  const shots = g.images?.length ? `<div class="shots">${g.images.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="${esc(g.title)}" loading="lazy"></a>`).join('')}</div>` : '';

  $('#detail').innerHTML = `
    <div class="detail">
      <div class="detail-cover-wrap">
        <img class="detail-cover" src="${esc(g.cover)}" alt="${esc(g.title)}" width="400" height="300">
        ${heartHtml(g.id)}
      </div>
      <div class="detail-info">
        <h1>${esc(g.title)}</h1>
        <div class="meta">${esc(genreName(g.genre))} • ${esc(g.platform)} • ⭐ <span id="ratingNow">${g.rating}</span> <span id="ratingCount"></span> • ${t('game.release')} ${esc(g.release_date)}</div>
        <p>${esc(descOf(g))}</p>
        <div class="price-row big-price">
          <span class="price">${priceHtml(g)}${g.discount ? ` <span class="badge inline">-${g.discount}%</span>` : ''}</span>
        </div>
        <button class="btn primary big" id="addBtn" type="button">${t('game.add')}</button>
      </div>
    </div>
    ${trailer}
    ${shots}
    ${specs}
    <section id="reviews" class="reviews"></section>
    ${g.related.length ? `<h2 class="sec">${t('game.related')}</h2><div class="grid">${g.related.map(cardHtml).join('')}</div>` : ''}`;
  $('#addBtn').onclick = () => cart.add(g);
  renderHearts();
  initReviews(g);
}

async function initReviews(g) {
  const root = $('#reviews');
  const base = `/games/${g.id}/reviews`;
  let page = 1;
  let mine = null;

  const reviewHtml = (r) => `
    <article class="review ${r.mine ? 'mine' : ''}">
      <div class="review-head"><strong>${esc(r.name)}</strong>${r.mine ? ` <span class="tag">${t('reviews.mine')}</span>` : ''}
        <span class="stars" aria-label="${r.rating}/5">${stars(r.rating)}</span><small>${fmtDate(r.updated_at)}</small></div>
      ${r.body ? `<p>${esc(r.body)}</p>` : ''}
    </article>`;

  function formHtml() {
    if (!user) return `<p><a class="btn" href="${esc(loginUrl())}">${t('reviews.loginToReview')}</a></p>`;
    return `
    <form id="reviewForm" class="review-form">
      <label>${t('reviews.yourRating')}
        <select name="rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${mine?.rating === n ? 'selected' : ''}>${stars(n)} (${n})</option>`).join('')}</select>
      </label>
      <label>${t('reviews.comment')}
        <textarea name="body" rows="3" maxlength="2000">${esc(mine?.body ?? '')}</textarea>
      </label>
      <p id="reviewMsg" class="msg" role="alert"></p>
      <div class="row">
        <button class="btn primary" type="submit">${mine ? t('reviews.update') : t('reviews.submit')}</button>
        ${mine ? `<button class="btn danger" type="button" id="delReview">${t('reviews.delete')}</button>` : ''}
      </div>
    </form>`;
  }

  async function load(reset = true) {
    if (reset) page = 1;
    const data = await api(`${base}?page=${page}`);
    if (reset) mine = data.mine;
    if (reset) {
      root.innerHTML = `
        <h2 class="sec">${t('reviews.title')} <small id="revSummary"></small></h2>
        <div id="formBox"></div>
        <div id="revList"></div>
        <button class="btn" id="moreRev" type="button" hidden>${t('reviews.more')}</button>`;
      $('#moreRev').onclick = () => { page += 1; load(false); };
    }
    $('#formBox').innerHTML = reset ? formHtml() : $('#formBox').innerHTML;
    $('#revSummary').textContent = data.count ? `⭐ ${data.average} • ${t('reviews.count', { n: data.count })}` : '';
    $('#ratingNow').textContent = data.count ? data.average : g.rating;
    $('#ratingCount').textContent = data.count ? `(${data.count})` : '';
    const list = $('#revList');
    if (reset) list.innerHTML = '';
    list.insertAdjacentHTML('beforeend', data.items.map(reviewHtml).join(''));
    if (!data.count) list.innerHTML = `<p class="empty">${t('reviews.none')}</p>`;
    $('#moreRev').hidden = page >= data.pages;
    if (reset) bindForm();
  }

  function bindForm() {
    const form = $('#reviewForm');
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await api(base, { method: mine ? 'PUT' : 'POST', body: { rating: +fd.get('rating'), body: fd.get('body') } });
        toast(t('reviews.saved'));
        await load();
      } catch (err) { $('#reviewMsg').textContent = err.message; }
    };
    $('#delReview')?.addEventListener('click', async () => {
      if (!confirm(t('reviews.confirmDelete'))) return;
      await api(base, { method: 'DELETE' }).catch(() => {});
      toast(t('reviews.deleted'));
      await load();
    });
  }

  await load();
}
markReady();
