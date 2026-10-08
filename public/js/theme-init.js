// โหลดแบบ sync ใน <head> เพื่อตั้งธีมก่อนหน้าเว็บแสดงผล (กันจอกะพริบ)
try {
  var theme = localStorage.getItem('theme');
  if (theme !== 'light' && theme !== 'dark') theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
} catch (e) { document.documentElement.dataset.theme = 'dark'; }
// ตั้ง lang ของ <html> ให้ตรงกับภาษาที่เลือกตั้งแต่ก่อนแสดงผล (i18n.js ตั้งซ้ำอีกครั้งหลังโหลดไฟล์แปล)
try { var l = localStorage.getItem('lang'); if (l === 'th' || l === 'en') document.documentElement.lang = l; } catch (e) { /* ignore */ }
