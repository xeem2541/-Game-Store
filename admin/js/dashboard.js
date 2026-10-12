import { $, api, badge, dt, empty, esc, money, qs, table, toast } from './core.js';

const ALERT_TH = {
  LATE_PAYMENT: 'จ่ายเงินหลังออเดอร์หมดอายุ', REFUND_FAILED: 'คืนเงินอัตโนมัติล้มเหลว', EMAIL_FAILED: 'ส่งอีเมลไม่สำเร็จ', AMOUNT_MISMATCH: 'ยอดชำระไม่ตรงกับออเดอร์',
  OUT_OF_STOCK_AFTER_PAYMENT: 'โค้ดหมดหลังลูกค้าจ่ายเงิน', DUPLICATE_PAYMENT: 'ชำระซ้ำ', PARTIAL_REFUND: 'คืนเงินบางส่วนจาก Stripe', PAYMENT_UNKNOWN_ORDER: 'ได้รับเงินแต่ไม่พบออเดอร์', REFUND_NO_ID: 'คืนเงินไม่มี refund id',
};
const BAD = new Set(['REFUND_FAILED', 'AMOUNT_MISMATCH', 'OUT_OF_STOCK_AFTER_PAYMENT', 'LATE_PAYMENT', 'PAYMENT_UNKNOWN_ORDER']);
let chart;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#A0A7B4';
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() + 7 * 3600_000 - n * 86400_000).toISOString().slice(0, 10);

