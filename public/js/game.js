import { markReady, api, descOf, cart, cardHtml, remember, priceHtml, esc, $, t, user, loginUrl, genreName, heartHtml, renderHearts, toast, lang, money, recordView } from './common.js';
import { splitWords } from './kinetic.js';
import { prefersReducedMotion } from './motion.js';
import { initScrollFx } from './scroll-fx.js';
import { mountGameWorld } from './game-world.js';

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

// มาจากการกดการ์ดเกม (view transition ข้ามหน้า): รอภาพปกขยายเสร็จก่อนแทนที่ skeleton ไม่งั้นภาพที่กำลังขยายจะหายกลางทาง
if (game && window.__revealTransition) await window.__revealTransition.finished.catch(() => {});

if (game) {
  const g = game;
  remember([g, ...g.related]);
  recordView(g.slug, g.genre);
  const specsContent = g.spec_min || g.spec_rec ? `
    <div class="bento-card sys-req">
      <div class="bento-label">${t('game.specs')}</div>
      <div class="specs">
        ${g.spec_min ? `<div><strong>${t('game.min')}</strong><p>${esc(g.spec_min)}</p></div>` : ''}
        ${g.spec_rec ? `<div><strong>${t('game.rec')}</strong><p>${esc(g.spec_rec)}</p></div>` : ''}
      </div>
    </div>` : '';

  const trailer = g.trailer_url ? `<div class="reveal-scroll"><iframe class="trailer" src="${esc(g.trailer_url)}" title="${t('game.trailer')}" allowfullscreen loading="lazy"></iframe></div>` : '';
  const story = storyHtml(g);
  const firstSentence = (descOf(g).match(/^.+?[.!?。](\s|$)/)?.[0] ?? descOf(g)).trim();

  $('#detail').innerHTML = `
    <!-- โลกของเกมเต็มจอ (js/game-world.js): ฉากของเกม → ลำแสง → ละออง → หมอก — fixed หลังเนื้อหาทั้งหมด -->
    <div class="game-world" id="gameWorld" aria-hidden="true"><div class="gw-layer gw-far"></div><div class="gw-layer gw-rays"></div><div class="gw-layer gw-dust"></div><div class="gw-fog"></div></div>
    <!-- parallax 3 ชั้น: ฉากหลังเบลอ (ช้าสุด) → แสงสีของเกม → กล่องเกม (เร็วกว่าเนื้อหา) -->
    <div class="game-backdrop" id="gameBackdrop"></div>
    <div class="game-glow" aria-hidden="true"></div>
    <div class="detail-hero">
      <div class="detail-cover-wrap">
        <div class="box-float">
          <div class="game-box" id="gameBox">
            <img class="detail-cover box-front" src="${esc(g.cover)}" alt="${esc(g.title)}" width="400" height="300">
            <span class="box-spine" aria-hidden="true"><span>${esc(g.title)}</span></span>
            <span class="box-glare" aria-hidden="true"></span>
          </div>
        </div>
        <span class="box-shadow" aria-hidden="true"></span>
        ${heartHtml(g.id)}
      </div>
      <div class="detail-hero-content">
        <ul class="meta-chips">
          <li><a class="chip" href="/games.html?genre=${encodeURIComponent(g.genre)}">${esc(genreName(g.genre))}</a></li>
          <li><a class="chip" href="/games.html?platform=${encodeURIComponent(g.platform)}">${esc(g.platform)}</a></li>
          <li><a class="chip" href="#reviews">★ <span id="ratingChip">${g.rating}</span></a></li>
        </ul>
        <h1 id="gameTitle">${esc(g.title)}</h1>
        <p class="hero-tagline">${esc(firstSentence)}</p>
        <div class="price-row big-price">
          <span class="price">${priceHtml(g)}${g.discount ? ` <span class="badge inline">-${g.discount}%</span>` : ''}</span>
          ${g.discount ? `<span class="save">${t('game.save', { amount: money(g.price - g.finalPrice) })}</span>` : ''}
        </div>
        <div class="buy-actions">
          <button class="btn primary big add-btn" id="addBtn" type="button">${t('game.add')}</button>
          ${story ? `<a class="btn big" href="#shots">${t('game.seeShots')} ↓</a>` : ''}
        </div>
        <p class="hero-note">${t('game.instant')}</p>
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

    ${story}
    ${trailer}
    <div class="reveal-scroll"><section id="reviews" class="reviews"></section></div>
    ${g.related.length ? `<div class="reveal-scroll"><h2 class="sec">${t('game.related')}</h2><div class="grid">${g.related.map(cardHtml).join('')}</div></div>` : ''}

    <div class="sticky-cta-spacer"></div>
    <div class="sticky-cta" id="stickyCta" aria-hidden="true">
      <img class="sticky-cta-cover" src="${esc(g.cover)}?size=sm" alt="" width="64" height="48">
      <div class="sticky-cta-info">
        <div class="sticky-cta-title">${esc(g.title)}</div>
        <div class="sticky-cta-price">${priceHtml(g)}</div>
      </div>
      <button class="btn primary add-btn" id="stickyAddBtn" type="button" tabindex="-1">${t('game.add')}</button>
    </div>`;

  $('#gameBackdrop').style.backgroundImage = `url('${g.cover}')`;
  const spine = $('.box-spine');
  spine.style.setProperty('--c1', g.color1);
  spine.style.setProperty('--c2', g.color2);
  $('.game-glow').style.setProperty('--glow', g.color1);
  mountGameWorld($('#gameWorld'), g);

  initBuyButtons(g);
  initStickyCta();
  initKineticTitle();
  initBoxTilt();
  if (story) initStory(g);
  // .reveal-scroll ค่อย ๆ ปรากฏตามการเลื่อนด้วย CSS (story.css) — เบราว์เซอร์ที่ไม่รองรับแสดงทันที ไม่ต้องใช้ JS
  renderHearts();
  initReviews(g);
}

