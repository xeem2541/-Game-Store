// เกมที่ผู้ใช้เพิ่งดู — จำไว้ในเครื่อง (localStorage) เท่านั้น ไม่ส่งขึ้นเซิร์ฟเวอร์ ใช้แสดงแถว "เกมที่คุณเพิ่งดู" และ "เพราะคุณสนใจแนว…" ในหน้าแรก
const KEY = 'recentViews';
const MAX = 12;

export function getRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((r) => r && /^[a-z0-9-]+$/.test(r.slug) && typeof r.genre === 'string').slice(0, MAX) : [];
  } catch { return []; }
}

export function recordView(slug, genre) {
  try { localStorage.setItem(KEY, JSON.stringify([{ slug, genre }, ...getRecent().filter((r) => r.slug !== slug)].slice(0, MAX))); } catch { /* โหมดส่วนตัว/พื้นที่เต็ม: ไม่จำก็ไม่เป็นไร */ }
}

export function clearRecent() {
  try { localStorage.removeItem(KEY); } catch { /* ไม่มีอะไรให้ล้าง */ }
}

// แนวที่ดูบ่อยสุด (เท่ากัน → แนวที่เพิ่งดูล่าสุด)
export function topGenre(list) {
  const n = new Map();
  for (const r of list) n.set(r.genre, (n.get(r.genre) ?? 0) + 1);
  let best = null;
  for (const r of list) if (!best || n.get(r.genre) > n.get(best)) best = r.genre;
  return best;
}
