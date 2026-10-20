// พรีวิวภาพในเกมบนการ์ด (UI เฟส 27): ชี้ค้างที่ภาพปกการ์ดเกม → ภาพปกค่อย ๆ เปลี่ยนเป็นภาพในเกมทีละภาพ พร้อมแถบบอกภาพ
// - โหลดข้อมูล/ภาพเฉพาะเมื่อชี้ค้าง (HOVER_MS) ไม่โหลดล่วงหน้า; ข้อมูลของแต่ละเกมจำไว้ (ชี้ซ้ำไม่โหลดใหม่)
// - เกมที่ไม่มีภาพในเกม: ไม่มีอะไรเกิดขึ้น (ภาพปกเดิม)
// - ตกแต่งล้วน (aria-hidden, ไม่รับคลิก — กดที่ภาพยังไปหน้าเกม); fx.js เรียกเฉพาะอุปกรณ์ที่มีเมาส์และไม่ได้ขอลดการเคลื่อนไหว
export const HOVER_MS = 450;
export const PREVIEW_MS = 1100;
const MAX_SHOTS = 4;
const cache = new Map();

const shotsOf = (slug) => {
  if (!cache.has(slug)) {
    cache.set(slug, fetch(`/api/games/${encodeURIComponent(slug)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { images: [] }))
      .then((g) => (Array.isArray(g.images) ? g.images.filter((u) => typeof u === 'string' && u.startsWith('/')).slice(0, MAX_SHOTS) : []))
      .catch(() => []));
  }
  return cache.get(slug);
};

export function initCardPreview() {
  let active = null; // { cover, timer, interval, el }
  const stop = () => {
    if (!active) return;
    clearTimeout(active.timer);
    clearInterval(active.interval);
    active.el?.remove();
    active = null;
  };
  const start = (cover, slug) => {
    stop();
    const run = active = { cover };
    run.timer = setTimeout(async () => {
      // โหลดภาพให้เสร็จก่อน ใช้เฉพาะภาพที่โหลดได้ (ภาพเสีย/หายไม่ทำให้เห็นช่องว่างบนการ์ด)
      const loaded = await Promise.all((await shotsOf(slug)).map((src) => {
        const img = new Image();
        img.src = src;
        return img.decode().then(() => src, () => null);
      }));
      const shots = loaded.filter(Boolean);
      if (active !== run || !shots.length) return;
      const el = document.createElement('span');
      el.className = 'cover-preview';
      el.setAttribute('aria-hidden', 'true');
      el.style.setProperty('--preview-ms', `${PREVIEW_MS}ms`);
      el.innerHTML = shots.map(() => '<img alt="" decoding="async">').join('') + `<span class="cover-preview-bar">${shots.map(() => '<i></i>').join('')}</span>`;
      const imgs = [...el.querySelectorAll('img')];
      imgs.forEach((img, i) => { img.src = shots[i]; }); // ตั้งผ่าน DOM (ไม่ต่อ URL ลงใน HTML)
      const bars = [...el.querySelectorAll('i')];
      cover.append(el);
      run.el = el;
      let i = -1;
      const next = () => {
        i = (i + 1) % shots.length;
        imgs.forEach((img, j) => img.classList.toggle('on', j === i));
        bars.forEach((b, j) => { b.classList.toggle('on', j === i); b.classList.toggle('done', j < i); });
      };
      next();
      run.interval = setInterval(next, PREVIEW_MS);
    }, HOVER_MS);
  };
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const cover = e.target.closest?.('.grid .card[data-slug] .cover');
    if (cover === active?.cover) return;
    if (!cover) { stop(); return; }
    start(cover, cover.closest('.card').dataset.slug);
  }, { passive: true });
  document.addEventListener('scroll', stop, { passive: true }); // เลื่อนหน้าแล้วการ์ดใต้เมาส์เปลี่ยน — ไม่ค้างพรีวิวของใบเดิม
}