// ---- ภาพในเกมแบบเล่าเรื่องตามการเลื่อน: แต่ละภาพเป็น "บท" มีหัวข้อ/คำบรรยายจากข้อมูลเกมจริง ----
function chapters(g) {
  const date = new Date(g.release_date).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-US', { year: 'numeric', month: 'long' });
  const texts = [
    [t('game.ch1Title', { title: g.title }), (descOf(g).match(/^.+?[.!?。](\s|$)/)?.[0] ?? descOf(g)).trim()],
    [t('game.ch2Title', { genre: genreName(g.genre), platform: g.platform }), t('game.ch2Text', { rating: g.rating, date })],
    [t('game.ch3Title'), t('game.delivery1')],
  ];
  return g.images.map((src, i) => ({ src, title: texts[i]?.[0] ?? t('game.shotN', { n: i + 1 }), text: texts[i]?.[1] ?? '' }));
}

function storyHtml(g) {
  if (!g.images?.length) return '';
  const list = chapters(g);
  const n = list.length;
  const alt = (i) => t('game.shotOf', { n: i + 1, total: n }) + ' – ' + g.title;
  return `
    <section class="shots-story reveal-scroll" id="shots" aria-labelledby="shotsTitle">
      <h2 class="sec" id="shotsTitle">${t('game.shots')}</h2>
      <div class="shots-layout">
        <div class="shots-stage-wrap" aria-hidden="true">
          <div class="shots-stage">
            ${list.map((c, i) => `<img class="stage-img${i ? '' : ' is-active'}" src="${esc(c.src)}" alt="" loading="lazy" width="1280" height="720">`).join('')}
          </div>
          <div class="shots-meta">
            <span class="shots-counter"><b id="shotNow">01</b> / ${String(n).padStart(2, '0')}</span>
            <span class="shots-bar">${list.map((_, i) => `<i${i ? '' : ' class="is-active"'}></i>`).join('')}</span>
          </div>
        </div>
        <ol class="shots-steps">
          ${list.map((c, i) => `
            <li class="shot-step${i ? '' : ' is-active'}" data-i="${i}">
              <button class="shot-open" type="button" data-i="${i}" aria-label="${esc(t('game.enlarge'))}: ${esc(alt(i))}">
                <img src="${esc(c.src)}" alt="${esc(alt(i))}" loading="lazy" width="1280" height="720">
              </button>
              <span class="shot-num">${String(i + 1).padStart(2, '0')}</span>
              <h3>${esc(c.title)}</h3>
              ${c.text ? `<p>${esc(c.text)}</p>` : ''}
            </li>`).join('')}
        </ol>
      </div>
    </section>`;
}

