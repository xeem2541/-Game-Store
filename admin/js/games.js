import { $, api, badge, bahtInput, confirmBox, dt, errorState, esc, formValues, hasPerm, hashParams, loading, money, pager, qs, setHashQuery, table, toSatang, toast } from './core.js';

export async function render(el, rest, alive) {
  if (rest[0] === 'new') return renderForm(el, null, alive);
  if (rest[0]) return renderForm(el, Number(rest[0]), alive);
  return renderList(el, alive);
}

// ---------------- รายการเกม ----------------
async function renderList(el, alive) {
  const p = hashParams();
  el.innerHTML = `
    <div class="toolbar"><h1>เกม</h1>${hasPerm('games.write') ? '<a class="btn primary" href="#/games/new">+ เพิ่มเกม</a>' : ''}</div>
    <form id="filters" class="filters">
      <label class="f">ค้นหา<input name="q" value="${esc(p.q ?? '')}" placeholder="ชื่อ / slug"></label>
      <label class="f">หมวดหมู่<input name="genre" value="${esc(p.genre ?? '')}" size="10"></label>
      <label class="f">แพลตฟอร์ม<select name="platform"><option value="">ทั้งหมด</option>${['PC', 'PS5', 'Switch'].map((x) => `<option ${p.platform === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="f">สถานะ<select name="status"><option value="">ทั้งหมด</option><option value="active" ${p.status === 'active' ? 'selected' : ''}>เปิดขาย</option><option value="hidden" ${p.status === 'hidden' ? 'selected' : ''}>ซ่อน</option></select></label>
      <label class="f">เรียง<select name="sort">${[['id', 'ล่าสุด'], ['title', 'ชื่อ'], ['priceAsc', 'ราคา ต่ำ→สูง'], ['priceDesc', 'ราคา สูง→ต่ำ'], ['sales', 'ขายดี']].map(([v, l]) => `<option value="${v}" ${p.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn primary" type="submit">ค้นหา</button>
    </form>
    <div id="list"></div>`;
  const list = $('#list');
  let page = Number(p.page) || 1;
  const load = async () => {
    const q = { ...formValues($('#filters')), page };
    setHashQuery(q);
    loading(list);
    try {
      const d = await api('/games' + qs({ ...q, limit: 15 }));
      if (!alive()) return;
      list.innerHTML = table([
        { h: '', f: (g) => `<img class="thumb" src="${g.coverImage ? `/uploads/games/${esc(g.coverImage)}` : `/api/games/${esc(g.slug)}/cover.svg`}" alt="" loading="lazy">` },
        { h: 'เกม', f: (g) => `<a href="#/games/${g.id}"><strong>${esc(g.title)}</strong></a><div class="muted">${esc(g.slug)}</div>` },
        { h: 'หมวด / แพลตฟอร์ม', f: (g) => `${esc(g.genre)} • ${esc(g.platform)}` },
        { h: 'ราคา', cls: 'num', f: (g) => (g.discount ? `<s class="muted">${money(g.price)}</s> ${money(g.finalPrice)} <span class="badge paid">-${g.discount}%</span>` : money(g.price)) },
        { h: 'โค้ดว่าง', cls: 'num', f: (g) => (g.available < g.lowStockThreshold ? `<span class="badge low">${g.available}</span>` : g.available) },
        { h: 'สถานะ', f: (g) => badge(g.active ? 'active' : 'hidden') },
      ], d.items) + pager(d);
      list.onclick = (e) => { if (e.target.dataset.page) { page = Number(e.target.dataset.page); load(); } };
    } catch (e) { errorState(list, e); }
  };
  $('#filters').onsubmit = (e) => { e.preventDefault(); page = 1; load(); };
  load();
}

// ---------------- ฟอร์มเพิ่ม/แก้ไข ----------------
const GENRES = ['RPG', 'แข่งรถ', 'แอ็กชัน', 'จำลอง', 'ผจญภัย', 'ปริศนา', 'วางแผน', 'กีฬา'];

async function renderForm(el, id, alive) {
  const d = id ? await api(`/games/${id}`) : null;
  if (!alive()) return;
  const g = d?.game ?? { title: '', slug: '', description: '', description_en: '', genre: 'RPG', platform: 'PC', price: 0, discount: 0, release_date: new Date().toISOString().slice(0, 10), trailer_url: '', spec_min: '', spec_rec: '', featured: false, active: true, low_stock_threshold: 5 };
  const ro = !hasPerm('games.write'); // staff ดูได้อย่างเดียว (เว้นแต่ตั้ง STAFF_PERMISSIONS=games.write)
  const dis = ro ? 'disabled' : '';
  el.innerHTML = `
    <div class="toolbar"><h1>${id ? esc(g.title) : 'เพิ่มเกมใหม่'}</h1><a class="btn" href="#/games">← กลับรายการเกม</a></div>
    ${ro ? '<p class="muted">คุณเป็น staff — ดูข้อมูลได้อย่างเดียว (แก้ไขเกมต้องเป็น admin หรือได้รับสิทธิ์ games.write)</p>' : ''}
    <form id="gameForm" class="card"><div class="form-grid">
      <label class="f wide">ชื่อเกม *<input name="title" value="${esc(g.title)}" required maxlength="120" ${dis}></label>
      <label class="f">slug (URL) ${id ? '' : '— เว้นว่าง = สร้างจากชื่อ'}<input name="slug" value="${esc(g.slug)}" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="80" ${dis}></label>
      <label class="f">หมวดหมู่ *<input name="genre" list="genres" value="${esc(g.genre)}" required ${dis}><datalist id="genres">${GENRES.map((x) => `<option>${x}</option>`).join('')}</datalist></label>
      <label class="f">แพลตฟอร์ม *<select name="platform" ${dis}>${['PC', 'PS5', 'Switch'].map((x) => `<option ${g.platform === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="f">ราคาเต็ม (บาท) *<input name="price" type="number" step="0.01" min="0" value="${bahtInput(g.price)}" required ${dis}></label>
      <label class="f">ส่วนลด (%)<input name="discount" type="number" min="0" max="100" step="1" value="${g.discount}" ${dis}></label>
      <label class="f">วันที่วางจำหน่าย *<input name="release_date" type="date" value="${esc(g.release_date)}" required ${dis}></label>
      <label class="f wide">คำอธิบาย (ไทย) *<textarea name="description" rows="4" required maxlength="5000" ${dis}>${esc(g.description)}</textarea></label>
      <label class="f wide">คำอธิบาย (English)<textarea name="description_en" rows="4" maxlength="5000" ${dis}>${esc(g.description_en)}</textarea></label>
      <label class="f">สเปกขั้นต่ำ<input name="spec_min" value="${esc(g.spec_min ?? '')}" maxlength="1000" ${dis}></label>
      <label class="f">สเปกแนะนำ<input name="spec_rec" value="${esc(g.spec_rec ?? '')}" maxlength="1000" ${dis}></label>
      <label class="f wide">วิดีโอตัวอย่าง (ลิงก์ embed ของ YouTube/Vimeo แบบ https)<input name="trailer_url" type="url" value="${esc(g.trailer_url ?? '')}" placeholder="https://www.youtube.com/embed/..." ${dis}></label>
      <label class="f">แจ้งเตือนเมื่อโค้ดเหลือน้อยกว่า<input name="low_stock_threshold" type="number" min="0" value="${g.low_stock_threshold}" ${dis}></label>
      <label class="f">แนะนำบนหน้าแรก<select name="featured" ${dis}><option value="0">ไม่</option><option value="1" ${g.featured ? 'selected' : ''}>ใช่</option></select></label>
      <label class="f">สถานะ<select name="active" ${dis}><option value="1">เปิดขาย</option><option value="0" ${g.active ? '' : 'selected'}>ซ่อนจากหน้าร้าน</option></select></label>
    </div>
    <p class="msg" id="msg" role="alert"></p>
    ${ro ? '' : `<div class="toolbar"><button class="btn primary" type="submit">${id ? 'บันทึกการแก้ไข' : 'เพิ่มเกม'}</button>
      ${id && g.active ? '<button class="btn danger" type="button" id="hideBtn">ซ่อนเกมนี้</button>' : ''}</div>`}
    </form>
    <div id="extra"></div>`;

  const form = $('#gameForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (ro) return;
    const v = formValues(form);
    const body = {
      title: v.title, genre: v.genre, platform: v.platform, description: v.description, description_en: v.description_en,
      price: toSatang(v.price), discount: Number(v.discount || 0), release_date: v.release_date,
      trailer_url: v.trailer_url || null, spec_min: v.spec_min || null, spec_rec: v.spec_rec || null,
      low_stock_threshold: Number(v.low_stock_threshold || 0), featured: v.featured === '1', active: v.active === '1',
    };
    if (v.slug) body.slug = v.slug;
    $('#msg').textContent = '';
    try {
      if (id) {
        const r = await api(`/games/${id}`, { method: 'PUT', body });
        toast(r.changed.length ? `บันทึกแล้ว (แก้ ${r.changed.length} ฟิลด์)` : 'ไม่มีการเปลี่ยนแปลง');
        render(el, [String(id)], alive);
      } else {
        const r = await api('/games', { method: 'POST', body });
        toast('เพิ่มเกมแล้ว — อัปโหลดรูปปกและเติมโค้ดต่อได้เลย');
        location.hash = `#/games/${r.id}`;
      }
    } catch (err) { $('#msg').textContent = err.message; }
  };
  $('#hideBtn')?.addEventListener('click', async () => {
    if (!(await confirmBox('ซ่อนเกมนี้?', 'เกมจะหายจากหน้าร้านทันที (ข้อมูล ออเดอร์ และโค้ดเดิมยังอยู่ครบ) เปิดขายใหม่ได้โดยเปลี่ยนสถานะ', 'ซ่อนเกม', true))) return;
    await api(`/games/${id}`, { method: 'DELETE' });
    toast('ซ่อนเกมแล้ว');
    render(el, [String(id)], alive);
  });
  if (id) renderExtra(d, id, ro, el, alive);
}

function renderExtra(d, id, ro, el, alive) {
  const box = $('#extra');
  const s = d.stock;
  box.innerHTML = `
    <h2>รูปภาพ</h2>
    <div class="card">
      <h3>รูปปก</h3>
      <div class="imgs">${d.coverUrl ? `<figure><img src="${esc(d.coverUrl)}" alt="รูปปก">${ro ? '' : '<button class="btn sm danger" data-rm-cover type="button">ลบ</button>'}</figure>` : '<span class="muted">ยังไม่มีรูปปก (ใช้ภาพสร้างอัตโนมัติ)</span>'}</div>
      ${ro ? '' : '<p><label class="f">อัปโหลดรูปปก (JPG / PNG / WebP ไม่เกิน 3 MB)<input type="file" id="coverFile" accept="image/jpeg,image/png,image/webp"></label></p>'}
      <h3>ภาพตัวอย่าง (${d.images.length}/10)</h3>
      <div class="imgs">${d.images.map((i) => `<figure><img src="${esc(i.url)}" alt="ภาพตัวอย่าง" loading="lazy">${ro ? '' : `<button class="btn sm danger" data-rm-img="${i.id}" type="button">ลบ</button>`}</figure>`).join('') || '<span class="muted">ยังไม่มี</span>'}</div>
      ${ro ? '' : '<p><label class="f">เพิ่มภาพตัวอย่าง<input type="file" id="shotFile" accept="image/jpeg,image/png,image/webp"></label></p>'}
      <p class="muted">ระบบตรวจชนิดไฟล์จากเนื้อไฟล์จริง ย่อขนาด แปลงเป็น WebP และตั้งชื่อไฟล์ใหม่แบบสุ่ม</p>
    </div>
    <h2>สต็อกโค้ด</h2>
    <div class="card"><p>ว่าง <strong>${s.available}</strong> • จอง ${s.reserved} • ขายแล้ว ${s.sold} • เพิกถอน ${s.revoked} &nbsp; <a href="#/stock/${id}">จัดการโค้ดเกมนี้ →</a></p></div>
    <h2>ประวัติการเปลี่ยนราคา</h2>
    ${table([
      { h: 'เมื่อ', f: (r) => dt(r.changedAt) }, { h: 'โดย', f: (r) => esc(r.changedBy ?? '-') },
      { h: 'ราคา', cls: 'num', f: (r) => `${money(r.oldPrice)} → ${money(r.newPrice)}` }, { h: 'ส่วนลด', cls: 'num', f: (r) => `${r.oldDiscount}% → ${r.newDiscount}%` },
    ], d.priceHistory)}
    <p class="muted">เปลี่ยนราคาไม่กระทบออเดอร์เก่า (ออเดอร์เก็บราคา ณ ตอนซื้อไว้)</p>`;

  const up = async (file, kind) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try { await api(`/games/${id}/images?kind=${kind}`, { method: 'POST', body: fd }); toast('อัปโหลดแล้ว'); render(el, [String(id)], alive); } catch (e) { toast(e.message, true); }
  };
  $('#coverFile')?.addEventListener('change', (e) => up(e.target.files[0], 'cover'));
  $('#shotFile')?.addEventListener('change', (e) => up(e.target.files[0], 'screenshot'));
  box.onclick = async (e) => {
    const t = e.target;
    if (t.dataset.rmCover === undefined && !t.dataset.rmImg) return;
    if (!(await confirmBox('ลบรูปนี้?', 'ลบแล้วกู้คืนไม่ได้', 'ลบรูป', true))) return;
    try {
      await api(t.dataset.rmImg ? `/games/${id}/images/${t.dataset.rmImg}` : `/games/${id}/cover`, { method: 'DELETE' });
      toast('ลบรูปแล้ว');
      render(el, [String(id)], alive);
    } catch (err) { toast(err.message, true); }
  };
}