export async function render(el, _rest, alive) {
  const d = await api('/dashboard');
  if (!alive()) return;
  const s = d.summary;
  const kpi = (cls, label, value, sub = '') => `<div class="card kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  const n = (v) => v.toLocaleString('th-TH');

  el.innerHTML = `
    <h1>ภาพรวม</h1>
    <div class="kpis">
      ${kpi('kpi-today', 'ยอดขายวันนี้', money(s.todayRevenue), `${n(s.todayOrders)} ออเดอร์ • เฉลี่ย 7 วัน ${money(Math.round(s.weekRevenue / 7))} ต่อวัน`)}
      ${kpi('kpi-week', 'ยอดขาย 7 วันล่าสุด', money(s.weekRevenue), `${n(s.weekOrders)} ออเดอร์`)}
      ${kpi('kpi-month', 'ยอดขายเดือนนี้', money(s.monthRevenue), `${n(s.monthOrders)} ออเดอร์`)}
      ${kpi('kpi-users', 'ผู้ใช้ใหม่วันนี้', n(s.newUsers.today), `7 วัน: ${n(s.newUsers.week)} • 30 วัน: ${n(s.newUsers.month)}`)}
      ${kpi('kpi-keys', 'โค้ดเกมคงเหลือ', n(s.keys.available), `จอง ${n(s.keys.reserved)} • ขายแล้ว ${n(s.keys.sold)} • เพิกถอน ${n(s.keys.revoked)}`)}
    </div>
    <div class="status-tiles">
      ${['pending', 'paid', 'cancelled', 'refunded'].map((k) => `<a class="card kpi" href="#/orders?status=${k}"><div class="label">ออเดอร์ ${badge(k)}</div><div class="value">${n(s.byStatus[k])}</div><div class="sub">ดูรายการ</div></a>`).join('')}
    </div>

    <h2>การแจ้งเตือน</h2>
    <div id="alerts"></div>

    <h2>ยอดขาย</h2>
    <div class="card">
      <form id="salesForm" class="filters">
        <label class="f">ตั้งแต่<input type="date" name="from" value="${daysAgo(29)}"></label>
        <label class="f">ถึง<input type="date" name="to" value="${today()}"></label>
        <label class="f">จัดกลุ่ม<select name="group"><option value="day">รายวัน</option><option value="month">รายเดือน</option></select></label>
        <button class="btn primary" type="submit">แสดงกราฟ</button>
        <button class="btn sm" type="button" data-range="30">30 วัน</button>
        <button class="btn sm" type="button" data-range="month">12 เดือน</button>
      </form>
      <div class="chartbox"><canvas id="salesChart" aria-label="กราฟยอดขาย" role="img"></canvas></div>
      <p class="muted" id="salesNote"></p>
    </div>

    <div class="grid2">
      <div><h2>เกมขายดี 10 อันดับ</h2>${table([
        { h: 'เกม', f: (r) => `<a href="#/games/${r.gameId}">${esc(r.title)}</a>` },
        { h: 'ขายได้', cls: 'num', f: (r) => r.units }, { h: 'ยอด (ก่อนคูปอง)', cls: 'num', f: (r) => money(r.revenue) },
      ], d.topGames)}</div>
      <div><h2>หมวดหมู่ขายดี</h2>${table([
        { h: 'หมวดหมู่', f: (r) => esc(r.genre) }, { h: 'ขายได้', cls: 'num', f: (r) => r.units }, { h: 'ยอด (ก่อนคูปอง)', cls: 'num', f: (r) => money(r.revenue) },
      ], d.topGenres)}</div>
    </div>

    <h2>การใช้คูปอง</h2>
    <div class="card">
      <p>ออเดอร์ที่ชำระแล้ว <strong>${d.coupons.paidOrders}</strong> รายการ ใช้คูปอง <strong>${d.coupons.ordersWithCoupon}</strong> รายการ
        (อัตราการใช้ <strong>${(d.coupons.usageRate * 100).toFixed(1)}%</strong>)</p>
      ${d.coupons.top.length ? table([{ h: 'โค้ด', f: (r) => `<code>${esc(r.code)}</code>` }, { h: 'ใช้', cls: 'num', f: (r) => r.uses }, { h: 'ส่วนลดรวม', cls: 'num', f: (r) => money(r.discount) }], d.coupons.top) : ''}
    </div>`;

  renderAlerts(d.alerts);
  const form = $('#salesForm');
  const draw = async () => {
    const q = Object.fromEntries(new FormData(form));
    try {
      const r = await api('/dashboard/sales' + qs(q));
      if (!alive()) return;
      drawChart(r);
    } catch (e) { toast(e.message, true); }
  };
  form.onsubmit = (e) => { e.preventDefault(); draw(); };
  form.addEventListener('click', (e) => {
    const r = e.target.dataset.range;
    if (!r) return;
    form.group.value = r === 'month' ? 'month' : 'day';
    form.from.value = r === 'month' ? daysAgo(364) : daysAgo(29);
    form.to.value = today();
    draw();
  });
  draw();
}

function renderAlerts(a) {
  const box = $('#alerts');
  const items = [
    ...a.open.map((x) => `<div class="alert ${BAD.has(x.kind) ? 'bad' : ''}"><div><strong>${esc(ALERT_TH[x.kind] ?? x.kind)}</strong>
      ${x.orderId ? ` — <a href="#/orders/${x.orderId}">ออเดอร์ #${x.orderId}</a>` : ''}<div class="muted">${esc(x.detail)} • ${dt(x.createdAt)}</div></div>
      <button class="btn sm" data-resolve="${x.id}" type="button">ปิดแจ้งเตือน</button></div>`),
    ...a.lowStock.map((g) => `<div class="alert"><div><strong>โค้ดเกมใกล้หมด</strong> — <a href="#/stock/${g.id}">${esc(g.title)}</a>
      <div class="muted">เหลือ ${g.available} โค้ด (เกณฑ์แจ้งเตือน ${g.threshold})</div></div><a class="btn sm" href="#/stock/${g.id}">เติมโค้ด</a></div>`),
  ];
  box.innerHTML = items.length ? items.join('') : empty('ไม่มีการแจ้งเตือน 🎉');
  box.onclick = async (e) => {
    const id = e.target.dataset.resolve;
    if (!id) return;
    try { await api(`/dashboard/alerts/${id}/resolve`, { method: 'POST', body: {} }); e.target.closest('.alert').remove(); toast('ปิดแจ้งเตือนแล้ว'); } catch (err) { toast(err.message, true); }
  };
}

function drawChart(r) {
  if (chart) chart.destroy();
  const text = css('--c-text-2');
  const grid = css('--c-border');
  Chart.defaults.font.family = css('--font');
  $('#salesNote').textContent = `รวม ${money(r.rows.reduce((s, x) => s + x.revenue, 0))} จาก ${r.rows.reduce((s, x) => s + x.orders, 0)} ออเดอร์ (${r.from} ถึง ${r.to}) • ยอดคืนเงินรวม ${money(r.rows.reduce((s, x) => s + x.refunded, 0))}`;
  chart = new Chart($('#salesChart'), {
    data: {
      labels: r.rows.map((x) => x.period),
      datasets: [
        { type: 'bar', label: 'ยอดขาย (บาท)', data: r.rows.map((x) => x.revenue / 100), backgroundColor: css('--c-accent'), borderRadius: 4, maxBarThickness: 28, yAxisID: 'y', order: 2 },
        { type: 'line', label: 'จำนวนออเดอร์', data: r.rows.map((x) => x.orders), borderColor: '#B9A6FF', backgroundColor: '#B9A6FF', borderWidth: 2, yAxisID: 'y1', tension: 0.3, pointRadius: 0, pointHoverRadius: 4, order: 1 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 500 },
      plugins: { legend: { labels: { color: text, usePointStyle: true, boxWidth: 8 } } },
      scales: {
        x: { ticks: { color: text, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: text }, grid: { color: grid }, title: { display: true, text: 'บาท', color: text } },
        y1: { beginAtZero: true, position: 'right', ticks: { color: text, precision: 0 }, grid: { display: false }, title: { display: true, text: 'ออเดอร์', color: text } },
      },
    },
  });
}
