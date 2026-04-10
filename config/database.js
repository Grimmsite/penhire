// config/database.js
// Uses sql.js (pure JavaScript SQLite - no native compilation needed)
// Works perfectly on Render free tier

const path = require('path');
const fs   = require('fs');
require('dotenv').config();

// Persistent disk on Render paid tier mounts at /var/data
// Free tier: in-memory only (data resets on restart - jobs re-scraped automatically)
const DB_DIR  = fs.existsSync('/var/data') ? '/var/data' : path.join(__dirname, '../database');
const DB_PATH = path.join(DB_DIR, 'penhire.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

let db;
let SQL;

async function initDB() {
  if (db) return db;

  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();

  // Load existing database from disk if it exists
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  ensureSchema();
  return db;
}

// Save database to disk
function saveDB() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('DB save error:', e.message);
  }
}

// Auto-save every 30 seconds
setInterval(saveDB, 30000);
process.on('exit', saveDB);
process.on('SIGINT', () => { saveDB(); process.exit(); });
process.on('SIGTERM', () => { saveDB(); process.exit(); });

function getDB() {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db;
}

// Helper: run a query that modifies data
function run(sql, params = []) {
  db.run(sql, params);
  saveDB();
}

// Helper: get one row
function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

// Helper: get all rows
function all(sql, params = []) {
  const results = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

// Helper: exec multiple statements
function exec(sql) {
  db.run(sql);
}

function ensureSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT NOT NULL,
      password TEXT NOT NULL,
      speciality TEXT NOT NULL,
      bio TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      country TEXT NOT NULL,
      category TEXT NOT NULL,
      pay_min REAL NOT NULL,
      pay_max REAL NOT NULL,
      pay_type TEXT NOT NULL,
      description TEXT NOT NULL,
      requirements TEXT DEFAULT '',
      apply_email TEXT NOT NULL,
      apply_url TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      unlock_kes INTEGER NOT NULL,
      unlock_usd REAL NOT NULL,
      post_fee_usd REAL NOT NULL,
      source TEXT DEFAULT 'manual',
      source_url TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      is_featured INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0,
      unlocks INTEGER DEFAULT 0,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS unlocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      job_id INTEGER,
      payment_method TEXT NOT NULL,
      amount_kes INTEGER,
      transaction_id TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS mpesa_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checkout_request_id TEXT UNIQUE,
      merchant_request_id TEXT,
      phone TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reference TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      result_code INTEGER,
      result_desc TEXT,
      mpesa_receipt TEXT,
      transaction_date TEXT,
      user_id INTEGER,
      job_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS paypal_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paypal_order_id TEXT UNIQUE,
      payer_email TEXT,
      amount_usd REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      purpose TEXT NOT NULL,
      reference_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS job_postings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      employer_email TEXT NOT NULL,
      fee_usd REAL NOT NULL,
      payment_id TEXT,
      payment_status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS scrape_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      jobs_found INTEGER DEFAULT 0,
      jobs_added INTEGER DEFAULT 0,
      status TEXT DEFAULT 'success',
      error TEXT DEFAULT '',
      duration_ms INTEGER DEFAULT 0,
      scraped_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(is_active)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_unlocks_user ON unlocks(user_id)`);

  // Seed admin
  const bcrypt = require('bcryptjs');
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPass  = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPass) {
    const exists = get('SELECT id FROM admins WHERE email = ?', [adminEmail]);
    if (!exists) {
      run('INSERT INTO admins (email, password) VALUES (?, ?)',
        [adminEmail, bcrypt.hashSync(adminPass, 12)]);
    }
  }

  saveDB();
  console.log('✅ Database schema ready. Path:', DB_PATH);
}

module.exports = { initDB, getDB, run, get, all, exec, saveDB, DB_PATH };
