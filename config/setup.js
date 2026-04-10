// config/setup.js
// Run once: node config/setup.js
// Creates all database tables

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './database/penhire.db';

// Ensure directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('🔧 Setting up PenHire database...\n');

// ── CREATE TABLES ──
db.exec(`

  -- USERS (Writers)
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    phone       TEXT NOT NULL,
    password    TEXT NOT NULL,
    speciality  TEXT NOT NULL,
    bio         TEXT DEFAULT '',
    avatar      TEXT DEFAULT '',
    is_verified INTEGER DEFAULT 0,
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now')),
    last_login  TEXT
  );

  -- EMPLOYERS
  CREATE TABLE IF NOT EXISTS employers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    company     TEXT DEFAULT '',
    country     TEXT DEFAULT '',
    is_verified INTEGER DEFAULT 0,
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  -- JOBS
  CREATE TABLE IF NOT EXISTS jobs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid          TEXT UNIQUE NOT NULL,
    title         TEXT NOT NULL,
    company       TEXT NOT NULL,
    country       TEXT NOT NULL,
    category      TEXT NOT NULL,
    pay_min       REAL NOT NULL,
    pay_max       REAL NOT NULL,
    pay_type      TEXT NOT NULL,
    description   TEXT NOT NULL,
    requirements  TEXT DEFAULT '',
    apply_email   TEXT NOT NULL,
    apply_url     TEXT DEFAULT '',
    tags          TEXT DEFAULT '[]',
    unlock_kes    INTEGER NOT NULL,
    unlock_usd    REAL NOT NULL,
    post_fee_usd  REAL NOT NULL,
    source        TEXT DEFAULT 'manual',
    source_url    TEXT DEFAULT '',
    employer_id   INTEGER REFERENCES employers(id),
    is_active     INTEGER DEFAULT 1,
    is_featured   INTEGER DEFAULT 0,
    views         INTEGER DEFAULT 0,
    unlocks       INTEGER DEFAULT 0,
    expires_at    TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  -- UNLOCKS (Track who unlocked what)
  CREATE TABLE IF NOT EXISTS unlocks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id),
    job_id        INTEGER REFERENCES jobs(id),
    payment_method TEXT NOT NULL,
    amount_kes    INTEGER,
    amount_usd    REAL,
    transaction_id TEXT UNIQUE,
    status        TEXT DEFAULT 'pending',
    created_at    TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, job_id)
  );

  -- MPESA TRANSACTIONS
  CREATE TABLE IF NOT EXISTS mpesa_transactions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    checkout_request_id TEXT UNIQUE,
    merchant_request_id TEXT,
    phone             TEXT NOT NULL,
    amount            INTEGER NOT NULL,
    reference         TEXT NOT NULL,
    description       TEXT DEFAULT '',
    status            TEXT DEFAULT 'pending',
    result_code       INTEGER,
    result_desc       TEXT,
    mpesa_receipt     TEXT,
    transaction_date  TEXT,
    user_id           INTEGER REFERENCES users(id),
    job_id            INTEGER REFERENCES jobs(id),
    created_at        TEXT DEFAULT (datetime('now')),
    updated_at        TEXT DEFAULT (datetime('now'))
  );

  -- PAYPAL TRANSACTIONS
  CREATE TABLE IF NOT EXISTS paypal_transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    paypal_order_id TEXT UNIQUE,
    payer_email   TEXT,
    amount_usd    REAL NOT NULL,
    currency      TEXT DEFAULT 'USD',
    status        TEXT DEFAULT 'pending',
    purpose       TEXT NOT NULL,
    reference_id  INTEGER,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
  );

  -- JOB POSTINGS (Employer payments)
  CREATE TABLE IF NOT EXISTS job_postings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id          INTEGER REFERENCES jobs(id),
    employer_email  TEXT NOT NULL,
    fee_usd         REAL NOT NULL,
    payment_id      TEXT,
    payment_status  TEXT DEFAULT 'pending',
    created_at      TEXT DEFAULT (datetime('now'))
  );

  -- SCRAPE LOG
  CREATE TABLE IF NOT EXISTS scrape_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,
    jobs_found  INTEGER DEFAULT 0,
    jobs_added  INTEGER DEFAULT 0,
    status      TEXT DEFAULT 'success',
    error       TEXT DEFAULT '',
    duration_ms INTEGER DEFAULT 0,
    scraped_at  TEXT DEFAULT (datetime('now'))
  );

  -- ADMIN
  CREATE TABLE IF NOT EXISTS admins (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    email     TEXT UNIQUE NOT NULL,
    password  TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- EMAIL QUEUE
  CREATE TABLE IF NOT EXISTS email_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email    TEXT NOT NULL,
    subject     TEXT NOT NULL,
    html        TEXT NOT NULL,
    status      TEXT DEFAULT 'pending',
    attempts    INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    sent_at     TEXT
  );

  -- INDEXES for performance
  CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category);
  CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(is_active);
  CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_unlocks_user ON unlocks(user_id);
  CREATE INDEX IF NOT EXISTS idx_unlocks_job ON unlocks(job_id);
  CREATE INDEX IF NOT EXISTS idx_mpesa_checkout ON mpesa_transactions(checkout_request_id);

`);

