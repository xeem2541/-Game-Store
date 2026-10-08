import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { db } from './index.js';
import { addKeys, availableCount } from '../services/keys.js';

// [title, genre, platform, price, discount, rating, release, sales, desc]
const rows = [
  ['Dragon Realm', 'RPG', 'PC', 1290, 30, 4.8, '2026-03-12', 5400, 'ผจญภัยในโลกแฟนตาซีที่มังกรครองเมือง สร้างตัวละคร เลือกสายอาชีพ และปราบมังกรในโลกเปิดกว้าง'],
  ['Neon Racer 2077', 'แข่งรถ', 'PC', 890, 0, 4.4, '2025-11-02', 3200, 'แข่งรถความเร็วสูงท่ามกลางเมืองไซเบอร์พังก์ ปรับแต่งรถได้อิสระ พร้อมโหมดออนไลน์ 16 คน'],
  ['Zombie Outbreak', 'แอ็กชัน', 'PS5', 1590, 20, 4.6, '2026-01-20', 4100, 'เอาชีวิตรอดจากการระบาดของซอมบี้ รวบรวมทรัพยากร สร้างฐาน และต่อสู้กับฝูงอมตะ'],
  ['Cozy Farm Life', 'จำลอง', 'Switch', 690, 10, 4.9, '2025-08-15', 6800, 'ปลูกผัก เลี้ยงสัตว์ ตกแต่งฟาร์ม และผูกมิตรกับชาวบ้านในหมู่บ้านแสนอบอุ่น'],
  ['Sky Kingdoms', 'ผจญภัย', 'Switch', 1790, 0, 4.7, '2026-05-30', 2900, 'สำรวจเกาะลอยฟ้าและไขปริศนาโบราณ กับโลกที่สวยงามราวภาพวาด'],
  ['Battle Arena X', 'แอ็กชัน', 'PC', 0, 0, 4.2, '2025-06-01', 12000, 'เกมต่อสู้ 5v5 เล่นฟรี! เลือกฮีโร่ วางแผนทีม และพิชิตอันดับสูงสุด'],
  ['Mystery Manor', 'ปริศนา', 'PC', 450, 40, 4.5, '2024-10-31', 2100, 'ไขคดีลึกลับในคฤหาสน์เก่า ค้นหาเบาะแส สอบสวนผู้ต้องสงสัย และหาตัวคนร้าย'],
  ['Galaxy Commanders', 'วางแผน', 'PC', 1090, 15, 4.3, '2025-09-09', 1700, 'บัญชาการกองเรืออวกาศ ขยายอาณาจักร และทำสงครามระหว่างดวงดาว'],
  ['Football Pro 26', 'กีฬา', 'PS5', 1890, 0, 4.1, '2026-09-20', 5200, 'ฟุตบอลสุดสมจริง ลิขสิทธิ์ทีมและนักเตะจริง พร้อมโหมดอาชีพและออนไลน์'],
  ['Pixel Dungeon Quest', 'RPG', 'Switch', 390, 25, 4.6, '2025-02-14', 3900, 'RPG พิกเซลสไตล์เรโทร ลงดันเจี้ยนสุ่มทุกครั้ง เก็บของ อัปเลเวล และเอาชีวิตรอด'],
  ['Ocean Explorer', 'ผจญภัย', 'PC', 590, 0, 4.4, '2025-07-07', 1500, 'ดำดิ่งสู่ใต้ทะเลลึก ค้นพบสิ่งมีชีวิตลึกลับและซากเรืออับปาง'],
  ['Kart Mania', 'แข่งรถ', 'Switch', 1490, 10, 4.7, '2026-04-18', 4700, 'แข่งโกคาร์ทสนุกสนาน ใช้ไอเทมป่วนคู่แข่ง เล่นหน้าจอเดียวได้ถึง 4 คน'],
  ['Shadow Assassin', 'แอ็กชัน', 'PC', 1190, 35, 4.5, '2025-12-05', 3600, 'นักฆ่าเงาในนครโบราณ ลอบเร้น สังหาร และเปิดโปงแผนการของราชสำนัก'],
  ['Tower Defense Legends', 'วางแผน', 'PC', 290, 0, 4.3, '2024-05-20', 2500, 'วางหอคอยป้องกันฐาน อัปเกรดพลัง และต้านทานฝูงศัตรูหลายร้อยระลอก'],
  ['Chef Rush', 'จำลอง', 'Switch', 790, 20, 4.5, '2025-10-10', 3300, 'ร้านอาหารสุดวุ่น ทำอาหารร่วมกับเพื่อนให้ทันออเดอร์ก่อนครัวไฟไหม้'],
  ['Cyber Samurai', 'แอ็กชัน', 'PS5', 1690, 0, 4.6, '2026-02-27', 3800, 'ซามูไรยุคไซเบอร์ ฟันดาบผสานพลังเทคโนโลยีในโตเกียวอนาคต'],
  ['Puzzle Palace', 'ปริศนา', 'PC', 250, 30, 4.2, '2024-03-03', 1200, 'ไขปริศนากลไกในพระราชวังกว่า 100 ห้อง ท้าทายสมองทุกระดับ'],
  ['Wild West Legends', 'แอ็กชัน', 'PS5', 1490, 25, 4.4, '2025-04-22', 2800, 'ชีวิตคาวบอยในดินแดนตะวันตก ปล้นรถไฟ ล่าค่าหัว และสู้ดวลปืน'],
  ['Moonlight Academy', 'RPG', 'Switch', 990, 0, 4.8, '2026-06-11', 4400, 'โรงเรียนเวทมนตร์ใต้แสงจันทร์ เรียนคาถา คบเพื่อน และไขความลับของอาจารย์ใหญ่'],
  ['Speed Legends GT', 'แข่งรถ', 'PS5', 1790, 15, 4.3, '2025-05-16', 2600, 'ซูเปอร์คาร์ลิขสิทธิ์แท้กว่า 300 รุ่น สนามแข่งสมจริงทั่วโลก'],
  ['Space Miner', 'จำลอง', 'PC', 490, 10, 4.1, '2024-11-11', 1900, 'ขุดแร่ในอวกาศ ขยายสถานี และค้าขายข้ามกาแลคซี'],
  ['Hero Tactics', 'วางแผน', 'Switch', 1290, 0, 4.7, '2025-03-08', 3000, 'ยุทธวิธีแบบผลัดตา วางกำลังทหาร และพลิกเกมด้วยฮีโร่ในตำนาน'],
  ['Ninja Dash', 'แอ็กชัน', 'Switch', 350, 20, 4.0, '2024-08-08', 2200, 'นินจาวิ่งกระโดดสุดมันส์ ผ่านด่านอันตรายด้วยความเร็วเหนือมนุษย์'],
  ['Basketball Star', 'กีฬา', 'PC', 1390, 30, 4.0, '2025-10-30', 1400, 'บาสเกตบอลสุดมันส์ สร้างนักกีฬาในฝันและขึ้นเป็นซูเปอร์สตาร์'],
  ['Forest Spirit', 'ผจญภัย', 'Switch', 650, 0, 4.9, '2025-09-25', 5100, 'ผจญภัยในป่าเวทมนตร์กับเพื่อนวิญญาณ เรื่องราวอบอุ่นหัวใจ'],
  ['Retro Arcade Pack', 'ปริศนา', 'PC', 199, 50, 4.1, '2023-12-24', 3500, 'รวมเกมอาร์เคดสุดคลาสสิก 20 เกมในแพ็กเดียว'],
  ['Mech Warriors', 'แอ็กชัน', 'PC', 1390, 20, 4.4, '2026-07-04', 2300, 'ขับหุ่นยนต์ยักษ์ประลองกำลังในสนามรบอนาคต ปรับแต่งอาวุธได้ไม่จำกัด'],
  ['Vampire Castle', 'RPG', 'PC', 1090, 15, 4.5, '2025-10-31', 2700, 'ผจญภัยในปราสาทแวมไพร์ อัปเกรดพลังและเลือกชะตากรรมของตัวเอง'],
  ['Island Tycoon', 'จำลอง', 'PC', 590, 0, 4.2, '2025-01-12', 1600, 'สร้างรีสอร์ตบนเกาะส่วนตัว บริหารพนักงานและรีวิวจากนักท่องเที่ยว'],
  ['Final Boss Rush', 'แอ็กชัน', 'PS5', 990, 40, 4.3, '2025-12-24', 2000, 'สู้บอสสุดโหด 50 ตัวติดต่อกัน พิสูจน์ฝีมือของคุณ'],
];


