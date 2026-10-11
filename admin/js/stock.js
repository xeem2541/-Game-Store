import { $, api, badge, dialog, dt, errorState, esc, hasPerm, isAdmin, loading, pager, qs, table, toast } from './core.js';

export async function render(el, rest, alive) {
  return rest[0] ? renderGame(el, Number(rest[0]), alive) : renderList(el, alive);
}

async function renderList(el, alive) {
  el.innerHTML = `<h1>สต็อกโค้ดเกม</h1>
    <form id="f" class="filters"><label class="f">ค้นหาเกม<input name="q"></label><button class="btn primary" type="submit">ค้นหา</button></form><div id="list"></div>`;
  const list = $('#list');
  let page = 1;
  const load = async () => {
    loading(list);
    try {
      const d = await api('/stock' + qs({ q: $('#f').q.value, page, limit: 20 }));
      if (!alive()) return;
      list.innerHTML = table([
        { h: 'เกม', f: (g) => `<a href="#/stock/${g.id}"><strong>${esc(g.title)}</strong></a> ${g.active ? '' : badge('hidden')}` },
        { h: 'ว่าง', cls: 'num', f: (g) => (g.low ? `<span class="badge low">${g.available} ใกล้หมด</span>` : g.available) },
        { h: 'จอง', cls: 'num', f: (g) => g.reserved }, { h: 'ขายแล้ว', cls: 'num', f: (g) => g.sold }, { h: 'เพิกถอน', cls: 'num', f: (g) => g.revoked },
        { h: 'เตือนเมื่อน้อยกว่า', cls: 'num', f: (g) => g.threshold },
      ], d.items) + pager(d);
      list.onclick = (e) => { if (e.target.dataset.page) { page = Number(e.target.dataset.page); load(); } };
    } catch (e) { errorState(list, e); }
  };
  $('#f').onsubmit = (e) => { e.preventDefault(); page = 1; load(); };
  load();
}

