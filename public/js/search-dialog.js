// ค้นหาแบบเต็มจอ (UI เฟส 18): เปิดด้วย "/" หรือ Ctrl/⌘+K หรือปุ่มค้นหาในแถบเมนูล่างจอ — โหลดไฟล์นี้ตอนเปิดครั้งแรกเท่านั้น
// <dialog> แบบ modal: เบราว์เซอร์จัดการกักโฟกัส, Esc ปิด และทำให้เนื้อหาด้านหลังกดไม่ได้ให้เอง
// ช่องค้นหาเป็น ARIA combobox (เหมือนช่องค้นหาใน header): ลูกศรขึ้น/ลงเลือก, Enter เปิด — ผลลัพธ์มีภาพปกและราคา
import { api, esc, t, genreName, priceHtml, highlight } from './common.js';
import { prefersReducedMotion } from './motion.js';

const RECENT_KEY = 'recentSearches';
const getRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((s) => typeof s === 'string').slice(0, 6); } catch { return []; } };
const setRecent = (list) => { try { list.length ? localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6))) : localStorage.removeItem(RECENT_KEY); } catch {} };
const remember = (q) => { if (q) setRecent([q, ...getRecent().filter((s) => s.toLowerCase() !== q.toLowerCase())]); };

let dlg;
let lastFocus;
let idleData; // แนวเกมยอดนิยม + เกมขายดี (โหลดครั้งเดียว)

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'search-dlg';
  dlg.setAttribute('aria-labelledby', 'sdTitle');
  dlg.innerHTML = `
    <form class="sd-head" role="search" action="/games.html" method="get">
      <h2 id="sdTitle" class="sr-only">${t('search.dlgTitle')}</h2>
      <svg class="icon sd-icon" aria-hidden="true"><use href="/icons.svg#icon-search" /></svg>
      <input id="sdInput" name="q" type="search" maxlength="100" autocomplete="off" spellcheck="false" enterkeyhint="search"
        placeholder="${t('search.placeholder')}" aria-label="${t('search.placeholder')}"
        role="combobox" aria-autocomplete="list" aria-controls="sdList" aria-expanded="false">
      <button class="sd-close" type="button" aria-label="${t('common.close')}"><span aria-hidden="true">Esc</span></button>
    </form>
    <div class="sd-body">
      <div class="sd-idle" id="sdIdle"></div>
      <div class="sd-results" id="sdResults" hidden>
        <p class="sd-status" id="sdStatus" role="status"></p>
        <ul id="sdList" class="sd-list" role="listbox" aria-label="${t('search.suggestions')}"></ul>
      </div>
    </div>
    <p class="sd-foot" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> ${t('search.keySelect')} <kbd>Enter</kbd> ${t('search.keyOpen')} <kbd>Esc</kbd> ${t('common.close')}</p>`;
  document.body.append(dlg);

  const input = dlg.querySelector('#sdInput');
  const list = dlg.querySelector('#sdList');
  const status = dlg.querySelector('#sdStatus');
  let active = -1;
  let seq = 0;
  let timer;
  const options = () => [...list.querySelectorAll('[role="option"]')];
  const select = (i) => {
    const opts = options();
    if (!opts.length) return;
    active = (i + opts.length) % opts.length;
    opts.forEach((o, n) => o.setAttribute('aria-selected', String(n === active)));
    input.setAttribute('aria-activedescendant', opts[active].id);
    opts[active].scrollIntoView({ block: 'nearest' });
  };
  const go = (href, q) => { remember(q); location.href = href; };
  const showResults = (on) => {
    dlg.querySelector('#sdResults').hidden = !on;
    dlg.querySelector('#sdIdle').hidden = on;
    input.setAttribute('aria-expanded', String(on && options().length > 0));
    if (!on) { active = -1; input.removeAttribute('aria-activedescendant'); }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { showResults(false); renderIdle(); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      dlg.querySelector('#sdResults').setAttribute('aria-busy', 'true');
      const r = await api(`/games?q=${encodeURIComponent(q)}&limit=6`).catch(() => ({ items: [], total: 0 }));
      if (mine !== seq || input.value.trim() !== q) return;
      dlg.querySelector('#sdResults').removeAttribute('aria-busy');
      const all = `/games.html?q=${encodeURIComponent(q)}`;
      list.innerHTML = r.items.map((g, i) => `
        <li id="sd-o-${i}" role="option" aria-selected="false" class="sd-item" data-href="/game/${esc(g.slug)}">
          <img src="${esc(g.cover)}?size=sm" alt="" width="96" height="72" loading="lazy">
          <span class="sd-item-text"><span class="sd-item-title">${highlight(g.title, q)}</span><span class="sd-item-meta">${esc(genreName(g.genre))} · ${esc(g.platform)}</span></span>
          <span class="sd-item-price">${priceHtml(g)}</span>
        </li>`).join('')
        + (r.total ? `<li id="sd-o-all" role="option" aria-selected="false" class="sd-all" data-href="${esc(all)}">${t('search.allN', { n: r.total, q: esc(q) })}</li>` : '');
      status.textContent = r.total ? t('search.found', { n: r.total }) : t('search.none', { q });
      active = -1;
      input.removeAttribute('aria-activedescendant');
      showResults(true);
      if (!r.total) { renderIdle(); dlg.querySelector('#sdIdle').hidden = false; } // ไม่พบ: แสดงแนวเกม/เกมขายดีให้เลือกต่อ
    }, 150);
  });
  input.addEventListener('keydown', (e) => {
    // ช่อง type=search ใช้ Esc ล้างข้อความเอง (dialog ไม่ปิด) → ให้ Esc ปิดเสมอ เหมือนกดนอกช่อง
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); select(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(active - 1); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); go(options()[active].dataset.href, input.value.trim()); }
  });
  dlg.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) go(`/games.html?q=${encodeURIComponent(q)}`, q);
  });
  list.addEventListener('mousedown', (e) => e.preventDefault()); // คลิกผลลัพธ์แล้วโฟกัสยังอยู่ที่ช่องค้นหา
  list.addEventListener('click', (e) => { const o = e.target.closest('[role="option"]'); if (o) go(o.dataset.href, input.value.trim()); });
  dlg.querySelector('.sd-close').addEventListener('click', () => closeSearch());
  // คลิกพื้นหลังรอบกล่อง (ตัว dialog เอง ไม่ใช่เนื้อหาข้างใน) = ปิด
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeSearch(); });
  dlg.addEventListener('close', () => { document.documentElement.classList.remove('search-open'); lastFocus?.focus?.({ preventScroll: true }); });
  // ช่วงก่อนพิมพ์: ค้นหาล่าสุด (กดเพื่อค้นซ้ำ / ล้าง), ลิงก์แนวเกม และเกมขายดี
  dlg.querySelector('#sdIdle').addEventListener('click', (e) => {
    const again = e.target.closest('[data-recent]');
    if (again) { input.value = again.dataset.recent; input.dispatchEvent(new Event('input')); input.focus(); return; }
    if (e.target.closest('#sdClear')) { setRecent([]); renderIdle(); input.focus(); }
  });
}

