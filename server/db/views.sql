-- สร้างใหม่ทุกครั้งที่เริ่มระบบ (หลัง migration)

-- สรุปรีวิวต่อเกม (games.review_count / games.rating_avg) คำนวณใหม่เฉพาะเกมที่รีวิวเปลี่ยน — อ่านบ่อยมาก เขียนน้อย
-- ใช้ trigger จึงถูกต้องทุกเส้นทางที่แก้ตาราง reviews (ลูกค้าเขียน/แก้/ลบ, แอดมินลบ) โดยโค้ดไม่ต้องจำ
DROP TRIGGER IF EXISTS reviews_stats_insert;
CREATE TRIGGER reviews_stats_insert AFTER INSERT ON reviews BEGIN
  UPDATE games SET
    review_count = (SELECT COUNT(*) FROM reviews WHERE game_id = NEW.game_id),
    rating_avg = (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE game_id = NEW.game_id)
  WHERE id = NEW.game_id;
END;

DROP TRIGGER IF EXISTS reviews_stats_delete;
CREATE TRIGGER reviews_stats_delete AFTER DELETE ON reviews BEGIN
  UPDATE games SET
    review_count = (SELECT COUNT(*) FROM reviews WHERE game_id = OLD.game_id),
    rating_avg = (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE game_id = OLD.game_id)
  WHERE id = OLD.game_id;
END;

-- แก้รีวิว: คำนวณทั้งเกมเดิมและเกมใหม่ (กรณี game_id ถูกเปลี่ยน)
DROP TRIGGER IF EXISTS reviews_stats_update;
CREATE TRIGGER reviews_stats_update AFTER UPDATE OF rating, game_id ON reviews BEGIN
  UPDATE games SET
    review_count = (SELECT COUNT(*) FROM reviews WHERE game_id = games.id),
    rating_avg = (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE game_id = games.id)
  WHERE id IN (OLD.game_id, NEW.game_id);
END;

-- มุมมองเกม: คะแนนเฉลี่ยจากรีวิวจริง (ถ้ายังไม่มีรีวิว ใช้คะแนนตั้งต้นจากตาราง games)
DROP VIEW IF EXISTS games_v;
CREATE VIEW games_v AS
SELECT g.id, g.slug, g.title, g.description, g.description_en, g.genre, g.platform, g.price, g.discount,
       COALESCE(g.rating_avg, g.rating) AS rating,
       g.review_count,
       g.release_date, g.sales, g.featured, g.color1, g.color2, g.trailer_url, g.spec_min, g.spec_rec, g.active,
       g.cover_image, g.low_stock_threshold
FROM games g;
