// server.js — PenHire Main Server

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const cron      = require('node-cron');
const path      = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const { initDB, getDB, run, get, all, saveDB } = require('./config/database');
const mpesaLib  = require('./backend/mpesa');
const paypalLib = require('./backend/paypal');
const emailLib  = require('./backend/email');
const { runAllScrapers } = require('./scraper/scraper');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ──
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'frontend')));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use('/api/', limiter);

// ── AUTH MIDDLEWARE ──
function authRequired(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Login required' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired session' }); }
}

function adminRequired(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Admin access required' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    req.admin = decoded; next();
  } catch { res.status(401).json({ error: 'Invalid session' }); }
}

// ── HEALTH CHECK ──
app.get('/api/health', (req, res) => {
  const jobs = get('SELECT COUNT(*) as c FROM jobs WHERE is_active = 1');
  res.json({ status: 'ok', jobs: jobs?.c || 0, uptime: process.uptime(), time: new Date().toISOString() });
});

// ══════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════
app.post('/api/auth/register', async (req, res) => {
  const { name, email, phone, password, speciality } = req.body;
  if (!name || !email || !phone || !password || !speciality)
    return res.status(400).json({ error: 'All fields required' });

  const exists = get('SELECT id FROM users WHERE email = ?', [email]);
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const uuid = uuidv4();
  const hashed = bcrypt.hashSync(password, 12);
  run('INSERT INTO users (uuid, name, email, phone, password, speciality) VALUES (?, ?, ?, ?, ?, ?)',
    [uuid, name, email, phone, hashed, speciality]);

  const user = get('SELECT * FROM users WHERE uuid = ?', [uuid]);
  const token = jwt.sign({ id: user.id, uuid, email, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '30d' });
  emailLib.sendWelcome(user).catch(console.error);
  res.json({ success: true, token, user: { id: user.id, name, email, speciality } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid email or password' });
  run('UPDATE users SET last_login = datetime("now") WHERE id = ?', [user.id]);
  const token = jwt.sign({ id: user.id, uuid: user.uuid, email: user.email, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, speciality: user.speciality } });
});

app.post('/api/auth/admin', (req, res) => {
  const { email, password } = req.body;
  const admin = get('SELECT * FROM admins WHERE email = ?', [email]);
  if (!admin || !bcrypt.compareSync(password, admin.password))
    return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: admin.id, email: admin.email, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ success: true, token });
});