// คำอธิบายภาษาอังกฤษ (key = title)
const descEn = {
  'Dragon Realm': 'Adventure through a fantasy world ruled by dragons. Create your hero, pick a class and hunt dragons across a vast open world.',
  'Neon Racer 2077': 'High-speed street racing through a cyberpunk megacity. Customize your ride freely and race online with up to 16 players.',
  'Zombie Outbreak': 'Survive a zombie outbreak: scavenge resources, build your base and fight off the undead hordes.',
  'Cozy Farm Life': 'Grow crops, raise animals, decorate your farm and make friends with the villagers in a warm, welcoming town.',
  'Sky Kingdoms': 'Explore floating islands and solve ancient puzzles in a world that looks like a living painting.',
  'Battle Arena X': 'Free-to-play 5v5 arena combat. Pick your hero, plan with your team and climb to the top of the ranks.',
  'Mystery Manor': 'Solve a mystery in an old mansion: search for clues, question suspects and unmask the culprit.',
  'Galaxy Commanders': 'Command a space fleet, expand your empire and wage war across the stars.',
  'Football Pro 26': 'Ultra-realistic football with licensed teams and real players, plus career and online modes.',
  'Pixel Dungeon Quest': 'A retro pixel-art RPG with a new dungeon every run. Loot, level up and survive.',
  'Ocean Explorer': 'Dive into the deep sea and discover mysterious creatures and sunken shipwrecks.',
  'Kart Mania': 'Fun-filled kart racing: use items to wreak havoc on rivals. Up to 4 players on one screen.',
  'Shadow Assassin': 'An assassin of the shadows in an ancient city. Sneak, strike and expose the royal court’s conspiracy.',
  'Tower Defense Legends': 'Place towers to defend your base, upgrade your power and hold off hundreds of waves of enemies.',
  'Chef Rush': 'A chaotic kitchen co-op game: cook with friends and serve every order before the kitchen catches fire.',
  'Cyber Samurai': 'A cyber-age samurai blends sword fighting with technology in the Tokyo of the future.',
  'Puzzle Palace': 'Solve mechanical puzzles across 100+ palace rooms, with challenges for every skill level.',
  'Wild West Legends': 'Live the cowboy life in the Wild West: rob trains, chase bounties and win gunslinger duels.',
  'Moonlight Academy': 'A magic school under the moonlight: learn spells, make friends and uncover the headmaster’s secrets.',
  'Speed Legends GT': 'Over 300 officially licensed supercars and realistic tracks from around the world.',
  'Space Miner': 'Mine asteroids, expand your space station and trade across the galaxy.',
  'Hero Tactics': 'Turn-based tactics: deploy your troops and turn the tide with legendary heroes.',
  'Ninja Dash': 'A fast, fun ninja platformer: run and leap through deadly stages at superhuman speed.',
  'Basketball Star': 'Thrilling basketball: build your dream player and rise to superstardom.',
  'Forest Spirit': 'Adventure through an enchanted forest with your spirit companion in a heartwarming tale.',
  'Retro Arcade Pack': 'A collection of 20 classic arcade games in a single pack.',
  'Mech Warriors': 'Pilot giant mechs in future battlefields with unlimited weapon customization.',
  'Vampire Castle': 'Explore a vampire castle, upgrade your powers and choose your own fate.',
  'Island Tycoon': 'Build a private island resort, manage your staff and keep the tourists happy.',
  'Final Boss Rush': 'Fight 50 brutal bosses back to back and prove your skill.',
};

