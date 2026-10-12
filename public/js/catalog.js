import { markReady, api, cardHtml, remember, $, esc, t, genreName, emptyArt, lang } from './common.js';
import { prefersReducedMotion } from './motion.js';
import { splitWords } from './kinetic.js';
import { initScrollFx } from './scroll-fx.js';

initScrollFx(); // parallax ของแสงพื้นหลัง (สำรองสำหรับเบราว์เซอร์ที่ไม่รองรับ CSS scroll-driven animation)

const form = $('#filters');
const grid = $('#grid');
const bento = $('#genreBento');
const chipsBox = $('#activeFilters');
const heading = $('#catalogTitle > span');
const FIELDS = ['q', 'genre', 'platform', 'minPrice', 'maxPrice', 'onSale', 'sort'];

// หัวข้อบอกคำค้น — ตั้งก่อนรอข้อมูลใด ๆ (ทำงานต่อจากการใส่คำแปลทันที ก่อนเบราว์เซอร์วาดหน้า จึงไม่กระพริบ/ไม่ขยับ)
// ผลการค้นหา: ซ่อนช่องแนวเกม (หน้าผลค้นหาเน้นผลลัพธ์)
const setHeading = (q) => {
  const text = q ? t('catalog.results', { q }) : t('catalog.title');
  document.body.classList.toggle('is-search', Boolean(q));
  heading.parentElement.classList.toggle('is-search', Boolean(q));
  if (heading.dataset.text === text) return;
  heading.dataset.text = text;
  heading.textContent = text;
  delete heading.dataset.split;
};
setHeading(new URLSearchParams(location.search).get('q'));
// Kinetic typography: หัวข้อ "เกมทั้งหมด" ลอยขึ้นทีละคำ (ผลการค้นหาแสดงทันที — ผู้ใช้กำลังรอผล ไม่ใช่ดูแอนิเมชัน)
if (!document.body.classList.contains('is-search') && !prefersReducedMotion()) {
  splitWords(heading, { locale: lang }).forEach((w, i) => w.style.setProperty('--i', i));
  heading.parentElement.classList.add('kt-in');
}

// state ทั้งหมดอยู่ใน URL เพื่อแชร์ลิงก์/กดย้อนกลับได้
function readUrl() {
  const p = new URLSearchParams(location.search);
  for (const f of FIELDS) {
    const el = form.elements[f];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = p.get(f) === '1';
    else el.value = p.get(f) ?? (f === 'sort' ? 'default' : '');
  }
  return p;
}

function writeUrl(page = 1, { dropQ = false } = {}) {
  const q = new URLSearchParams(location.search).get('q');
  const next = new URLSearchParams();
  if (q && !dropQ) next.set('q', q);
  for (const f of FIELDS) {
    const el = form.elements[f];
    if (!el) continue;
    const v = el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value;
    if (v && v !== 'default') next.set(f, v);
  }
  if (page > 1) next.set('page', page);
  history.pushState(null, '', next.toString() ? `?${next}` : location.pathname);
  load();
}

// ---- ช่องแนวเกมแบบ bento: แนวที่มีเกมมากสุดเป็นช่องใหญ่ ที่เหลือช่องเล็ก + "ทุกแนว" — กดเพื่อกรอง กดซ้ำเพื่อยกเลิก ----
let genreStats = [];
function renderBento() {
  bento.hidden = genreStats.length === 0; // ร้านยังไม่มีเกม: ไม่แสดงช่อง "ทุกแนว 0 เกม" ช่องเดียวโดด ๆ
  const current = form.elements.genre.value;
  const total = genreStats.reduce((n, g) => n + g.count, 0);
  const tiles = [...genreStats, { genre: '', count: total }];
  bento.innerHTML = tiles.map((g, i) => `
    <button type="button" class="genre-tile${i === 0 ? ' is-big' : ''}${g.genre ? '' : ' is-all'}" data-genre="${esc(g.genre)}" aria-pressed="${g.genre === current}">
      ${g.slug ? `<img src="/api/games/${esc(g.slug)}/scene.svg" alt="" loading="lazy" decoding="async" width="800" height="600">` : ''}
      <span class="gt-name">${esc(g.genre ? genreName(g.genre) : t('catalog.allGenres'))}</span>
      <span class="gt-count">${esc(t('catalog.gamesN', { n: g.count }))}</span>
    </button>`).join('');
}
const syncBento = () => {
  const current = form.elements.genre.value;
  for (const b of bento.querySelectorAll('.genre-tile')) b.setAttribute('aria-pressed', String(b.dataset.genre === current));
};
bento.addEventListener('click', (e) => {
  const tile = e.target.closest('.genre-tile');
  if (!tile) return;
  const g = tile.dataset.genre;
  form.elements.genre.value = form.elements.genre.value === g ? '' : g;
  writeUrl();
});

