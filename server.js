// server.js — PenHire Main Server (IntaSend payments)

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
const { createUnlockCheckout, createPostingCheckout } = require('./backend/intasend');
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

  const uuid   = uuidv4();
  const hashed = bcrypt.hashSync(password, 12);
  run('INSERT INTO users (uuid, name, email, phone, password, speciality) VALUES (?, ?, ?, ?, ?, ?)',
    [uuid, name, email, phone, hashed, speciality]);

  const user  = get('SELECT * FROM users WHERE uuid = ?', [uuid]);
  const token = jwt.sign({ id: user.id, uuid, email, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '30d' });
  emailLib.sendWelcome(user).then(() => console.log('Welcome email sent to:', user.email)).catch(err => console.error('Welcome email ERROR:', err.message || err));
  res.json({
    success: true, token,
    user: { id: user.id, uuid: user.uuid, name, email, phone, speciality, bio: '', created_at: user.created_at }
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid email or password' });
  run('UPDATE users SET last_login = datetime("now") WHERE id = ?', [user.id]);
  const token = jwt.sign(
    { id: user.id, uuid: user.uuid, email: user.email, role: 'user' },
    process.env.JWT_SECRET, { expiresIn: '30d' }
  );
  res.json({
    success: true, token,
    user: { id: user.id, uuid: user.uuid, name: user.name, email: user.email, phone: user.phone, speciality: user.speciality, bio: user.bio || '', created_at: user.created_at }
  });
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
  const { category, search, page = 1, limit = 20, source, sort } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let where = 'WHERE is_active = 1';
  const params = [];

  if (category && category !== 'all') { where += ' AND category = ?'; params.push(category); }
  if (search) {
    where += ' AND (title LIKE ? OR company LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (source && source !== 'all') {
    if (source === 'employer') { where += ' AND source = "employer"'; }
    else { where += ' AND source = ?'; params.push(source); }
  }

  const orderBy = sort === 'pay_high' ? 'pay_max DESC' :
                  sort === 'pay_low'  ? 'unlock_kes ASC' :
                  'is_featured DESC, created_at DESC';

  const pageSize = Math.min(parseInt(limit) || 20, 50);
  const jobs = all(
    `SELECT id, uuid, title, company, country, category, pay_min, pay_max, pay_type,
     tags, unlock_kes, unlock_usd, source, views, unlocks, created_at, is_featured,
     SUBSTR(description, 1, 180) || '...' as description_preview
     FROM jobs ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const total = get(`SELECT COUNT(*) as c FROM jobs ${where}`, params);
  const pages = Math.ceil((total?.c || 0) / pageSize);
  res.json({ jobs, total: total?.c || 0, page: parseInt(page), pages });
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
  const unlock = get(
    'SELECT * FROM unlocks WHERE user_id = ? AND job_id = ? AND status = "completed"',
    [req.user.id, job.id]
  );
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
// INTASEND — JOB UNLOCK (KES)
// ══════════════════════════════════════════

// Step 1: User initiates payment — we create an IntaSend checkout
app.post('/api/intasend/initiate-unlock', authRequired, async (req, res) => {
  const { jobUuid } = req.body;
  if (!jobUuid) return res.status(400).json({ error: 'Job UUID required' });

  const job = get('SELECT * FROM jobs WHERE uuid = ? AND is_active = 1', [jobUuid]);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  // Check if already unlocked
  const existing = get(
    'SELECT status FROM unlocks WHERE user_id = ? AND job_id = ?',
    [req.user.id, job.id]
  );
  if (existing?.status === 'completed') return res.json({ success: true, message: 'Already unlocked' });

  const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found. Please sign in again.' });

  try {
    const checkout = await createUnlockCheckout({
      email:      user.email,
      first_name: user.name.split(' ')[0],
      last_name:  user.name.split(' ').slice(1).join(' ') || '',
      phone:      user.phone,
      amount:     job.unlock_kes,
      jobUuid:    jobUuid,
      userId:     req.user.id,
      jobId:      job.id
    });

    // Save pending transaction
    run(
      `INSERT OR REPLACE INTO intasend_transactions
       (invoice_id, api_ref, purpose, email, phone, amount, currency, status, user_id, job_id)
       VALUES (?, ?, 'unlock', ?, ?, ?, 'KES', 'pending', ?, ?)`,
      [checkout.id || null, checkout.api_ref || `unlock_${job.id}_${req.user.id}_${Date.now()}`,
       user.email, user.phone, job.unlock_kes, req.user.id, job.id]
    );

    res.json({
      success:     true,
      url:         checkout.url,         // redirect user to this IntaSend checkout URL
      invoice_id:  checkout.id,
      message:     'Redirecting to payment...'
    });
  } catch (err) {
    console.error('IntaSend unlock error:', err);
    res.status(500).json({ error: 'Payment initiation failed. Please try again.' });
  }
});

// Step 2: IntaSend webhook — confirms payment and completes the unlock
app.post('/api/intasend/webhook', express.raw({ type: '*/*' }), (req, res) => {
  // Respond immediately to IntaSend
  res.status(200).json({ message: 'Webhook received' });

  try {
    const body    = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const state   = body.state;
    const api_ref = body.api_ref;
    const invoice = body.invoice_id || body.id;

    console.log('📩 IntaSend webhook:', { state, api_ref, invoice });

    if (!api_ref) return;

    // Find the transaction by api_ref
    const tx = get('SELECT * FROM intasend_transactions WHERE api_ref = ?', [api_ref]);
    if (!tx) {
      console.warn('⚠️ No transaction found for api_ref:', api_ref);
      return;
    }

    if (state === 'COMPLETE') {
      // Update transaction status
      run(
        'UPDATE intasend_transactions SET status = "complete", invoice_id = ?, updated_at = datetime("now") WHERE api_ref = ?',
        [invoice || tx.invoice_id, api_ref]
      );

      if (tx.purpose === 'unlock') {
        // ── JOB UNLOCK ──
        // Insert as pending_approval — admin approves before full job details are shown
        run(
          `INSERT OR IGNORE INTO unlocks
           (user_id, job_id, payment_method, amount_kes, transaction_id, status)
           VALUES (?, ?, 'intasend', ?, ?, 'pending_approval')`,
          [tx.user_id, tx.job_id, tx.amount, api_ref]
        );
        run('UPDATE jobs SET unlocks = unlocks + 1 WHERE id = ?', [tx.job_id]);

        // Notify admin to approve
        const user = get('SELECT * FROM users WHERE id = ?', [tx.user_id]);
        const job  = get('SELECT * FROM jobs WHERE id = ?', [tx.job_id]);
        if (user && job) {
          emailLib.sendEmail({
            to:      process.env.ADMIN_EMAIL,
            subject: `⏳ Unlock Approval Needed: ${job.title}`,
            html: `
              <p><strong>${user.name}</strong> (${user.email}) paid KES ${tx.amount}
              via IntaSend to unlock <strong>${job.title}</strong>.</p>
              <p><strong>Reference:</strong> ${api_ref}</p>
              <p><a href="${process.env.BASE_URL}/admin">Go to Admin Panel to approve →</a></p>
            `
          }).catch(console.error);
        }

      } else if (tx.purpose === 'posting') {
        // ── JOB POSTING ──
        const job = get('SELECT * FROM jobs WHERE uuid = ?', [tx.temp_job_id]);
        if (job) {
          const newUuid = uuidv4();
          run(
            'UPDATE jobs SET expires_at = datetime("now", "+30 days"), uuid = ?, is_active = 0 WHERE id = ?',
            [newUuid, job.id]
          );
          run(
            `INSERT INTO job_postings (job_id, employer_email, fee_usd, payment_id, payment_status)
             VALUES (?, ?, ?, ?, 'completed')`,
            [job.id, tx.email, tx.amount, api_ref]
          );
          // Notify admin to review
          emailLib.sendEmail({
            to:      process.env.ADMIN_EMAIL,
            subject: `📋 New Job Posting Needs Approval: ${job.title}`,
            html: `
              <p>A new employer job posting has been paid and is waiting for your approval.</p>
              <p><strong>Title:</strong> ${job.title}<br>
              <strong>Employer:</strong> ${job.company}<br>
              <strong>Email:</strong> ${tx.email}<br>
              <strong>Fee paid:</strong> $${tx.amount}</p>
              <p><a href="${process.env.BASE_URL}/admin">Review & Approve in Admin Panel →</a></p>
            `
          }).catch(console.error);
        }
      }

    } else if (state === 'FAILED') {
      run(
        'UPDATE intasend_transactions SET status = "failed", updated_at = datetime("now") WHERE api_ref = ?',
        [api_ref]
      );
      console.log(`❌ Payment failed for ref: ${api_ref}`);
    }

  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// Step 3: Check payment status (frontend polls this after redirect)
app.get('/api/intasend/status/:apiRef', authRequired, (req, res) => {
  const tx = get(
    'SELECT status, purpose, amount, currency FROM intasend_transactions WHERE api_ref = ?',
    [req.params.apiRef]
  );
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  res.json(tx);
});

// ══════════════════════════════════════════
// INTASEND — JOB POSTING (USD)
// ══════════════════════════════════════════
app.post('/api/intasend/create-job-order', async (req, res) => {
  const { title, category, budget, description, applyEmail, employerName, applyUrl, requirements } = req.body;
  if (!title || !budget || !description || !applyEmail)
    return res.status(400).json({ error: 'All fields required' });

  const feeMap = { '3': 3, '5': 5, '10': 10, '20': 20, '40': 40 };
  const fee = feeMap[String(budget)];
  if (!fee) return res.status(400).json({ error: 'Invalid budget' });

  try {
    // Create a temporary inactive job first
    const tempUuid = uuidv4();
    run(
      `INSERT INTO jobs
       (uuid, title, company, country, category, pay_min, pay_max, pay_type,
        description, requirements, apply_email, apply_url, tags,
        unlock_kes, unlock_usd, post_fee_usd, source, is_active)
       VALUES (?, ?, ?, 'Remote', ?, 20, 100, 'Per Project', ?, ?, ?, ?, '[]', 200, 2, ?, 'employer', 0)`,
      [tempUuid, title, employerName || 'Employer', category || 'blog',
       description, requirements || '', applyEmail, applyUrl || '', fee]
    );

    const tempJob = get('SELECT id FROM jobs WHERE uuid = ?', [tempUuid]);

    // Create IntaSend checkout
    const checkout = await createPostingCheckout({
      email:      applyEmail,
      first_name: employerName || 'Employer',
      amount:     fee,
      jobTitle:   title,
      tempJobId:  tempUuid
    });

    // Save pending transaction
    const apiRef = checkout.api_ref || `posting_${tempJob.id}_${Date.now()}`;
    run(
      `INSERT INTO intasend_transactions
       (invoice_id, api_ref, purpose, email, amount, currency, status, temp_job_id)
       VALUES (?, ?, 'posting', ?, ?, 'USD', 'pending', ?)`,
      [checkout.id || null, apiRef, applyEmail, fee, tempUuid]
    );

    res.json({
      success:    true,
      url:        checkout.url,   // redirect employer to this URL
      api_ref:    apiRef,
      message:    'Redirecting to payment...'
    });

  } catch (err) {
    console.error('Job posting payment error:', err);
    res.status(500).json({ error: 'Payment initiation failed. Try again.' });
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
     WHERE u.user_id = ? AND u.status = "completed"
     ORDER BY u.created_at DESC`,
    [req.user.id]
  );
  res.json(unlocks);
});

