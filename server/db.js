'use strict';
/*
 * SQLite database setup, schema and seed data for AuraStream.
 * Uses better-sqlite3 (synchronous, fast, zero external server).
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'aurastream.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'User',
    is_creator    INTEGER NOT NULL DEFAULT 0,
    avatar        TEXT,
    country       TEXT DEFAULT 'Nigeria',
    currency      TEXT DEFAULT 'NGN',
    phone         TEXT,
    bio           TEXT,
    status        TEXT NOT NULL DEFAULT 'Active',
    plan_id       TEXT DEFAULT 'sub_free',
    plan_name     TEXT DEFAULT 'Free Tier',
    plan_status   TEXT DEFAULT 'Active',
    plan_expires  TEXT,
    settings_json TEXT DEFAULT '{}',
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS channels (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT,
    name        TEXT NOT NULL,
    logo        TEXT DEFAULT '📺',
    category    TEXT DEFAULT 'Entertainment',
    description TEXT,
    stream_key  TEXT UNIQUE,
    is_live     INTEGER NOT NULL DEFAULT 0,
    current     TEXT,
    next        TEXT,
    viewers     TEXT DEFAULT '0 watching',
    created_at  TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS contents (
    id           TEXT PRIMARY KEY,
    owner_id     TEXT,
    title        TEXT NOT NULL,
    type         TEXT DEFAULT 'movie',
    genre        TEXT,
    year         INTEGER,
    rating       TEXT DEFAULT 'PG',
    poster       TEXT,
    video_url    TEXT,
    description  TEXT,
    cast_json    TEXT DEFAULT '[]',
    status       TEXT NOT NULL DEFAULT 'Pending',
    is_featured  INTEGER DEFAULT 0,
    is_trending  INTEGER DEFAULT 0,
    is_new       INTEGER DEFAULT 0,
    is_premium   INTEGER DEFAULT 0,
    is_african   INTEGER DEFAULT 0,
    is_nigerian  INTEGER DEFAULT 0,
    is_international INTEGER DEFAULT 0,
    views        INTEGER DEFAULT 0,
    likes        INTEGER DEFAULT 0,
    created_at   TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS plans (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    price     INTEGER NOT NULL DEFAULT 0,
    duration  TEXT NOT NULL,
    benefits  TEXT
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    plan       TEXT,
    amount     INTEGER,
    method     TEXT,
    status     TEXT DEFAULT 'Paid',
    reference  TEXT,
    date       TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id        TEXT PRIMARY KEY,
    user_id   TEXT,
    user_name TEXT,
    email     TEXT,
    action    TEXT,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id       TEXT PRIMARY KEY,
    user_id  TEXT NOT NULL,
    title    TEXT,
    message  TEXT,
    date     TEXT,
    read     INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS promo_codes (
    code TEXT PRIMARY KEY,
    pct  INTEGER NOT NULL
  );
  `);
}

module.exports = { db, init, seed };

function seed() {
  init();
  const now = new Date().toISOString();
  const count = db.prepare('SELECT COUNT(*) AS c FROM plans').get().c;
  if (count === 0) {
    const insPlan = db.prepare('INSERT INTO plans (id,name,price,duration,benefits) VALUES (?,?,?,?,?)');
    [
      ['sub_free', 'Free Tier', 0, 'Forever', 'SD Streaming, 1 Device, Ad-supported'],
      ['sub_daily', 'Daily Pass', 100, '1 Day', 'HD Streaming, 1 Device, Ad-free'],
      ['sub_weekly', 'Weekly Flex', 500, '7 Days', 'Full HD, 2 Devices, Offline Downloads'],
      ['sub_monthly', 'Monthly Standard', 1500, '30 Days', 'Full HD, 3 Devices, Exclusive Series'],
      ['sub_premium', 'Premium Global VIP', 2500, '30 Days', '4K Ultra HD, 5 Devices, Dolby Atmos, VIP Access']
    ].forEach(p => insPlan.run(...p));
  }

  const promoCount = db.prepare('SELECT COUNT(*) AS c FROM promo_codes').get().c;
  if (promoCount === 0) {
    const insP = db.prepare('INSERT INTO promo_codes (code,pct) VALUES (?,?)');
    insP.run('AURA10', 10); insP.run('WELCOME20', 20);
  }

  // Seed an initial Super Admin account if none exists.
  const adminEmail = 'admin@aurastream.global';
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail);
  if (!existing) {
    const hash = bcrypt.hashSync('ChangeMe!2026', 10);
    db.prepare(`INSERT INTO users
      (id,name,email,password_hash,role,is_creator,avatar,country,currency,status,plan_id,plan_name,plan_status,plan_expires,settings_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'usr_admin', 'Platform Admin', adminEmail, hash, 'Super Admin', 1,
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
      'Nigeria', 'NGN', 'Active', 'sub_premium', 'Premium Global VIP', 'Active', '2027-12-31', '{}', now);
    console.log('Seeded Super Admin:', adminEmail, '(password: ChangeMe!2026 — change it after first login)');
  }

  // Seed sample channels + content so the site is not empty on first run.
  const chCount = db.prepare('SELECT COUNT(*) AS c FROM channels').get().c;
  if (chCount === 0) {
    const insCh = db.prepare('INSERT INTO channels (id,owner_id,name,logo,category,stream_key,is_live,current,next,viewers,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    [
      ['ch_1', 'usr_admin', 'Aura Prime HD', '🌟', 'Entertainment', 'prime-hd', 0, 'Lagos Empire S01E02', 'African Cinema Showcase', '142k watching'],
      ['ch_2', 'usr_admin', 'Aura Sports Arena', '⚽', 'Sports', 'sports-arena', 0, 'Live: Premier League Derby', 'Champions League Review', '389k watching'],
      ['ch_3', 'usr_admin', 'Aura Nollywood Central', '🎬', 'Movies', 'nollywood', 0, 'Ancestral Vengeance (Part 2)', 'Lagos Nights', '95k watching']
    ].forEach(c => insCh.run(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], now));
  }

  const coCount = db.prepare('SELECT COUNT(*) AS c FROM contents').get().c;
  if (coCount === 0) {
    const insC = db.prepare(`INSERT INTO contents
      (id,owner_id,title,type,genre,year,rating,poster,video_url,description,cast_json,status,is_featured,is_trending,is_premium,is_african,is_nigerian,views,likes,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insC.run('c_1', 'usr_admin', 'Lagos Empire: Rise of Syndicate', 'series', 'Crime / Drama', 2026, '18+',
      'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&q=80&w=800',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      'An elite syndicate navigates high-stakes corporate espionage across Victoria Island and Lekki.',
      JSON.stringify(['Soji Adebayo', 'Funke Akindele']), 'Approved', 1, 1, 1, 1, 1, 45200, 12400, now);
    insC.run('c_6', 'usr_admin', 'Global Soccer Championship: Final Showdown', 'sports', 'Sports', 2026, 'G',
      'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&q=80&w=800',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      'Relive the greatest football rivalry match of the decade with multi-angle camera feeds.',
      JSON.stringify(['Various Commentators']), 'Approved', 1, 0, 0, 0, 0, 340000, 98000, now);
  }
  console.log('Database seeded.');
}

if (require.main === module && process.argv.includes('--seed')) {
  seed();
  process.exit(0);
}