async function renderGame(el, gid, alive) {
  const { game: g, stock } = await api(`/games/${gid}`);
  if (!alive()) return;
  el.innerHTML = `
    <div class="toolbar"><h1>โค้ดเกม: ${esc(g.title)}</h1><a class="btn" href="#/stock">← กลับ</a></div>
    <div class="cards" id="stats"></div>
    ${hasPerm('stock.write') ? `
    <div class="card">
      <h3>นำเข้าโค้ดจากไฟล์ CSV</h3>
      <p class="muted">รูปแบบ: หนึ่งโค้ดต่อบรรทัด (คอลัมน์แรก) มีบรรทัดหัว <code>code</code> หรือไม่ก็ได้ • โค้ดยาว 4–64 ตัว ใช้ A-Z a-z 0-9 - _ • สูงสุด 5,000 แถว / 1 MB • ระบบตัดโค้ดซ้ำให้ และเข้ารหัสก่อนบันทึก</p>
      <form id="importForm" class="filters"><input type="file" name="file" accept=".csv,.txt,text/csv,text/plain" required><button class="btn primary" type="submit">อัปโหลด</button></form>
      <div id="importResult"></div>
      <form id="thrForm" class="filters"><label class="f">แจ้งเตือนเมื่อโค้ดว่างน้อยกว่า<input name="threshold" type="number" min="0" value="${g.low_stock_threshold}"></label><button class="btn" type="submit">บันทึกเกณฑ์</button></form>
    </div>` : '<p class="muted">staff ดูสถานะสต็อกได้อย่างเดียว (นำเข้า/เพิกถอนโค้ดต้องเป็น admin)</p>'}
    <h2>รายการโค้ด <small class="muted">(แสดงปิดบังบางส่วน)</small></h2>
    <form id="kf" class="filters"><label class="f">สถานะ<select name="status"><option value="">ทั้งหมด</option>${['available', 'reserved', 'sold', 'revoked'].map((s) => `<option value="${s}">${esc(s)}</option>`).join('')}</select></label></form>
    <div id="keys"></div>`;

  const showStats = (st) => {
    $('#stats').innerHTML = ['available', 'reserved', 'sold', 'revoked'].map((k) => `<div class="card stat"><div class="label">${badge(k)}</div><div class="value">${st[k]}</div></div>`).join('');
  };
  showStats(stock);
  const refreshStats = async () => { if (alive()) showStats((await api(`/games/${gid}`)).stock); };

  const keys = $('#keys');
  let page = 1;
  const load = async () => {
    loading(keys);
    try {
      const d = await api(`/stock/${gid}/keys` + qs({ status: $('#kf').status.value, page, limit: 20 }));
      if (!alive()) return;
      keys.innerHTML = table([
        { h: 'โค้ด', f: (k) => `<code>${esc(k.masked)}</code>` }, { h: 'สถานะ', f: (k) => badge(k.status) },
        { h: 'ออเดอร์', f: (k) => (k.orderId ? `<a href="#/orders/${k.orderId}">#${k.orderId}</a>` : '-') },
        { h: 'เพิ่มเมื่อ', f: (k) => dt(k.createdAt) },
        { h: 'หมายเหตุ', f: (k) => esc(k.revokeReason ?? '') },
        { h: '', f: (k) => (`${isAdmin() ? `<button class="btn sm" data-reveal="${k.id}" type="button">ดูโค้ดเต็ม</button>` : ''}${hasPerm('stock.write') && k.status === 'available' ? ` <button class="btn sm danger" data-revoke="${k.id}" type="button">เพิกถอน</button>` : ''}`) },
      ], d.items) + pager(d);
    } catch (e) { errorState(keys, e); }
  };
  keys.onclick = async (e) => {
    const t = e.target;
    if (t.dataset.page) { page = Number(t.dataset.page); load(); return; }
    if (t.dataset.reveal) {
      const ok = await dialog({ title: 'ดูโค้ดเกมเต็ม', message: 'การดูโค้ดเต็มจะถูกบันทึกใน audit log พร้อมชื่อของคุณ', confirmText: 'แสดงโค้ด' });
      if (!ok) return;
      try {
        const { code } = await api(`/stock/keys/${t.dataset.reveal}/reveal`, { method: 'POST', body: {} });
        await dialog({ title: 'โค้ดเกม', message: `<code class="bigcode">${esc(code)}</code>`, confirmText: 'ปิด' });
      } catch (err) { toast(err.message, true); }
    }
    if (t.dataset.revoke) {
      const v = await dialog({ title: 'เพิกถอนโค้ด', message: 'โค้ดที่เพิกถอนจะไม่ถูกขายอีก (ทำได้เฉพาะโค้ดที่ยังไม่ขาย)', fields: [{ name: 'reason', label: 'เหตุผล', required: true, type: 'textarea' }], confirmText: 'เพิกถอน', danger: true });
      if (!v) return;
      try { await api(`/stock/keys/${t.dataset.revoke}/revoke`, { method: 'POST', body: v }); toast('เพิกถอนแล้ว'); load(); refreshStats(); } catch (err) { toast(err.message, true); }
    }
  };
  $('#kf').onchange = () => { page = 1; load(); };
  load();

  $('#importForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('#importResult');
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true'); // นำเข้าไฟล์ใหญ่ใช้เวลา — แสดงวงหมุนที่ปุ่ม
    try {
      const r = await api(`/stock/${gid}/import`, { method: 'POST', body: new FormData(e.target) });
      out.innerHTML = `<div class="alert"><div><strong>นำเข้าเสร็จสิ้น</strong><div>ทั้งหมด ${r.rows} แถว • <b>เพิ่มสำเร็จ ${r.added}</b> • ซ้ำ ${r.duplicates} • รูปแบบผิด ${r.invalid}</div>
        ${r.invalidRows.length ? `<div class="muted">บรรทัดที่ผิด: ${r.invalidRows.map((x) => `#${x.line}`).join(', ')}${r.invalid > r.invalidRows.length ? ' …' : ''}</div>` : ''}</div></div>`;
      e.target.reset();
      load();
      refreshStats();
    } catch (err) { out.innerHTML = `<div class="state error">${esc(err.message)}</div>`; } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  });
  $('#thrForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/stock/${gid}/threshold`, { method: 'PUT', body: { threshold: Number(e.target.threshold.value) } }); toast('บันทึกแล้ว'); } catch (err) { toast(err.message, true); }
  });
}