// ── SEED ADMIN ──
const adminEmail = process.env.ADMIN_EMAIL || 'admin@penhire.com';
const adminPass  = process.env.ADMIN_PASSWORD || 'Admin@PenHire2024!';
const hashed     = bcrypt.hashSync(adminPass, 12);

const adminExists = db.prepare('SELECT id FROM admins WHERE email = ?').get(adminEmail);
if (!adminExists) {
  db.prepare('INSERT INTO admins (email, password) VALUES (?, ?)').run(adminEmail, hashed);
  console.log(`✅ Admin created: ${adminEmail}`);
}

// ── SEED SAMPLE JOBS ──
const { v4: uuidv4 } = require('uuid');
const sampleJobs = [
  {
    title: 'Health & Wellness Blog Writer',
    company: 'US Health Blog', country: 'USA', category: 'blog',
    pay_min: 25, pay_max: 40, pay_type: 'Per Article',
    description: 'We need a talented health writer to produce 1,500-word SEO-optimised articles for our US wellness blog. Topics include nutrition, mental health, fitness, and natural remedies. We assign 4 articles per month. Must be comfortable with APA referencing and keyword placement. Strong command of English is essential. Long-term relationship for the right writer.',
    requirements: 'Strong English writing skills. Health knowledge preferred. SEO experience a bonus.',
    apply_email: 'editor@ushealthblog.com',
    tags: JSON.stringify(['Health', 'Wellness', 'SEO', 'Blog']),
    unlock_kes: 200, unlock_usd: 2.00, post_fee_usd: 10,
    source: 'manual'
  },
  {
    title: 'Technical Writer – SaaS Documentation',
    company: 'UK Tech Startup', country: 'UK', category: 'technical',
    pay_min: 150, pay_max: 300, pay_type: 'Per Project',
    description: 'Fast-growing UK SaaS company needs a sharp technical writer to produce user documentation, onboarding guides, and API references. Projects are 5,000–10,000 words. You will work directly with our engineering team. Must be comfortable with markdown and GitHub.',
    requirements: 'Technical writing experience. Familiarity with software products. GitHub a plus.',
    apply_email: 'hiring@uktechstartup.io',
    tags: JSON.stringify(['Technical', 'SaaS', 'Documentation', 'GitHub']),
    unlock_kes: 500, unlock_usd: 4.00, post_fee_usd: 20,
    source: 'manual'
  },
  {
    title: 'Social Media Copywriter',
    company: 'AU eCommerce Brand', country: 'Australia', category: 'social',
    pay_min: 15, pay_max: 25, pay_type: 'Per Post',
    description: 'We run a growing Australian eCommerce brand selling lifestyle products. Need a creative copywriter for Instagram, Facebook, and TikTok captions. 20 posts per week. Must understand brand tone — fun, relatable, conversion-focused. Ongoing work for the right person.',
    requirements: 'Creative copywriting. Social media knowledge. Consistent and reliable.',
    apply_email: 'content@aubrand.com.au',
    tags: JSON.stringify(['Social Media', 'Copy', 'eCommerce', 'Creative']),
    unlock_kes: 100, unlock_usd: 1.00, post_fee_usd: 5,
    source: 'manual'
  }
];

const insertJob = db.prepare(`
  INSERT OR IGNORE INTO jobs
  (uuid, title, company, country, category, pay_min, pay_max, pay_type,
   description, requirements, apply_email, tags, unlock_kes, unlock_usd,
   post_fee_usd, source, is_active, expires_at)
  VALUES
  (@uuid, @title, @company, @country, @category, @pay_min, @pay_max, @pay_type,
   @description, @requirements, @apply_email, @tags, @unlock_kes, @unlock_usd,
   @post_fee_usd, @source, 1,
   datetime('now', '+30 days'))
`);

let seeded = 0;
for (const job of sampleJobs) {
  const result = insertJob.run({ ...job, uuid: uuidv4() });
  if (result.changes) seeded++;
}
if (seeded) console.log(`✅ Seeded ${seeded} sample jobs`);

console.log('\n✅ Database setup complete!');
console.log('📁 Database location:', DB_PATH);
console.log('\nNext steps:');
console.log('  1. Copy .env.example to .env and fill in your keys');
console.log('  2. Run: node server.js');
console.log('  3. Visit: http://localhost:3000\n');

db.close();