function initStory(g) {
  const steps = [...document.querySelectorAll('.shot-step')];
  const stage = [...document.querySelectorAll('.stage-img')];
  const bar = [...document.querySelectorAll('.shots-bar i')];
  const now = $('#shotNow');
  let active = 0;
  const setActive = (i) => {
    if (i === active) return;
    active = i;
    steps.forEach((s, j) => s.classList.toggle('is-active', j === i));
    stage.forEach((s, j) => s.classList.toggle('is-active', j === i));
    bar.forEach((s, j) => s.classList.toggle('is-active', j === i));
    now.textContent = String(i + 1).padStart(2, '0');
  };
  // บทปัจจุบัน = บทที่ครอบกลางจอ (แบบเดียวกับ "ซื้อง่ายใน 3 ขั้น" หน้าแรก) — desktop เท่านั้น มือถือเป็นแถวปัดแนวนอน
  const wide = matchMedia('(min-width: 901px)');
  const pick = () => {
    if (!wide.matches) return;
    const mid = innerHeight / 2;
    let best = 0;
    let bestDist = Infinity;
    steps.forEach((s, i) => {
      const r = s.getBoundingClientRect();
      const d = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
      if (d < bestDist) { bestDist = d; best = i; }
    });
    setActive(best);
  };
  addEventListener('scroll', pick, { passive: true });
  wide.addEventListener('change', pick);
  pick();

  const lightbox = createLightbox(g.images, g.title);
  document.querySelector('.shots-steps').addEventListener('click', (e) => {
    const btn = e.target.closest('.shot-open');
    if (btn) lightbox.open(+btn.dataset.i);
  });
}

// ดูภาพขนาดเต็ม: <dialog> (Esc ปิด, คืนโฟกัสให้ปุ่มที่กด, ลูกศรซ้าย/ขวาเปลี่ยนภาพ, คลิกพื้นหลังปิด)
function createLightbox(images, title) {
  const dlg = document.createElement('dialog');
  dlg.className = 'lightbox';
  dlg.setAttribute('aria-label', t('game.shots'));
  dlg.innerHTML = `
    <figure><img alt=""><figcaption aria-live="polite"></figcaption></figure>
    <button class="lb-btn lb-prev" type="button" aria-label="${t('game.prev')}">‹</button>
    <button class="lb-btn lb-next" type="button" aria-label="${t('game.next')}">›</button>
    <button class="lb-btn lb-close" type="button" aria-label="${t('game.close')}">✕</button>`;
  document.body.append(dlg);
  const img = dlg.querySelector('img');
  const cap = dlg.querySelector('figcaption');
  let i = 0;
  const show = (n) => {
    i = (n + images.length) % images.length;
    img.src = images[i];
    img.alt = `${t('game.shotOf', { n: i + 1, total: images.length })} – ${title}`;
    cap.textContent = t('game.shotOf', { n: i + 1, total: images.length });
  };
  dlg.querySelector('.lb-prev').onclick = () => show(i - 1);
  dlg.querySelector('.lb-next').onclick = () => show(i + 1);
  dlg.querySelector('.lb-close').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(i - 1);
    if (e.key === 'ArrowRight') show(i + 1);
  });
  const single = images.length < 2;
  dlg.querySelector('.lb-prev').hidden = single;
  dlg.querySelector('.lb-next').hidden = single;
  return { open(n) { show(n); dlg.showModal(); } };
}

