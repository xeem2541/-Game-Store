// แถบชื่อเกมเลื่อนไม่หยุด (UI เฟส 24) คั่นระหว่างส่วนต่าง ๆ ของหน้าแรก — CSS ทำแอนิเมชัน (marquee.css), ไฟล์นี้เติมเนื้อหาและวัดระยะ
// - ชุดแรกเป็นลิงก์จริงให้ screen reader/คีย์บอร์ด ชุดที่ทำซ้ำเพื่อให้วนต่อเนื่องเป็น aria-hidden และลิงก์ tabindex="-1" (ไม่อ่าน/ไม่ Tab ซ้ำ)
// - หยุดเมื่อ hover, เมื่อ focus อยู่ในแถบ, เมื่อกดปุ่มหยุด (WCAG 2.2.2) และเมื่อเลื่อนออกนอกจอ (ไม่เปลือง GPU)
// - ขอลดการเคลื่อนไหว: ไม่สร้างชุดซ้ำ CSS แสดงเป็นแถวที่ปัด/เลื่อนเองได้แทน
import { esc, t } from './common.js';
import { prefersReducedMotion } from './motion.js';

const SPEED = 50; // px ต่อวินาที

const listHtml = (items, hidden) => `<ul class="marquee-list"${hidden ? ' aria-hidden="true"' : ''}>${items
  .map(({ href, label, tag }) => `<li><a href="${esc(href)}"${hidden ? ' tabindex="-1"' : ''}>${esc(label)}${tag ? ` <span class="mq-tag">${esc(tag)}</span>` : ''}</a></li>`)
  .join('')}</ul>`;

// band: <div class="marquee"> ที่จองความสูงไว้ใน index.html, items: [{ href, label, tag? }]
export function mountMarquee(band, items) {
  if (!band) return;
  if (!items.length) { band.hidden = true; return; }
  band.innerHTML = `<div class="marquee-viewport"><div class="marquee-track">${listHtml(items, false)}</div></div>
    <button class="marquee-toggle" type="button" aria-pressed="false" aria-label="${esc(t('marquee.pause'))}"><span class="mq-icon" aria-hidden="true"></span></button>`;
  const track = band.querySelector('.marquee-track');
  const first = track.firstElementChild;
  const toggle = band.querySelector('.marquee-toggle');
  toggle.addEventListener('click', () => {
    const paused = band.classList.toggle('is-paused');
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.setAttribute('aria-label', t(paused ? 'marquee.play' : 'marquee.pause'));
  });
  if (prefersReducedMotion()) { band.classList.add('is-static'); return; }

  // จำนวนชุดทั้งหมดเป็นเลขคู่ และครึ่งหนึ่งกว้างพอเต็มจอ → keyframes เลื่อน -50% ของแถบพอดี (ตำแหน่งสุดท้ายหน้าตาเหมือนตำแหน่งเริ่ม จึงวนไม่สะดุด)
  // keyframes เป็นค่าคงที่ ไม่ใช้ตัวแปร CSS → เบราว์เซอร์ส่งแอนิเมชันไปทำบน compositor ได้ ไม่กิน main thread
  let lastKey = '';
  const layout = () => {
    const w = first.getBoundingClientRect().width;
    const key = `${w}|${band.clientWidth}`;
    if (!w || key === lastKey) return;
    lastKey = key;
    const total = 2 * Math.max(1, Math.ceil(band.clientWidth / w));
    while (track.children.length < total) track.insertAdjacentHTML('beforeend', listHtml(items, true));
    while (track.children.length > total) track.lastElementChild.remove();
    band.style.setProperty('--mq-dur', `${((total / 2) * w / SPEED).toFixed(1)}s`);
    band.classList.add('is-running');
  };
  layout();
  new ResizeObserver(layout).observe(band);
  document.fonts?.ready.then(layout); // ฟอนต์โหลดเสร็จแล้วความกว้างข้อความเปลี่ยน

  new IntersectionObserver(([e]) => band.classList.toggle('is-off', !e.isIntersecting)).observe(band);
}
