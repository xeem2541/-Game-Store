import { $, hasPerm, qs } from './core.js';

// รายงาน CSV: ลิงก์ดาวน์โหลดตรงจากเซิร์ฟเวอร์ (ไฟล์ UTF-8 มี BOM เปิดด้วย Excel ได้ภาษาไทยถูกต้อง, ป้องกัน CSV injection)
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() + 7 * 3600_000 - n * 86400_000).toISOString().slice(0, 10);

const REPORTS = [
  { file: 'orders', name: 'ออเดอร์', desc: 'ทุกออเดอร์ในช่วงวันที่ (ตามวันที่สร้าง) พร้อมลูกค้า รายการ ส่วนลด ยอดสุทธิ ช่องทางชำระ เลขที่ใบเสร็จ', range: true, status: true },
  { file: 'sales', name: 'ยอดขายรายวัน / รายเดือน', desc: 'ยอดขายและยอดคืนเงินตามวันที่ชำระ (เวลาไทย)', range: true, group: true },
  { file: 'games-sales', name: 'รายการขายต่อเกม', desc: 'จำนวนที่ขายและยอดขายต่อเกม (ออเดอร์ที่ชำระแล้วเท่านั้น)', range: true },
  { file: 'new-users', name: 'ผู้ใช้ใหม่', desc: 'ผู้ใช้ที่สมัครในช่วงวันที่ (มีอีเมล — เฉพาะ admin)', range: true, adminOnly: true },
  { file: 'stock', name: 'สต็อกโค้ด', desc: 'จำนวนโค้ดแต่ละสถานะต่อเกม (ไม่รวมตัวโค้ดจริง)' },
];

export async function render(el) {
  const items = REPORTS.filter((r) => !r.adminOnly || hasPerm('reports.users'));
  el.innerHTML = `<h1>รายงาน</h1><p class="muted">ไฟล์ CSV เข้ารหัส UTF-8 (มี BOM) — เปิดด้วย Excel ได้ภาษาไทยถูกต้อง ค่าที่ขึ้นต้นด้วย = + - @ จะถูกป้องกันไม่ให้ถูกตีความเป็นสูตร</p>
    <div class="grid2">${items.map((r) => `<form class="card" data-file="${r.file}">
      <h3>${r.name}</h3><p class="muted">${r.desc}</p>
      <div class="filters">
        ${r.range ? `<label class="f">ตั้งแต่<input type="date" name="from" value="${daysAgo(29)}"></label><label class="f">ถึง<input type="date" name="to" value="${today()}"></label>` : ''}
        ${r.status ? '<label class="f">สถานะ<select name="status"><option value="">ทั้งหมด</option><option value="paid">ชำระแล้ว</option><option value="pending">รอชำระ</option><option value="cancelled">ยกเลิก</option><option value="refunded">คืนเงินแล้ว</option></select></label>' : ''}
        ${r.group ? '<label class="f">จัดกลุ่ม<select name="group"><option value="day">รายวัน</option><option value="month">รายเดือน</option></select></label>' : ''}
        <a class="btn primary" href="#" data-dl>⬇ ดาวน์โหลด CSV</a>
      </div></form>`).join('')}</div>`;
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-dl]');
    if (!a) return;
    const form = a.closest('form');
    a.href = `/api/admin/reports/${form.dataset.file}.csv` + qs(Object.fromEntries(new FormData(form)));
  });
  $('h1'); // (ลิงก์ถูกประกอบตอนคลิก จึงใช้ค่าล่าสุดของฟอร์มเสมอ)
}