// ---- ปุ่มซื้อ: สถานะ "อยู่ในตะกร้าแล้ว" ตรงกับตะกร้าจริงเสมอ (ทั้งปุ่มใน hero และแถบซื้อด้านล่าง) ----
function initBuyButtons(g) {
  const btns = [...document.querySelectorAll('.add-btn')];
  const sync = () => {
    const inCart = cart.get().some((i) => i.slug === g.slug);
    for (const b of btns) {
      b.classList.toggle('in-cart', inCart);
      b.textContent = inCart ? t('game.inCart') : t('game.add');
    }
  };
  for (const b of btns) {
    b.addEventListener('click', (e) => {
      if (b.classList.contains('in-cart')) { location.href = '/cart'; return; } // อยู่ในตะกร้าแล้ว → ไปหน้าตะกร้า
      cart.add(g, e);
    });
  }
  document.addEventListener('cart:change', sync);
  sync();
}

// แถบซื้อลอยด้านล่าง (กระจก): โผล่เมื่อปุ่มซื้อใน hero เลื่อนพ้นจอ ซ่อนเมื่อกลับมาเห็นปุ่มเดิม (ไม่มีปุ่มซื้อซ้ำสองที่บนจอ)
function initStickyCta() {
  const bar = $('#stickyCta');
  const btn = $('#stickyAddBtn');
  new IntersectionObserver(([e]) => {
    const show = !e.isIntersecting && e.boundingClientRect.top < 0;
    bar.classList.toggle('is-shown', show);
    bar.setAttribute('aria-hidden', String(!show));
    btn.tabIndex = show ? 0 : -1;
  }).observe($('#addBtn'));
}

// ชื่อเกมลอยขึ้นทีละคำ (CSS animation — หน้านี้ไม่โหลด GSAP); ขอลดการเคลื่อนไหว = แสดงทันที
function initKineticTitle() {
  if (prefersReducedMotion()) return;
  const words = splitWords($('#gameTitle'), { locale: lang });
  words.forEach((w, i) => w.style.setProperty('--i', i));
  $('#gameTitle').classList.add('kt-in');
}

// กล่องเกม 3 มิติ (CSS 3D — ไม่ต้องโหลด WebGL): เอียงตามเมาส์ + แสงสะท้อน เฉพาะอุปกรณ์ที่มีเมาส์ และไม่ได้ขอลดการเคลื่อนไหว
function initBoxTilt() {
  if (prefersReducedMotion() || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const wrap = $('.detail-cover-wrap');
  const box = $('#gameBox');
  let frame = 0;
  let pt = null;
  const apply = () => {
    frame = 0;
    if (!pt) return;
    const r = wrap.getBoundingClientRect();
    const x = (pt.x - r.left) / r.width - 0.5;
    const y = (pt.y - r.top) / r.height - 0.5;
    box.style.setProperty('--ry', `${(18 + x * 22).toFixed(1)}deg`);
    box.style.setProperty('--rx', `${(-y * 14).toFixed(1)}deg`);
    box.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(0)}%`);
    box.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(0)}%`);
  };
  wrap.addEventListener('pointermove', (e) => { pt = { x: e.clientX, y: e.clientY }; frame ||= requestAnimationFrame(apply); });
  wrap.addEventListener('pointerleave', () => {
    pt = null;
    for (const p of ['--ry', '--rx', '--gx', '--gy']) box.style.removeProperty(p);
  });
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
    $('#ratingChip').textContent = data.count ? data.average : g.rating;
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