function renderIdle() {
  const recent = getRecent();
  const box = dlg.querySelector('#sdIdle');
  const genres = idleData?.genres ?? [];
  const games = idleData?.games ?? [];
  box.innerHTML = `
    ${recent.length ? `<section class="sd-sec" aria-labelledby="sdRecentT">
      <div class="sd-sec-head"><h3 id="sdRecentT">${t('search.recent')}</h3><button class="sd-link" id="sdClear" type="button">${t('search.clearRecent')}</button></div>
      <div class="sd-chips">${recent.map((q) => `<button class="sd-chip" type="button" data-recent="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    </section>` : ''}
    ${genres.length ? `<section class="sd-sec" aria-labelledby="sdGenreT">
      <div class="sd-sec-head"><h3 id="sdGenreT">${t('search.genres')}</h3></div>
      <div class="sd-chips">${genres.map((g) => `<a class="sd-chip" href="/games.html?genre=${encodeURIComponent(g.genre)}">${esc(genreName(g.genre))} <small>${g.count}</small></a>`).join('')}</div>
    </section>` : ''}
    ${games.length ? `<section class="sd-sec" aria-labelledby="sdTopT">
      <div class="sd-sec-head"><h3 id="sdTopT">${t('search.trending')}</h3></div>
      <div class="sd-top">${games.map((g) => `<a class="sd-top-card" href="/game/${esc(g.slug)}"><img src="${esc(g.cover)}" alt="" width="200" height="150" loading="lazy"><span>${esc(g.title)}</span></a>`).join('')}</div>
    </section>` : ''}`;
}

export async function openSearch(initial = '') {
  if (!dlg) build();
  if (dlg.open) return;
  lastFocus = document.activeElement;
  document.documentElement.classList.add('search-open');
  dlg.classList.toggle('no-anim', prefersReducedMotion());
  dlg.showModal();
  const input = dlg.querySelector('#sdInput');
  input.value = initial;
  input.dispatchEvent(new Event('input'));
  input.focus();
  renderIdle();
  if (!idleData) {
    const [facets, top] = await Promise.all([
      api('/games/facets').catch(() => ({})),
      api('/games?sort=bestseller&limit=4').catch(() => ({ items: [] })),
    ]);
    idleData = { genres: (facets.genreStats ?? []).slice(0, 8), games: top.items ?? [] };
    if (dlg.open && !input.value.trim()) renderIdle();
  }
}

export function closeSearch() { if (dlg?.open) dlg.close(); }