// ══════════════════════════════════════════
// JOBS ROUTES
// ══════════════════════════════════════════
app.get('/api/jobs', (req, res) => {
  const { category, search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let where = 'WHERE is_active = 1';
  const params = [];
  if (category && category !== 'all') { where += ' AND category = ?'; params.push(category); }
  if (search) { where += ' AND (title LIKE ? OR company LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  const jobs = all(
    `SELECT id, uuid, title, company, country, category, pay_min, pay_max, pay_type,
     tags, unlock_kes, unlock_usd, source, views, unlocks, created_at, is_featured,
     SUBSTR(description, 1, 150) || '...' as description_preview
     FROM jobs ${where} ORDER BY is_featured DESC, created_at DESC LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), offset]
  );
  const total = get(`SELECT COUNT(*) as c FROM jobs ${where}`, params);
  res.json({ jobs, total: total?.c || 0, page: parseInt(page) });
});

app.get('/api/jobs/:uuid', (req, res) => {
  const job = get(
    `SELECT id, uuid, title, company, country, category, pay_min, pay_max, pay_type,
     tags, unlock_kes, unlock_usd, source, views, unlocks, created_at,
     SUBSTR(description, 1, 200) || '...' as description_preview, requirements
     FROM jobs WHERE uuid = ? AND is_active = 1`, [req.params.uuid]
  );
  if (!job) return res.status(404).json({ error: 'Job not found' });
  run('UPDATE jobs SET views = views + 1 WHERE uuid = ?', [req.params.uuid]);
  res.json(job);
});

app.get('/api/jobs/:uuid/full', authRequired, (req, res) => {
  const job = get('SELECT * FROM jobs WHERE uuid = ? AND is_active = 1', [req.params.uuid]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const unlock = get('SELECT * FROM unlocks WHERE user_id = ? AND job_id = ? AND status = "completed"', [req.user.id, job.id]);
  if (!unlock) return res.status(403).json({ error: 'Job not unlocked. Please pay to unlock.' });
  res.json({ ...job, unlocked: true });
});

app.get('/api/jobs/:uuid/unlock-status', authRequired, (req, res) => {
  const job = get('SELECT id FROM jobs WHERE uuid = ?', [req.params.uuid]);
  if (!job) return res.json({ unlocked: false });
  const unlock = get('SELECT status FROM unlocks WHERE user_id = ? AND job_id = ?', [req.user.id, job.id]);
  res.json({ unlocked: unlock?.status === 'completed' });
});

// ══════════════════════════════════════════
// M-PESA ROUTES
// ══════════════════════════════════════════
app.post('/api/mpesa/initiate', authRequired, async (req, res) => {
  const { phone, jobUuid } = req.body;
  if (!phone || !jobUuid) return res.status(400).json({ error: 'Phone and job required' });
  const job = get('SELECT * FROM jobs WHERE uuid = ? AND is_active = 1', [jobUuid]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const existing = get('SELECT status FROM unlocks WHERE user_id = ? AND job_id = ?', [req.user.id, job.id]);
  if (existing?.status === 'completed') return res.json({ success: true, message: 'Already unlocked' });

  try {
    const result = await mpesaLib.initiateSTKPush({
      phone, amount: job.unlock_kes,
      reference: `UNLOCK-${job.id}-${req.user.id}`,
      description: `Unlock: ${job.title}`
    });
    if (result.ResponseCode !== '0') return res.status(400).json({ error: result.ResponseDescription });
    run('INSERT OR REPLACE INTO mpesa_transactions (checkout_request_id, merchant_request_id, phone, amount, reference, user_id, job_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, "pending")',
      [result.CheckoutRequestID, result.MerchantRequestID, mpesaLib.formatPhone(phone), job.unlock_kes, `UNLOCK-${job.id}`, req.user.id, job.id]);
    res.json({ success: true, checkoutRequestId: result.CheckoutRequestID, message: result.CustomerMessage });
  } catch (err) {
    res.status(500).json({ error: 'M-Pesa unavailable. Try again.' });
  }
});

app.post('/api/mpesa/callback', express.raw({ type: '*/*' }), (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const result = mpesaLib.processCallback(body);
    if (!result) return;
    const tx = get('SELECT * FROM mpesa_transactions WHERE checkout_request_id = ?', [result.checkoutRequestId]);
    if (!tx) return;
    if (result.success) {
      run('UPDATE mpesa_transactions SET status="completed", mpesa_receipt=?, updated_at=datetime("now") WHERE checkout_request_id=?',
        [result.receipt, result.checkoutRequestId]);
      run('INSERT OR IGNORE INTO unlocks (user_id, job_id, payment_method, amount_kes, transaction_id, status) VALUES (?, ?, "mpesa", ?, ?, "completed")',
        [tx.user_id, tx.job_id, tx.amount, result.receipt]);
      run('UPDATE jobs SET unlocks = unlocks + 1 WHERE id = ?', [tx.job_id]);
      const user = get('SELECT * FROM users WHERE id = ?', [tx.user_id]);
      const job  = get('SELECT * FROM jobs WHERE id = ?', [tx.job_id]);
      if (user && job) emailLib.sendJobUnlocked(user, job).catch(console.error);
    } else {
      run('UPDATE mpesa_transactions SET status="failed", result_desc=? WHERE checkout_request_id=?',
        [result.resultDesc, result.checkoutRequestId]);
    }
  } catch (err) { console.error('Callback error:', err.message); }
});

app.get('/api/mpesa/status/:checkoutId', authRequired, (req, res) => {
  const tx = get('SELECT * FROM mpesa_transactions WHERE checkout_request_id = ?', [req.params.checkoutId]);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ status: tx.status, receipt: tx.mpesa_receipt });
});

// ══════════════════════════════════════════
// PAYPAL ROUTES
// ══════════════════════════════════════════
app.post('/api/paypal/create-job-order', async (req, res) => {
  const { title, category, budget, description, applyEmail, employerName } = req.body;
  if (!title || !budget || !description || !applyEmail)
    return res.status(400).json({ error: 'All fields required' });
  const feeMap = { '3': 3, '5': 5, '10': 10, '20': 20, '40': 40 };
  const fee = feeMap[budget];
  if (!fee) return res.status(400).json({ error: 'Invalid budget' });
  try {
    const order = await paypalLib.createOrder({ amount: fee, description: `PenHire Job: ${title}`, referenceId: `job-${Date.now()}` });
    run('INSERT INTO jobs (uuid, title, company, country, category, pay_min, pay_max, pay_type, description, apply_email, tags, unlock_kes, unlock_usd, post_fee_usd, source, is_active) VALUES (?, ?, ?, "Remote", ?, 20, 100, "Per Project", ?, ?, "[]", 200, 2, ?, "employer", 0)',
      [order.orderId, title, employerName || 'Employer', category || 'blog', description, applyEmail, fee]);
    res.json({ orderId: order.orderId, approvalUrl: order.approvalUrl });
  } catch (err) {
    res.status(500).json({ error: 'PayPal unavailable' });
  }
});

app.post('/api/paypal/capture/:orderId', async (req, res) => {
  try {
    const result = await paypalLib.captureOrder(req.params.orderId);
    if (result.success) {
      run('UPDATE jobs SET is_active = 1, expires_at = datetime("now", "+30 days"), uuid = ? WHERE uuid = ?',
        [uuidv4(), req.params.orderId]);
      const job = get('SELECT * FROM jobs WHERE is_active = 1 ORDER BY id DESC LIMIT 1');
      if (job) {
        emailLib.sendJobPosted({ email: result.payerEmail }, job).catch(console.error);
        emailLib.sendAdminNewJob(job).catch(console.error);
      }
      res.json({ success: true, message: 'Job posted! Writers can now see it.' });
    } else {
      res.status(400).json({ error: 'Payment not completed' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Payment capture failed' });
  }
});

// ══════════════════════════════════════════
// USER ROUTES
// ══════════════════════════════════════════
app.get('/api/user/unlocks', authRequired, (req, res) => {
  const unlocks = all(
    `SELECT j.uuid, j.title, j.company, j.country, j.pay_min, j.pay_max,
     j.pay_type, j.apply_email, j.apply_url, j.description, j.requirements,
     j.tags, u.created_at as unlocked_at
     FROM unlocks u JOIN jobs j ON u.job_id = j.id
     WHERE u.user_id = ? AND u.status = "completed" ORDER BY u.created_at DESC`,
    [req.user.id]
  );
  res.json(unlocks);
});

app.get('/api/user/profile', authRequired, (req, res) => {
  const user = get('SELECT id, uuid, name, email, phone, speciality, bio, created_at FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ══════════════════════════════════════════
// ADMIN ROUTES
// ══════════════════════════════════════════
app.get('/api/admin/stats', adminRequired, (req, res) => {
  res.json({
    totalJobs:    get('SELECT COUNT(*) as c FROM jobs WHERE is_active = 1')?.c || 0,
    totalUsers:   get('SELECT COUNT(*) as c FROM users')?.c || 0,
    totalUnlocks: get('SELECT COUNT(*) as c FROM unlocks WHERE status = "completed"')?.c || 0,
    todayUnlocks: get('SELECT COUNT(*) as c FROM unlocks WHERE date(created_at) = date("now") AND status = "completed"')?.c || 0,
    lastScrape:   get('SELECT * FROM scrape_log ORDER BY id DESC LIMIT 1'),
    recentJobs:   all('SELECT title, company, source, created_at FROM jobs ORDER BY id DESC LIMIT 10'),
    scrapeHistory:all('SELECT * FROM scrape_log ORDER BY id DESC LIMIT 20')
  });
});

app.post('/api/admin/scrape', adminRequired, (req, res) => {
  res.json({ success: true, message: 'Scrape started' });
  runAllScrapers().catch(console.error);
});

app.get('/api/admin/jobs', adminRequired, (req, res) => {
  res.json(all('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100'));
});

app.patch('/api/admin/jobs/:id', adminRequired, (req, res) => {
  const { is_active, is_featured } = req.body;
  run('UPDATE jobs SET is_active = ?, is_featured = ? WHERE id = ?', [is_active, is_featured, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/admin/jobs/:id', adminRequired, (req, res) => {
  run('UPDATE jobs SET is_active = 0 WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ── SERVE FRONTEND ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ══════════════════════════════════════════
// START
// ══════════════════════════════════════════
async function start() {
  await initDB();
  console.log('✅ Database ready');

  app.listen(PORT, () => {
    console.log(`✒  PenHire running on port ${PORT}`);
    console.log(`🌍 ${process.env.BASE_URL || 'http://localhost:' + PORT}`);
  });

  // Cron: scrape every 2 hours
  cron.schedule('0 */2 * * *', () => {
    console.log('⏰ Scheduled scrape starting...');
    runAllScrapers().catch(console.error);
  });

  // Cron: expire old jobs daily
  cron.schedule('0 0 * * *', () => {
    run("UPDATE jobs SET is_active = 0 WHERE expires_at < datetime('now') AND is_active = 1");
    console.log('⏰ Old jobs expired');
  });

  // Initial scrape 30 seconds after start
  setTimeout(() => {
    console.log('🔍 Running initial scrape...');
    runAllScrapers().catch(console.error);
  }, 30000);
}

start().catch(console.error);
module.exports = app;
