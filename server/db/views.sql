-- สร้างใหม่ทุกครั้งที่เริ่มระบบ (หลัง migration)
-- มุมมองเกม: คะแนนเฉลี่ยจากรีวิวจริง (ถ้ายังไม่มีรีวิว ใช้คะแนนตั้งต้นจากตาราง games)
DROP VIEW IF EXISTS games_v;
CREATE VIEW games_v AS
SELECT g.id, g.slug, g.title, g.description, g.description_en, g.genre, g.platform, g.price, g.discount,
       COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.game_id = g.id), g.rating) AS rating,
       (SELECT COUNT(*) FROM reviews r WHERE r.game_id = g.id) AS review_count,
       g.release_date, g.sales, g.featured, g.color1, g.color2, g.trailer_url, g.spec_min, g.spec_rec, g.active,
       g.cover_image, g.low_stock_threshold
FROM games g;