const palette = [
  ['#ff512f', '#dd2476'], ['#00c6ff', '#0072ff'], ['#134e5e', '#71b280'], ['#f7971e', '#ffd200'],
  ['#56ccf2', '#2f80ed'], ['#8e2de2', '#4a00e0'], ['#232526', '#7b4397'], ['#0f2027', '#2c5364'],
  ['#11998e', '#38ef7d'], ['#cb2d3e', '#ef473a'], ['#2193b0', '#6dd5ed'], ['#fc4a1a', '#f7b733'],
];

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// upsert ตาม slug เพื่อไม่ลบรีวิว/รายการโปรดที่อ้างอิงเกมอยู่
export function seedGames() {
  const stmt = db.prepare(`INSERT INTO games
    (slug,title,description,description_en,genre,platform,price,discount,rating,release_date,sales,featured,color1,color2,trailer_url,spec_min,spec_rec)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(slug) DO UPDATE SET title=excluded.title, description=excluded.description, description_en=excluded.description_en, genre=excluded.genre,
      platform=excluded.platform, price=excluded.price, discount=excluded.discount, rating=excluded.rating,
      release_date=excluded.release_date, sales=excluded.sales, featured=excluded.featured,
      color1=excluded.color1, color2=excluded.color2, spec_min=excluded.spec_min, spec_rec=excluded.spec_rec`);
  db.transaction(() => {
    rows.forEach((r, i) => {
      const [title, genre, platform, price, discount, rating, release, sales, desc] = r;
      const [c1, c2] = palette[i % palette.length];
      const pc = platform === 'PC';
      stmt.run(
        slugify(title), title, desc, descEn[title] ?? desc, genre, platform,
        price * 100, discount, rating, release, sales, i < 6 ? 1 : 0, c1, c2, null, // ราคาในรายการด้านบนเป็นบาท → เก็บเป็นสตางค์
        pc ? 'CPU: Core i5 / RAM: 8 GB / GPU: GTX 960 / พื้นที่: 40 GB' : null,
        pc ? 'CPU: Core i7 / RAM: 16 GB / GPU: RTX 2060 / พื้นที่: 40 GB SSD' : null,
      );
    });
  })();
  return rows.length;
}