// ---- ตัวกรองที่ใช้อยู่เป็นป้าย กด ✕ เพื่อลบทีละตัว (เห็นชัดกว่าการดูค่าใน select ทีละช่อง) ----
const baht = (v) => Number(v).toLocaleString(lang === 'th' ? 'th-TH' : 'en-US');
function renderChips(p) {
  const chips = [];
  if (p.get('q')) chips.push(['q', t('filter.search', { q: p.get('q') })]);
  if (p.get('genre')) chips.push(['genre', genreName(p.get('genre'))]);
  if (p.get('platform')) chips.push(['platform', p.get('platform')]);
  const [min, max] = [p.get('minPrice'), p.get('maxPrice')];
  if (min || max) chips.push(['price', min && max ? t('filter.priceRange', { min: baht(min), max: baht(max) }) : min ? t('filter.priceFrom', { min: baht(min) }) : t('filter.priceTo', { max: baht(max) })]);
  if (p.get('onSale') === '1') chips.push(['onSale', t('filter.onSale')]);
  chipsBox.innerHTML = chips.map(([key, label]) => `
    <button type="button" class="filter-chip" data-clear="${key}" aria-label="${esc(t('filter.remove', { label }))}">
      <span>${esc(label)}</span><svg class="icon" aria-hidden="true" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>`).join('')
    + (chips.length > 1 ? `<button type="button" class="filter-chip is-clear" data-clear="all">${esc(t('filter.clearAll'))}</button>` : '');
  chipsBox.hidden = chips.length === 0;
  $('#filtersCount').textContent = chips.length ? String(chips.length) : '';
}

// มือถือ: ตัวกรองเป็นแผงเลื่อนขึ้นจากล่างจอ (<dialog> modal — เบราว์เซอร์กักโฟกัส/Esc ปิด/คืนโฟกัสให้เอง)
// ฟอร์มเดียวกับจอกว้าง ปรับค่าแล้วกรองทันที ปุ่มล่างบอกจำนวนเกมที่เจอ; ปิดได้ด้วย ✕ / ปุ่มล่าง / กดพื้นหลัง / ลากลงด้วยนิ้ว
const sheet = $('#filterSheet');
const toggle = $('#filtersToggle');
const done = $('#filtersDone');
const mobile = matchMedia('(max-width: 640px)');
function finishClose() {
  sheet.classList.remove('is-closing');
  sheet.style.removeProperty('transform');
  sheet.style.removeProperty('transition');
  sheet.close();
}
function closeSheet({ instant = false } = {}) {
  if (!sheet.open || sheet.classList.contains('is-closing')) return;
  if (instant || prefersReducedMotion()) { finishClose(); return; }
  sheet.classList.add('is-closing');
  let ended = false;
  const end = (e) => { if (ended || (e && e.target !== sheet)) return; ended = true; sheet.removeEventListener('animationend', end); finishClose(); };
  sheet.addEventListener('animationend', end);
  setTimeout(end, 400); // สำรอง: ไม่มี animationend (แท็บอยู่เบื้องหลัง ฯลฯ)
}
toggle.addEventListener('click', () => {
  if (!mobile.matches) return;
  document.documentElement.classList.add('sheet-open');
  sheet.showModal();
  form.elements.genre.focus();
});
$('#filtersClose').addEventListener('click', () => closeSheet());
done.addEventListener('click', () => closeSheet());
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); }); // กดพื้นหลังนอกแผง
sheet.addEventListener('close', () => document.documentElement.classList.remove('sheet-open'));
mobile.addEventListener('change', () => { if (!mobile.matches) closeSheet({ instant: true }); }); // หมุนจอ/ขยายหน้าต่างจนเป็นจอกว้าง: ฟอร์มกลับไปอยู่ในหน้า
// ลากแถบจับ/หัวแผงลง (นิ้วเท่านั้น): เกิน 25% ของความสูง = ปิด ไม่ถึง = เด้งกลับ
let drag = null;
for (const handle of sheet.querySelectorAll('.fs-grip, .fs-head')) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || e.target.closest('.fs-close')) return;
    drag = { y: e.clientY, dy: 0, id: e.pointerId };
    handle.setPointerCapture?.(e.pointerId);
    sheet.style.transition = 'none';
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dy = Math.max(0, e.clientY - drag.y);
    sheet.style.transform = `translateY(${drag.dy}px)`;
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const far = drag.dy > sheet.offsetHeight * 0.25;
    drag = null;
    if (far) { finishClose(); return; }
    sheet.style.removeProperty('transition'); // กลับมาใช้ transition ของแผง → เด้งกลับที่เดิม
    sheet.style.removeProperty('transform');
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
}
chipsBox.addEventListener('click', (e) => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  const key = chip.dataset.clear;
  const index = [...chipsBox.children].indexOf(chip);
  if (key === 'all') { form.reset(); return; }
  if (key === 'price') { form.elements.minPrice.value = ''; form.elements.maxPrice.value = ''; }
  else if (key === 'onSale') form.elements.onSale.checked = false;
  else if (key !== 'q') form.elements[key].value = '';
  writeUrl(1, { dropQ: key === 'q' });
  // ป้ายที่กดหายไป → โฟกัสป้ายถัดไป (หรือช่องแนวเกมเมื่อไม่เหลือตัวกรอง) ไม่ให้โฟกัสหลุดไปต้นหน้า
  requestAnimationFrame(() => (chipsBox.children[Math.min(index, chipsBox.children.length - 1)] ?? form.elements.genre).focus());
});

