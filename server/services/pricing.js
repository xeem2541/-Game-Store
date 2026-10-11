// คำนวณราคาทั้งหมดฝั่งเซิร์ฟเวอร์ ด้วยจำนวนเต็ม "สตางค์" เท่านั้น (ไม่ใช้ float)
// ราคาเกมในตาราง games เก็บเป็นสตางค์ (INTEGER) เหมือนออเดอร์/คูปอง (ย้ายจากบาทใน migration 003)

// ราคาหลังส่วนลดของเกม — แหล่งเดียวที่ทุกส่วนต้องใช้ (หน้าร้าน, ตะกร้า, ออเดอร์, SEO, แอดมิน) ราคาที่แสดงจึงตรงกับที่เรียกเก็บเสมอ
// คำนวณด้วยจำนวนเต็มล้วน (ปัดครึ่งขึ้น) ไม่ใช้ float เช่น price * (1 - d/100) ที่ทำให้คลาดไป 1 สตางค์ได้
export const finalPrice = (game) => Math.round((game.price * (100 - game.discount)) / 100);

// สูตรเดียวกันในรูป SQL (ใช้กรอง/เรียงราคา): ค่าไม่ติดลบ → floor((x + 50) / 100) = Math.round(x / 100)
// CAST ตัดเศษให้แน่นอนแม้ค่าที่ได้มาเป็น REAL (เช่น พารามิเตอร์จาก JS) ไม่พึ่งการหารจำนวนเต็มของ SQLite
export const FINAL_PRICE_SQL = 'CAST((price * (100 - discount) + 50) / 100 AS INTEGER)';

export function priceItem(game) {
  return { list: game.price, unit: finalPrice(game) };
}

// ส่วนลดคูปองจากยอดหลังหักส่วนลดเกม (ไม่เกินยอดนั้น)
export function couponDiscountFor(coupon, amount) {
  if (!coupon) return 0;
  const raw = coupon.type === 'percent' ? Math.floor((amount * coupon.value) / 100) : coupon.value;
  return Math.max(0, Math.min(raw, amount));
}

export function priceCart(games, coupon = null) {
  const items = games.map((g) => {
    const { list, unit } = priceItem(g);
    return { gameId: g.id, slug: g.slug, title: g.title, platform: g.platform, listPrice: list, discountPercent: g.discount, unitPrice: unit };
  });
  const subtotal = items.reduce((s, i) => s + i.listPrice, 0);
  const afterGame = items.reduce((s, i) => s + i.unitPrice, 0);
  const couponDiscount = couponDiscountFor(coupon, afterGame);
  return {
    items,
    subtotal,
    gameDiscount: subtotal - afterGame,
    couponDiscount,
    total: afterGame - couponDiscount,
  };
}
