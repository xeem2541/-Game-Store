import { $, api, dialog, dt, errorState, esc, formValues, loading, pager, qs, table, toast } from './core.js';

const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

export async function render(el, _rest, alive) {
  el.innerHTML = `<h1>รีวิว</h1>
    <form id="f" class="filters">
      <label class="f">ค้นหา (ข้อความ / เกม / ผู้ใช้)<input name="q"></label>
      <label class="f">คะแนน<select name="rating"><option value="">ทั้งหมด</option>${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${stars(n)}</option>`).join('')}</select></label>
      <button class="btn primary" type="submit">ค้นหา</button></form><div id="list"></div>`;
  const list = $('#list');
  let page = 1;
  const load = async () => {
    loading(list);
    try {
      const d = await api('/reviews' + qs({ ...formValues($('#f')), page, limit: 20 }));
      if (!alive()) return;
      // ข้อความรีวิวมาจากผู้ใช้ — escape ทุกครั้ง (esc) ห้ามใส่ลง HTML ตรง ๆ
      list.innerHTML = table([
        { h: 'เกม', f: (r) => `<a href="#/games/${r.gameId}">${esc(r.gameTitle)}</a>` },
        { h: 'ผู้ใช้', f: (r) => `<a href="#/users/${r.userId}">${esc(r.userName)}</a><div class="muted">${esc(r.userEmail)}</div>` },
        { h: 'คะแนน', f: (r) => `<span class="stars">${stars(r.rating)}</span>` },
        { h: 'ข้อความ', f: (r) => `<div class="review-body">${esc(r.body)}</div>` },
        { h: 'เมื่อ', f: (r) => dt(r.createdAt) },
        { h: '', f: (r) => `<button class="btn sm danger" data-del="${r.id}" type="button">ลบ</button>` },
      ], d.items) + pager(d);
      list.onclick = async (e) => {
        if (e.target.dataset.page) { page = Number(e.target.dataset.page); load(); return; }
        const id = e.target.dataset.del;
        if (!id) return;
        const v = await dialog({ title: 'ลบรีวิวนี้?', message: 'ลบแล้วคะแนนเฉลี่ยของเกมจะถูกคำนวณใหม่ และบันทึกใน audit log', fields: [{ name: 'reason', label: 'เหตุผล', required: true, type: 'textarea' }], confirmText: 'ลบรีวิว', danger: true });
        if (!v) return;
        try {
          const r = await api(`/reviews/${id}`, { method: 'DELETE', body: v });
          toast(`ลบแล้ว — คะแนนเฉลี่ยใหม่ ${r.game.rating} (${r.game.reviewCount} รีวิว)`);
          load();
        } catch (err) { toast(err.message, true); }
      };
    } catch (e) { errorState(list, e); }
  };
  $('#f').onsubmit = (e) => { e.preventDefault(); page = 1; load(); };
  load();
}
