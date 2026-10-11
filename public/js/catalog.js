import { markReady, api, cardHtml, remember, $, esc, t, genreName, emptyArt } from './common.js';

const form = $('#filters');
const heading = $('h1.sec > span');
// หัวข้อบอกคำค้น — ตั้งก่อนรอข้อมูลใด ๆ (ทำงานต่อจากการใส่คำแปลทันที ก่อนเบราว์เซอร์วาดหน้า จึงไม่กระพริบ/ไม่ขยับ)
const setHeading = (q) => {
  heading.textContent = q ? t('catalog.results', { q }) : t('catalog.title');
  heading.parentElement.classList.toggle('is-search', Boolean(q));
};
setHeading(new URLSearchParams(location.search).get('q'));
const FIELDS = ['q', 'genre', 'platform', 'minPrice', 'maxPrice', 'onSale', 'sort'];

const facets = await api('/games/facets');
$('#genre').insertAdjacentHTML('beforeend', facets.genres.map((g) => `<option value="${esc(g)}">${esc(genreName(g))}</option>`).join(''));
$('#platform').insertAdjacentHTML('beforeend', facets.platforms.map((p) => `<option>${esc(p)}</option>`).join(''));

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

function writeUrl(page = 1) {
  const p = new URLSearchParams(location.search);
  const q = p.get('q');
  const next = new URLSearchParams();
  if (q) next.set('q', q);
  for (const f of FIELDS) {
    const el = form.elements[f];
    if (!el) continue;
    const v = el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value;
    if (v && v !== 'default') next.set(f, v);
  }
  if (page > 1) next.set('page', page);
  history.pushState(null, '', '?' + next);
  load();
}

async function load() {
  const p = readUrl();
  // ช่องกรองราคากรอกเป็นบาท → API รับสตางค์
  for (const k of ['minPrice', 'maxPrice']) if (p.get(k)) p.set(k, String(Math.round(Number(p.get(k)) * 100)));
  const data = await api('/games?' + p);
  remember(data.items);
  const q = p.get('q');
  setHeading(q);
  // ข้อความ "ไม่พบครบทุกคำ" อยู่ในกริดเดียวกับการ์ด (เข้ามาพร้อมผลลัพธ์ ไม่ดันเนื้อหาที่แสดงอยู่แล้ว)
  $('#grid').innerHTML = (data.relaxed ? `<p class="search-note" role="status">${esc(t('catalog.relaxed'))}</p>` : '') + data.items.map(cardHtml).join('');
  $('#empty').innerHTML = emptyArt('no-results') + (q ? `<p>${esc(t('catalog.emptyQ', { q }))} <a href="/games.html">${esc(t('catalog.clear'))}</a></p>` : `<p>${esc(t('catalog.empty'))}</p>`);
  $('#empty').hidden = data.items.length > 0;
  $('#count').textContent = `${t('catalog.count', { n: data.total })}`;
  const pages = Array.from({ length: data.pages }, (_, i) => i + 1);
  $('#pager').innerHTML = data.pages > 1
    ? pages.map((n) => `<button class="chip ${n === data.page ? 'active' : ''}" data-page="${n}">${n}</button>`).join('')
    : '';
}

form.addEventListener('change', () => writeUrl());
form.addEventListener('reset', () => setTimeout(() => { history.pushState(null, '', location.pathname); load(); }));
$('#pager').addEventListener('click', (e) => {
  if (e.target.dataset.page) { writeUrl(+e.target.dataset.page); scrollTo({ top: 0 }); }
});
addEventListener('popstate', load);
load().finally(markReady);
