import { test, expect } from '@playwright/test';

test.describe('Cart Drawer & Animations (Phase 3)', () => {
  test('เปิด/ปิด drawer ด้วยคีย์บอร์ด (Esc ปิด) และตัวนับเปลี่ยนเมื่อใส่ตะกร้า', async ({ page }) => {
    await page.goto('/game/battle-arena-x');
    await page.waitForSelector('body.ready', { state: 'attached' });

    // ทดสอบตัวนับเปลี่ยนเมื่อเพิ่มลงตะกร้า
    const cartCount = page.locator('#cartCount');
    await expect(cartCount).toHaveText('0');
    
    // ใส่ตะกร้า
    await page.click('#addBtn');
    
    // รออนิเมชันบิน (ถ้ามี) หรืออัปเดตตัวนับ
    await expect(cartCount).toHaveText('1');

    // เปิด drawer ด้วยปุ่มตะกร้า
    await page.click('#cartBtn');
    const drawer = page.locator('#cart');
    await expect(drawer).toBeVisible();

    // ทดสอบการกด Esc เพื่อปิด
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });

  test('Tab วนอยู่ใน drawer (Focus trap)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('body.ready', { state: 'attached' });
    
    // เปิด drawer
    await page.click('#cartBtn');
    await expect(page.locator('#cart')).toBeVisible();

    // โฟกัสต้องไปที่ปุ่มปิด (closeCart) เป็นปุ่มแรก
    await expect(page.locator('#closeCart')).toBeFocused();

    // กด Tab ไปเรื่อยๆ ต้องไม่หลุดออกจาก drawer
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      const inDrawer = await page.evaluate(() => {
        const el = document.activeElement;
        return el && (el.closest('#cart') !== null);
      });
      expect(inDrawer, 'Focus must stay inside the drawer').toBe(true);
    }
  });

  test('reduced-motion ปิดแอนิเมชัน fly-to-cart', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/game/battle-arena-x');
    await page.waitForSelector('body.ready', { state: 'attached' });
    
    // เมื่อกดปุ่ม add ไม่ควรมีอิลิเมนต์รูปภาพแอนิเมชันถูกสร้างขึ้นที่ body
    await page.click('#addBtn');
    
    // ตรวจสอบว่ารูปภาพไม่ได้ถูกสร้างขึ้น (ไม่มี img ที่มี position: fixed)
    const flyingImages = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).filter(img => img.style.position === 'fixed').length;
    });
    expect(flyingImages).toBe(0);

    // ตัวนับควรจะเปลี่ยน
    await expect(page.locator('#cartCount')).toHaveText('1');
  });
});
