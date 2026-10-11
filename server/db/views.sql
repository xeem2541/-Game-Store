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

-- ค้นหาเกม (FTS5 แบบ trigram — จับข้อความย่อยได้ทุกภาษารวมภาษาไทย ดู services/search.js)
-- external content: ข้อความอยู่ในตาราง games ที่เดียว ดัชนีเก็บแค่ trigram; trigger ด้านล่างอัปเดตดัชนีทุกครั้งที่ข้อความเปลี่ยน
CREATE VIRTUAL TABLE IF NOT EXISTS games_fts USING fts5(
  title, description, description_en, genre, platform,
  content = 'games', content_rowid = 'id', tokenize = 'trigram remove_diacritics 1'
);
DROP TRIGGER IF EXISTS games_fts_ai;
CREATE TRIGGER games_fts_ai AFTER INSERT ON games BEGIN
  INSERT INTO games_fts (rowid, title, description, description_en, genre, platform)
  VALUES (NEW.id, NEW.title, NEW.description, NEW.description_en, NEW.genre, NEW.platform);
END;
DROP TRIGGER IF EXISTS games_fts_ad;
CREATE TRIGGER games_fts_ad AFTER DELETE ON games BEGIN
  INSERT INTO games_fts (games_fts, rowid, title, description, description_en, genre, platform)
  VALUES ('delete', OLD.id, OLD.title, OLD.description, OLD.description_en, OLD.genre, OLD.platform);
END;
-- เฉพาะคอลัมน์ที่ค้นหาได้ (ยอดขาย/ส่วนลดเปลี่ยนบ่อย ไม่ต้องแตะดัชนี)
DROP TRIGGER IF EXISTS games_fts_au;
CREATE TRIGGER games_fts_au AFTER UPDATE OF title, description, description_en, genre, platform ON games BEGIN
  INSERT INTO games_fts (games_fts, rowid, title, description, description_en, genre, platform)
  VALUES ('delete', OLD.id, OLD.title, OLD.description, OLD.description_en, OLD.genre, OLD.platform);
  INSERT INTO games_fts (rowid, title, description, description_en, genre, platform)
  VALUES (NEW.id, NEW.title, NEW.description, NEW.description_en, NEW.genre, NEW.platform);
END;