app.get('/api/user/profile', authRequired, (req, res) => {
  const user = get(
    'SELECT id, uuid, name, email, phone, speciality, bio, created_at FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.patch('/api/user/profile', authRequired, (req, res) => {
  const { name, phone, speciality, bio } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  run('UPDATE users SET name = ?, phone = ?, speciality = ?, bio = ? WHERE id = ?',
    [name, phone || '', speciality || '', bio || '', req.user.id]);
  const updated = get(
    'SELECT id, uuid, name, email, phone, speciality, bio, created_at FROM users WHERE id = ?',
    [req.user.id]
  );
  res.json({ success: true, user: updated });
});

app.post('/api/auth/change-password', authRequired, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!bcrypt.compareSync(currentPassword, user.password))
    return res.status(401).json({ error: 'Current password is incorrect' });
  run('UPDATE users SET password = ? WHERE id = ?', [bcrypt.hashSync(newPassword, 12), req.user.id]);
  res.json({ success: true });
});

// ══════════════════════════════════════════
// ADMIN ROUTES
// ══════════════════════════════════════════
app.get('/api/admin/stats', adminRequired, (req, res) => {
  res.json({
    totalJobs:      get('SELECT COUNT(*) as c FROM jobs WHERE is_active = 1')?.c || 0,
    pendingJobs:    get('SELECT COUNT(*) as c FROM jobs WHERE is_active = 0 AND source = "employer"')?.c || 0,
    totalUsers:     get('SELECT COUNT(*) as c FROM users')?.c || 0,
    totalUnlocks:   get('SELECT COUNT(*) as c FROM unlocks WHERE status = "completed"')?.c || 0,
    pendingUnlocks: get('SELECT COUNT(*) as c FROM unlocks WHERE status = "pending_approval"')?.c || 0,
    todayUnlocks:   get('SELECT COUNT(*) as c FROM unlocks WHERE date(created_at) = date("now") AND status = "completed"')?.c || 0,
    totalRevenue:   get('SELECT COALESCE(SUM(amount), 0) as c FROM intasend_transactions WHERE status = "complete"')?.c || 0,
    lastScrape:     get('SELECT * FROM scrape_log ORDER BY id DESC LIMIT 1'),
    recentJobs:     all('SELECT title, company, source, is_active, created_at FROM jobs ORDER BY id DESC LIMIT 10'),
    scrapeHistory:  all('SELECT * FROM scrape_log ORDER BY id DESC LIMIT 20')
  });
});