// คูปองตัวอย่าง (เงินเป็นสตางค์) — upsert ตาม code
export function seedCoupons() {
  const day = 24 * 3600 * 1000;
  const rows = [
    // code, description, type, value, min_subtotal, expires_at, max_uses, max_per_user
    ['WELCOME10', 'ลด 10% สำหรับทุกคำสั่งซื้อ (ใช้ได้คนละ 1 ครั้ง)', 'percent', 10, 0, null, null, 1],
    ['SAVE100', 'ลด ฿100 เมื่อซื้อครบ ฿500', 'fixed', 10000, 50000, null, null, null],
    ['FLASH15', 'ลด 15% (หมดอายุใน 2 วัน เหลือ 100 สิทธิ์)', 'percent', 15, 0, Date.now() + 2 * day, 100, 1],
    ['EXPIRED20', 'คูปองหมดอายุแล้ว (สำหรับทดสอบ)', 'percent', 20, 0, Date.now() - day, null, null],
  ];
  const stmt = db.prepare(`INSERT INTO coupons (code, description, type, value, min_subtotal, expires_at, max_uses, max_per_user)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET description=excluded.description, type=excluded.type, value=excluded.value,
      min_subtotal=excluded.min_subtotal, expires_at=excluded.expires_at, max_uses=excluded.max_uses, max_per_user=excluded.max_per_user`);
  db.transaction(() => rows.forEach((r) => stmt.run(...r)))();
  return rows.length;
}

// โค้ดเกม "ปลอม" สำหรับทดสอบเท่านั้น (ขึ้นต้นด้วย FAKE-) เติมให้ทุกเกมจนมีโค้ดว่างอย่างน้อย perGame ตัว
export function seedKeys(perGame = 20) {
  let total = 0;
  const chunk = () => crypto.randomBytes(3).toString('hex').toUpperCase();
  for (const g of db.prepare('SELECT id FROM games').all()) {
    const need = perGame - availableCount(g.id);
    if (need > 0) total += addKeys(g.id, Array.from({ length: need }, () => `FAKE-${chunk()}-${chunk()}-${chunk()}`));
  }
  return total;
}

// ข้อมูลตัวอย่าง (เกมสมมติ คูปองทดสอบ โค้ดปลอม) ใช้เฉพาะตอนพัฒนา/ทดสอบ — production ไม่ seed อะไรเลย
// (ต้องการข้อมูลตัวอย่างบน staging ที่ NODE_ENV=production จริง ให้ตั้ง ALLOW_DEMO_SEED=1 เอง)
const demoAllowed = () => process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEMO_SEED === '1';

export function seedIfEmpty() {
  if (!demoAllowed()) return;
  if (db.prepare('SELECT COUNT(*) AS n FROM games').get().n === 0) console.log(`seeded ${seedGames()} games`);
  if (db.prepare('SELECT COUNT(*) AS n FROM coupons').get().n === 0) console.log(`seeded ${seedCoupons()} coupons`);
  if (db.prepare('SELECT COUNT(*) AS n FROM game_keys').get().n === 0) console.log(`seeded ${seedKeys()} FAKE test game keys`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!demoAllowed()) {
    console.error('npm run seed สร้างข้อมูลตัวอย่าง (เกมสมมติ คูปองทดสอบ โค้ดเกมปลอม) — ปฏิเสธการรันเมื่อ NODE_ENV=production');
    console.error('ถ้าต้องการจริงๆ (เช่น staging) ให้ตั้ง ALLOW_DEMO_SEED=1');
    process.exit(1);
  }
  console.log(`seeded ${seedGames()} games, ${seedCoupons()} coupons, ${seedKeys()} new FAKE test keys`);
}
