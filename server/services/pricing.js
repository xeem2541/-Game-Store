// คำนวณราคาทั้งหมดฝั่งเซิร์ฟเวอร์ ด้วยจำนวนเต็ม "สตางค์" เท่านั้น (ไม่ใช้ float)
// ราคาเกมในตาราง games เก็บเป็นสตางค์ (INTEGER) เหมือนออเดอร์/คูปอง (ย้ายจากบาทใน migration 003)

export function priceItem(game) {
  const list = game.price;
  const unit = Math.round((list * (100 - game.discount)) / 100);
  return { list, unit };
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
