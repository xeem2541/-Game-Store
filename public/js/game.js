import { markReady, api, descOf, cart, cardHtml, remember, priceHtml, esc, $, t, user, loginUrl, genreName, heartHtml, renderHearts, toast, lang } from './common.js';
import { initScrollFx } from './scroll-fx.js';

initScrollFx(); // parallax / ค่อย ๆ ปรากฏ สำรองสำหรับเบราว์เซอร์ที่ไม่รองรับ CSS scroll-driven animation

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
  const specsContent = g.spec_min || g.spec_rec ? `
    <div class="bento-card sys-req">
      <div class="bento-label">${t('game.specs')}</div>
      <div class="specs">
        ${g.spec_min ? `<div><strong>${t('game.min')}</strong><p>${esc(g.spec_min)}</p></div>` : ''}
        ${g.spec_rec ? `<div><strong>${t('game.rec')}</strong><p>${esc(g.spec_rec)}</p></div>` : ''}
      </div>
    </div>` : '';

  const trailer = g.trailer_url ? `<div class="reveal-scroll"><iframe class="trailer" src="${esc(g.trailer_url)}" title="${t('game.trailer')}" allowfullscreen loading="lazy"></iframe></div>` : '';
  const shots = g.images?.length ? `<div class="shots reveal-scroll">${g.images.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="${esc(g.title)}" loading="lazy"></a>`).join('')}</div>` : '';

  $('#detail').innerHTML = `
    <div class="game-backdrop" id="gameBackdrop"></div>
    <div class="detail-hero">
      <div class="detail-cover-wrap">
        <img class="detail-cover" src="${esc(g.cover)}" alt="${esc(g.title)}" width="400" height="300">
        ${heartHtml(g.id)}
      </div>
      <div class="detail-hero-content">
        <h1>${esc(g.title)}</h1>
        <div class="price-row big-price">
          <span class="price">${priceHtml(g)}${g.discount ? ` <span class="badge inline">-${g.discount}%</span>` : ''}</span>
        </div>
        <button class="btn primary big" id="addBtn" type="button">${t('game.add')}</button>
      </div>
    </div>

    <!-- bento: ภาพรวม (2×2) + คะแนน วางจำหน่าย แนวเกม แพลตฟอร์ม + สเปก/การรับโค้ด -->
    <div class="game-bento-grid reveal-scroll">
      <div class="bento-card overview">
        <div class="bento-label">${t('game.overview')}</div>
        <p>${esc(descOf(g))}</p>
      </div>
      <a class="bento-card rating" href="#reviews">
        <div class="bento-label">${t('game.rating')}</div>
        <div class="bento-val">⭐ <span id="ratingNow">${g.rating}</span> <small id="ratingCount"></small></div>
        <span class="bento-hint">${t('game.toReviews')}</span>
      </a>
      <div class="bento-card release">
        <div class="bento-label">${t('game.release')}</div>
        <div class="bento-val">${esc(g.release_date)}</div>
      </div>
      <a class="bento-card genre" href="/games.html?genre=${encodeURIComponent(g.genre)}">
        <div class="bento-label">${t('game.genre')}</div>
        <div class="bento-val">${esc(genreName(g.genre))}</div>
      </a>
      <a class="bento-card dev" href="/games.html?platform=${encodeURIComponent(g.platform)}">
        <div class="bento-label">${t('game.platform')}</div>
        <div class="bento-val">${esc(g.platform)}</div>
      </a>
      ${specsContent}
      <div class="bento-card delivery">
        <div class="bento-label">${t('game.delivery')}</div>
        <ul><li>${t('game.delivery1')}</li><li>${t('game.delivery2')}</li><li>${t('game.delivery3', { platform: esc(g.platform) })}</li></ul>
      </div>
    </div>

    ${trailer}
    ${shots}
    <div class="reveal-scroll"><section id="reviews" class="reviews"></section></div>
    ${g.related.length ? `<div class="reveal-scroll"><h2 class="sec">${t('game.related')}</h2><div class="grid">${g.related.map(cardHtml).join('')}</div></div>` : ''}
    
    <div class="sticky-cta-spacer"></div>
    <div class="sticky-cta">
      <div class="sticky-cta-info">
        <div class="sticky-cta-title">${esc(g.title)}</div>
        <div class="sticky-cta-price">${priceHtml(g)}</div>
      </div>
      <button class="btn primary" id="stickyAddBtn" type="button">${t('game.add')}</button>
    </div>`;
  
  $('#addBtn').onclick = (e) => cart.add(g, e);
  const stickyBtn = $('#stickyAddBtn');
  if (stickyBtn) stickyBtn.onclick = (e) => cart.add(g, e);
  $('#gameBackdrop').style.backgroundImage = `url('${g.cover}')`;

  // .reveal-scroll ค่อย ๆ ปรากฏตามการเลื่อนด้วย CSS (story.css) — เบราว์เซอร์ที่ไม่รองรับแสดงทันที ไม่ต้องใช้ JS
  renderHearts();
  initReviews(g);
}

async function initReviews(g) {
  const root = $('#reviews');
  const base = `/games/${g.id}/reviews`;
  let page = 1;
  let mine = null;
  let canReview = false;

  const reviewHtml = (r) => `
    <article class="review ${r.mine ? 'mine' : ''}">
      <div class="review-head"><strong>${esc(r.name)}</strong>${r.verified ? ` <span class="tag">✓ ${t('reviews.verified')}</span>` : ''}${r.mine ? ` <span class="tag">${t('reviews.mine')}</span>` : ''}
        <span class="stars" aria-label="${r.rating}/5">${stars(r.rating)}</span><small>${fmtDate(r.updated_at)}</small></div>
      ${r.body ? `<p>${esc(r.body)}</p>` : ''}
    </article>`;

  function formHtml() {
    if (!user) return `<p><a class="btn" href="${esc(loginUrl())}">${t('reviews.loginToReview')}</a></p>`;
    if (!mine && !canReview) return `<p class="meta">${t('reviews.purchaseRequired')}</p>`; // รีวิวได้เฉพาะผู้ที่ซื้อแล้ว (มีรีวิวเดิมอยู่ยังแก้/ลบได้)
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
    if (reset) { mine = data.mine; canReview = data.canReview; }
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