app.get('/api/admin/jobs', adminRequired, (req, res) => {
  const { status } = req.query;
  let where = '';
  if (status === 'pending') where = 'WHERE is_active = 0 AND source = "employer"';
  else if (status === 'active') where = 'WHERE is_active = 1';
  res.json(all(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT 200`));
});

app.post('/api/admin/jobs/:id/approve', adminRequired, (req, res) => {
  const job = get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  run('UPDATE jobs SET is_active = 1, expires_at = datetime("now", "+30 days") WHERE id = ?', [req.params.id]);
  const posting = get('SELECT employer_email FROM job_postings WHERE job_id = ? ORDER BY id DESC LIMIT 1', [job.id]);
  const employerEmail = posting?.employer_email || job.apply_email;
  emailLib.sendJobPosted({ email: employerEmail }, job).catch(console.error);
  res.json({ success: true, message: 'Job approved and now live.' });
});

app.post('/api/admin/jobs/:id/reject', adminRequired, (req, res) => {
  const { reason } = req.body;
  const job = get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  run('DELETE FROM jobs WHERE id = ?', [req.params.id]);
  const posting = get('SELECT employer_email FROM job_postings WHERE job_id = ? ORDER BY id DESC LIMIT 1', [job.id]);
  const employerEmail = posting?.employer_email || job.apply_email;
  emailLib.sendEmail({
    to:      employerEmail,
    subject: `Your PenHire Job Posting Was Not Approved`,
    html:    `<p>Unfortunately your job posting <strong>${job.title}</strong> was not approved.</p>
              ${reason ? `<p>Reason: ${reason}</p>` : ''}
              <p>Please contact us if you have questions.</p>`
  }).catch(console.error);
  res.json({ success: true, message: 'Job rejected and removed.' });
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

// ── ADMIN: List pending unlocks ──
app.get('/api/admin/unlocks', adminRequired, (req, res) => {
  const { status = 'pending_approval' } = req.query;
  const unlocks = all(
    `SELECT u.id, u.status, u.amount_kes, u.transaction_id, u.payment_method, u.created_at,
     usr.name as user_name, usr.email as user_email, usr.phone as user_phone,
     j.title as job_title, j.id as job_id, j.uuid as job_uuid, j.pay_min, j.pay_max
     FROM unlocks u
     JOIN users usr ON u.user_id = usr.id
     JOIN jobs j ON u.job_id = j.id
     WHERE u.status = ?
     ORDER BY u.created_at DESC`,
    [status]
  );
  res.json(unlocks);
});

// ── ADMIN: Approve unlock ──
app.post('/api/admin/unlocks/:id/approve', adminRequired, (req, res) => {
  const unlock = get(
    `SELECT u.*, usr.name as user_name, usr.email as user_email,
     j.title as job_title, j.id as job_id
     FROM unlocks u
     JOIN users usr ON u.user_id = usr.id
     JOIN jobs j ON u.job_id = j.id
     WHERE u.id = ?`, [req.params.id]
  );
  if (!unlock) return res.status(404).json({ error: 'Unlock not found' });
  run('UPDATE unlocks SET status = "completed" WHERE id = ?', [req.params.id]);
  const user = get('SELECT * FROM users WHERE id = ?', [unlock.user_id]);
  const job  = get('SELECT * FROM jobs WHERE id = ?', [unlock.job_id]);
  if (user && job) emailLib.sendJobUnlocked(user, job).catch(console.error);
  res.json({ success: true, message: `Unlock approved. Email sent to ${unlock.user_email}.` });
});

// ── ADMIN: Reject unlock ──
app.post('/api/admin/unlocks/:id/reject', adminRequired, (req, res) => {
  const { reason } = req.body;
  const unlock = get(
    `SELECT u.*, usr.name as user_name, usr.email as user_email, j.title as job_title
     FROM unlocks u
     JOIN users usr ON u.user_id = usr.id
     JOIN jobs j ON u.job_id = j.id
     WHERE u.id = ?`, [req.params.id]
  );
  if (!unlock) return res.status(404).json({ error: 'Unlock not found' });
  run('UPDATE unlocks SET status = "rejected" WHERE id = ?', [req.params.id]);
  emailLib.sendEmail({
    to:      unlock.user_email,
    subject: `Issue with your unlock: ${unlock.job_title}`,
    html:    `<p>Hi ${unlock.user_name},</p>
              <p>There was an issue verifying your payment for <strong>${unlock.job_title}</strong>.</p>
              ${reason ? `<p>Reason: ${reason}</p>` : ''}
              <p>Please contact us at <a href="mailto:${process.env.ADMIN_EMAIL}">${process.env.ADMIN_EMAIL}</a> to resolve this.</p>`
  }).catch(console.error);
  res.json({ success: true, message: 'Unlock rejected. User notified.' });
});

// ── ADMIN: IntaSend transactions log ──
app.get('/api/admin/transactions', adminRequired, (req, res) => {
  const txs = all(
    `SELECT * FROM intasend_transactions ORDER BY created_at DESC LIMIT 100`
  );
  res.json(txs);
});

app.get('/api/admin/users', adminRequired, (req, res) => {
  res.json(all(
    'SELECT id, uuid, name, email, phone, speciality, is_active, created_at, last_login FROM users ORDER BY created_at DESC'
  ));
});

app.post('/api/admin/scrape', adminRequired, (req, res) => {
  res.json({ success: true, message: 'Scrape started' });
  runAllScrapers().catch(console.error);
});

// ── SERVE FRONTEND ──
app.get('/admin',                   (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'admin.html')));
app.get('/jobs',                    (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'jobs.html')));
app.get('/post-job',                (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'post-job.html')));
app.get('/payment/unlock-success',  (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'unlock-success.html')));
app.get('/payment/success',         (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'post-job.html')));
app.get('/payment/cancel',          (req, res) => res.redirect('/post-job'));
app.get('/job/:uuid',               (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'job-detail.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'index.html')));

// ══════════════════════════════════════════
// START
// ══════════════════════════════════════════
async function start() {
  await initDB();
  console.log('✅ Database ready');

  app.listen(PORT, () => {
    console.log(`✒  PenHire running on port ${PORT}`);
    console.log(`🌍 ${process.env.BASE_URL || 'http://localhost:' + PORT}`);
    console.log(`💳 IntaSend mode: ${process.env.INTASEND_TEST_MODE === 'true' ? '🧪 TEST' : '✅ LIVE'}`);
  });

  // Scrape every 30 minutes
  cron.schedule('*/30 * * * *', () => {
    console.log('⏰ Scheduled scrape starting...');
    runAllScrapers().catch(console.error);
  });

  // Expire old jobs daily
  cron.schedule('0 0 * * *', () => {
    run("UPDATE jobs SET is_active = 0 WHERE expires_at < datetime('now') AND is_active = 1");
    console.log('⏰ Old jobs expired');
  });

  // Initial scrape after 10 seconds
  setTimeout(() => {
    console.log('🔍 Running initial scrape...');
    runAllScrapers().catch(console.error);
  }, 10000);
}

start().catch(console.error);
module.exports = app;