// ---- ผลลัพธ์: การ์ดค่อย ๆ ขึ้นทีละใบ; เปลี่ยนตัวกรอง/เรียงลำดับ = การ์ดเลื่อนไปตำแหน่งใหม่ (View Transitions) ----
const canMorph = () => typeof document.startViewTransition === 'function' && !prefersReducedMotion();
function paintResults(data, q) {
  // ข้อความ "ไม่พบครบทุกคำ" อยู่ในกริดเดียวกับการ์ด (เข้ามาพร้อมผลลัพธ์ ไม่ดันเนื้อหาที่แสดงอยู่แล้ว)
  grid.innerHTML = (data.relaxed ? `<p class="search-note" role="status">${esc(t('catalog.relaxed'))}</p>` : '') + data.items.map(cardHtml).join('');
  remember(data.items); // หลังใส่การ์ดใหม่: ระบายหัวใจ (wishlist) ให้การ์ดชุดนี้ + ให้ปุ่มเพิ่มตะกร้าหาข้อมูลเกมเจอ
  // การ์ดเกมเดียวกันเลื่อนจากที่เดิมไปที่ใหม่ (การ์ดค่อย ๆ ขึ้นทีละใบตอนโหลดแรกมาจาก effects.css)
  grid.querySelectorAll('.card').forEach((c, i) => { c.style.viewTransitionName = `game-${data.items[i].slug}`; });
  $('#empty').innerHTML = emptyArt('no-results') + (q ? `<p>${esc(t('catalog.emptyQ', { q }))} <a href="/games.html">${esc(t('catalog.clear'))}</a></p>` : `<p>${esc(t('catalog.empty'))}</p>`);
  $('#empty').hidden = data.items.length > 0;
  const pages = Array.from({ length: data.pages }, (_, i) => i + 1);
  $('#pager').innerHTML = data.pages > 1
    ? pages.map((n) => `<button class="chip ${n === data.page ? 'active' : ''}" data-page="${n}" ${n === data.page ? 'aria-current="page"' : ''}>${n}</button>`).join('')
    : '';
}

let firstLoad = true;
let seq = 0;
async function load() {
  const p = readUrl();
  const mine = ++seq;
  renderChips(p);
  syncBento();
  grid.setAttribute('aria-busy', 'true');
  if (!firstLoad) grid.classList.add('is-loading');
  // ช่องกรองราคากรอกเป็นบาท → API รับสตางค์
  const query = new URLSearchParams(p);
  for (const k of ['minPrice', 'maxPrice']) if (query.get(k)) query.set(k, String(Math.round(Number(query.get(k)) * 100)));
  const data = await api('/games?' + query);
  if (mine !== seq) return; // ผู้ใช้เปลี่ยนตัวกรองอีกระหว่างรอ — ใช้ผลของคำขอล่าสุดเท่านั้น
  const q = p.get('q');
  setHeading(q);
  $('#count').textContent = t('catalog.count', { n: data.total });
  done.textContent = t('filter.show', { n: data.total }); // ปุ่มล่างของแผงตัวกรองมือถือ
  const paint = () => paintResults(data, q);
  if (!firstLoad && canMorph()) await document.startViewTransition(paint).updateCallbackDone;
  else paint();
  grid.classList.remove('is-loading');
  grid.setAttribute('aria-busy', 'false');
  firstLoad = false;
}

form.addEventListener('change', () => writeUrl());
form.addEventListener('reset', () => setTimeout(() => { history.pushState(null, '', location.pathname); load(); }));
$('#pager').addEventListener('click', (e) => {
  if (e.target.dataset.page) { writeUrl(+e.target.dataset.page); scrollTo({ top: 0 }); }
});
addEventListener('popstate', load);

renderChips(readUrl()); // ป้ายตัวกรองจาก URL แสดงพร้อมหน้าแรก (ไม่ขยับทีหลัง)
const facets = await api('/games/facets');
$('#genre').insertAdjacentHTML('beforeend', facets.genres.map((g) => `<option value="${esc(g)}">${esc(genreName(g))}</option>`).join(''));
$('#platform').insertAdjacentHTML('beforeend', facets.platforms.map((p) => `<option>${esc(p)}</option>`).join(''));
genreStats = facets.genreStats ?? [];
readUrl(); // ตัวเลือกแนว/แพลตฟอร์มเพิ่งเติม — ตั้งค่าจาก URL อีกครั้ง
renderBento();
load().finally(markReady);
