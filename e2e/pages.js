// รายการหน้าที่ใช้ตรวจ responsive / a11y / ภาษา+ธีม
export const PUBLIC_PAGES = [
  ['home', '/'], ['games', '/games.html'], ['game', '/game/dragon-realm'], ['login', '/login'], ['register', '/register'],
  ['forgot', '/forgot'], ['cart', '/cart'], ['privacy', '/privacy'], ['terms', '/terms'], ['refund', '/refund-policy'], ['notfound', '/no-such-page'],
];
export const VIEWPORTS = [[375, 812], [768, 1024], [1280, 800]];

// เปิดทุกหน้าในรายการ โดยใช้แท็บใหม่ต่อหน้าแล้วปิดทิ้ง: WebKit เก็บหน้าที่เคยเปิดในแท็บเดียวกันไว้ในหน่วยความจำ
// (บน CI โปรเซส WebKit โตเกิน 5 GB หลังเปิด ~22 หน้าในแท็บเดียว จนเครื่อง CI หน่วยความจำเต็มและ runner ถูกปิด)
export async function eachPage(context, { setup, label } = {}, fn) {
  for (const [name, url] of PUBLIC_PAGES) {
    if (label) console.log(`[trace] ${new Date().toISOString().slice(11, 19)} ${label} → ${name}`);
    const page = await context.newPage();
    try {
      await setup?.(page);
      await page.goto(url);
      await fn(page, name);
    } finally {
      await page.close();
    }
  }
}
