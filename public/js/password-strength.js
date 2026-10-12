// ประเมินความแข็งแรงของรหัสผ่าน (ฝั่งหน้าเว็บ ใช้แนะนำผู้ใช้เท่านั้น — เซิร์ฟเวอร์บังคับแค่ความยาว 8–72 ตัว)
// คืน { level: 0–4, tip } — 0 = ยังไม่พิมพ์, 1 = อ่อนมาก/สั้นเกิน, 2 = อ่อน, 3 = พอใช้, 4 = แข็งแรง
// tip = key คำแนะนำใน i18n ที่ช่วยได้มากที่สุดในตอนนั้น
const COMMON = ['password', 'passw0rd', 'qwerty', 'abc123', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess', 'gamestore'];

// มีตัวอักษร/ตัวเลขเรียงต่อกัน (ขึ้นหรือลง) ยาว n ตัวขึ้นไป
function hasRun(s, n) {
  let up = 1, down = 1;
  for (let i = 1; i < s.length; i += 1) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    up = d === 1 ? up + 1 : 1;
    down = d === -1 ? down + 1 : 1;
    if (up >= n || down >= n) return true;
  }
  return false;
}

export function passwordStrength(pw, { email = '', name = '' } = {}) {
  if (!pw) return { level: 0, tip: 'pw.tipLength' };
  if (pw.length < 8) return { level: 1, tip: 'pw.tipShort' };
  const lower = pw.toLowerCase();
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const personal = [email.split('@')[0], ...name.split(/\s+/)].map((s) => s.toLowerCase()).filter((s) => s.length >= 3);
  const guessable = /^(.)\1+$/.test(pw) // ตัวเดียวซ้ำ เช่น aaaaaaaa
    || hasRun(lower, 6) // ลำดับเรียง เช่น 12345678, abcdefg, 987654
    || /^\d+$/.test(pw) && /(\d)\1{3}/.test(pw)
    || /^0[689]\d{8}$/.test(pw.replace(/[-\s]/g, '')) // เบอร์มือถือไทย
    || COMMON.some((w) => lower.includes(w))
    || personal.some((s) => lower.includes(s));
  if (guessable) return { level: 1, tip: 'pw.tipGuessable' };
  let score = 1;
  if (pw.length >= 12) score += 1;
  if (pw.length >= 16) score += 1;
  if (classes >= 2) score += 1;
  if (classes >= 3) score += 1;
  if (/^\d+$/.test(pw)) score = Math.min(score, 2); // ตัวเลขล้วนเดาได้เร็ว
  const level = Math.max(2, Math.min(4, score));
  const tip = level === 4 ? 'pw.tipGood' : pw.length < 12 ? 'pw.tipLonger' : 'pw.tipMix';
  return { level, tip };
}
