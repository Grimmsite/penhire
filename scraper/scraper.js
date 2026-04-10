// scraper/scraper.js
// Automatic Job Scraper – runs every 2 hours via cron
// Sources: RemoteOK, ProBloggerJobs, Freelancer RSS, WeWorkRemotely, Jobicy

const axios = require('axios');
const cheerio = require('cheerio');
const { getDB, run, get, all } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// ── UNLOCK FEE CALCULATOR ──
function calculateFees(payMax) {
  if (payMax < 10)  return { unlock_kes: 50,   unlock_usd: 0.50, post_fee_usd: 3  };
  if (payMax < 30)  return { unlock_kes: 100,  unlock_usd: 1.00, post_fee_usd: 5  };
  if (payMax < 100) return { unlock_kes: 200,  unlock_usd: 2.00, post_fee_usd: 10 };
  if (payMax < 500) return { unlock_kes: 500,  unlock_usd: 4.00, post_fee_usd: 20 };
  return              { unlock_kes: 1000, unlock_usd: 8.00, post_fee_usd: 40 };
}

// ── PARSE PAY FROM STRING ──
function parsePay(payStr) {
  if (!payStr) return { pay_min: 10, pay_max: 50 };
  const nums = payStr.replace(/[,$€£]/g, '').match(/\d+(\.\d+)?/g);
  if (!nums) return { pay_min: 10, pay_max: 50 };
  const values = nums.map(Number).filter(n => n > 0 && n < 100000);
  if (values.length === 0) return { pay_min: 10, pay_max: 50 };
  if (values.length === 1) return { pay_min: values[0] * 0.8, pay_max: values[0] };
  return { pay_min: Math.min(...values), pay_max: Math.max(...values) };
}

// ── DETECT CATEGORY ──
function detectCategory(title, description) {
  const text = (title + ' ' + description).toLowerCase();
  if (text.match(/technical|api|documentation|software|developer|saas|cloud|devops/)) return 'technical';
  if (text.match(/academic|research|essay|thesis|dissertation|study/)) return 'academic';
  if (text.match(/social media|instagram|facebook|twitter|tiktok|linkedin/)) return 'social';
  if (text.match(/copy|sales|email|marketing|ad |ads |conversion|landing page/)) return 'copywriting';
  if (text.match(/seo|content|blog|article|web content|website/)) return 'blog';
  return 'blog';
}

// ── EXTRACT TAGS ──
function extractTags(title, desc) {
  const keywords = ['SEO', 'WordPress', 'Technical', 'Health', 'Finance', 'Travel',
    'Technology', 'Crypto', 'Legal', 'Marketing', 'eCommerce', 'SaaS',
    'Academic', 'Social Media', 'Ghostwriting', 'Copywriting', 'Blog'];
  const text = (title + ' ' + desc).toLowerCase();
  return keywords.filter(k => text.includes(k.toLowerCase())).slice(0, 5);
}

// ── INSERT JOB INTO DB ──
function insertJob(_, job) {
  try {
    const existing = get(
      'SELECT id FROM jobs WHERE source_url = ? OR (title = ? AND company = ?)',
      [job.source_url, job.title, job.company]
    );
    if (existing) return false;

    const fees = calculateFees(job.pay_max);
    const tags = extractTags(job.title, job.description);

    run(
      `INSERT INTO jobs
       (uuid, title, company, country, category, pay_min, pay_max, pay_type,
        description, requirements, apply_email, apply_url, tags,
        unlock_kes, unlock_usd, post_fee_usd, source, source_url,
        is_active, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', '+30 days'))`,
      [
        uuidv4(), job.title, job.company, job.country, job.category,
        job.pay_min, job.pay_max, job.pay_type,
        job.description, job.requirements || '',
        job.apply_email || 'apply@penhire.com',
        job.apply_url || '',
        JSON.stringify(tags),
        fees.unlock_kes, fees.unlock_usd, fees.post_fee_usd,
        job.source, job.source_url
      ]
    );
    return true;
  } catch (err) {
    console.error('Insert error:', err.message);
    return false;
  }
}

// ══════════════════════════════════════════
// SCRAPER 1: RemoteOK (JSON API)
// ══════════════════════════════════════════
async function scrapeRemoteOK() {
  const start = Date.now();
  let added = 0, found = 0;

  try {
    const response = await axios.get('https://remoteok.com/api?tag=writing', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PenHire/1.0)' },
      timeout: 15000
    });

    const jobs = response.data.filter(j => j.position);

    for (const item of jobs.slice(0, 20)) {
      found++;
      const title = item.position || '';
      const desc  = (item.description || '').replace(/<[^>]*>/g, ' ').trim();

      if (!title.toLowerCase().match(/writ|content|copy|editor|journalist|blog|article/)) continue;

      const pay = parsePay(item.salary || '');
      const job = {
        title,
        company:      item.company || 'Remote Company',
        country:      item.location || 'Remote',
        category:     detectCategory(title, desc),
        pay_min:      pay.pay_min,
        pay_max:      pay.pay_max,
        pay_type:     'Per Month',
        description:  desc.slice(0, 2000) || 'See job link for full details.',
        apply_url:    item.url || `https://remoteok.com/l/${item.id}`,
        source:       'remoteok',
        source_url:   item.url || `https://remoteok.com/l/${item.id}`
      };

      if (insertJob(null, job)) added++;
    }

    logScrape(null, 'remoteok', found, added, 'success', '', Date.now() - start);
    console.log(`✅ RemoteOK: ${added} new jobs added`);
  } catch (err) {
    logScrape(null, 'remoteok', found, added, 'error', err.message, Date.now() - start);
    console.error('❌ RemoteOK error:', err.message);
  }

  return added;
}

// ══════════════════════════════════════════
// SCRAPER 2: Jobicy (JSON API)
// ══════════════════════════════════════════
async function scrapeJobicy() {
  const start = Date.now();
  let added = 0, found = 0;

  try {
    const response = await axios.get('https://jobicy.com/api/v2/remote-jobs?tag=writing&count=20', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    });

    const jobs = response.data?.jobs || [];

    for (const item of jobs) {
      found++;
      const title = item.jobTitle || '';
      const desc  = (item.jobDescription || '').replace(/<[^>]*>/g, ' ').trim();
      const pay   = parsePay(item.annualSalaryMin ? `${item.annualSalaryMin}-${item.annualSalaryMax}` : '');

      const job = {
        title,
        company:     item.companyName || 'Remote Employer',
        country:     item.jobGeo || 'Remote',
        category:    detectCategory(title, desc),
        pay_min:     pay.pay_min,
        pay_max:     pay.pay_max,
        pay_type:    item.annualSalaryMin ? 'Per Year' : 'Per Project',
        description: desc.slice(0, 2000) || 'See job link for full details.',
        apply_url:   item.url || '',
        source:      'jobicy',
        source_url:  item.url || ''
      };

      if (insertJob(null, job)) added++;
    }

    logScrape(null, 'jobicy', found, added, 'success', '', Date.now() - start);
    console.log(`✅ Jobicy: ${added} new jobs added`);
  } catch (err) {
    logScrape(null, 'jobicy', found, added, 'error', err.message, Date.now() - start);
    console.error('❌ Jobicy error:', err.message);
  }

  return added;
}

// ══════════════════════════════════════════
// SCRAPER 3: We Work Remotely (HTML scraper)
// ══════════════════════════════════════════
async function scrapeWeWorkRemotely() {
  const start = Date.now();
  let added = 0, found = 0;

  try {
    const response = await axios.get('https://weworkremotely.com/categories/remote-copywriting-jobs', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);

    $('section.jobs article').each((i, el) => {
      if (i >= 15) return false;
      found++;

      const title   = $(el).find('.title').text().trim();
      const company = $(el).find('.company').text().trim();
      const region  = $(el).find('.region').text().trim();
      const href    = $(el).find('a').attr('href');
      const url     = href ? `https://weworkremotely.com${href}` : '';

      if (!title) return;

      const job = {
        title,
        company:     company || 'Remote Company',
        country:     region || 'Remote',
        category:    detectCategory(title, ''),
        pay_min:     20,
        pay_max:     80,
        pay_type:    'Per Article',
        description: `${title} position at ${company}. Visit the job link for full details and to apply.`,
        apply_url:   url,
        source:      'weworkremotely',
        source_url:  url
      };

      if (insertJob(null, job)) added++;
    });

    logScrape(null, 'weworkremotely', found, added, 'success', '', Date.now() - start);
    console.log(`✅ WeWorkRemotely: ${added} new jobs added`);
  } catch (err) {
    logScrape(null, 'weworkremotely', found, added, 'error', err.message, Date.now() - start);
    console.error('❌ WeWorkRemotely error:', err.message);
  }

  return added;
}

// ══════════════════════════════════════════
// SCRAPER 4: Freelancer.com RSS Feed
// ══════════════════════════════════════════
async function scrapeFreelancerRSS() {
  const start = Date.now();
  let added = 0, found = 0;

  const feeds = [
    'https://www.freelancer.com/rss/jobsrss.xml?skill=article-writing',
    'https://www.freelancer.com/rss/jobsrss.xml?skill=copywriting',
    'https://www.freelancer.com/rss/jobsrss.xml?skill=content-writing'
  ];

  for (const feedUrl of feeds) {
    try {
      const response = await axios.get(feedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 12000
      });

      const $ = cheerio.load(response.data, { xmlMode: true });

      $('item').each((i, el) => {
        if (i >= 10) return false;
        found++;

        const title = $(el).find('title').text().trim();
        const desc  = $(el).find('description').text().replace(/<[^>]*>/g, ' ').trim();
        const url   = $(el).find('link').text().trim();
        const pay   = parsePay(desc);

        const job = {
          title,
          company:     'Freelancer Client',
          country:     'Remote',
          category:    detectCategory(title, desc),
          pay_min:     pay.pay_min,
          pay_max:     pay.pay_max,
          pay_type:    'Per Project',
          description: desc.slice(0, 1500) || title,
          apply_url:   url,
          source:      'freelancer',
          source_url:  url
        };

        if (insertJob(null, job)) added++;
      });
    } catch (err) {
      console.error('Freelancer RSS error:', err.message);
    }
  }

  logScrape(null, 'freelancer', found, added, 'success', '', Date.now() - start);
  console.log(`✅ Freelancer RSS: ${added} new jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SCRAPER 5: Problogger Job Board RSS
// ══════════════════════════════════════════
async function scrapeProBlogger() {
  const start = Date.now();
  let added = 0, found = 0;

  try {
    const response = await axios.get('https://problogger.com/jobs/feed/', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 12000
    });

    const $ = cheerio.load(response.data, { xmlMode: true });

    $('item').each((i, el) => {
      if (i >= 15) return false;
      found++;

      const title   = $(el).find('title').text().trim();
      const desc    = $(el).find('description').text().replace(/<[^>]*>/g, ' ').trim();
      const url     = $(el).find('link').text().trim();
      const pay     = parsePay(desc);

      const job = {
        title,
        company:     $(el).find('category').first().text().trim() || 'Blog Owner',
        country:     'Remote',
        category:    detectCategory(title, desc),
        pay_min:     pay.pay_min,
        pay_max:     pay.pay_max,
        pay_type:    'Per Article',
        description: desc.slice(0, 2000),
        apply_url:   url,
        source:      'problogger',
        source_url:  url
      };

      if (insertJob(null, job)) added++;
    });

    logScrape(null, 'problogger', found, added, 'success', '', Date.now() - start);
    console.log(`✅ ProBlogger: ${added} new jobs added`);
  } catch (err) {
    logScrape(null, 'problogger', found, added, 'error', err.message, Date.now() - start);
    console.error('❌ ProBlogger error:', err.message);
  }

  return added;
}

// ── LOG SCRAPE RESULT ──
function logScrape(_, source, found, added, status, error, duration) {
  try {
    run('INSERT INTO scrape_log (source, jobs_found, jobs_added, status, error, duration_ms) VALUES (?, ?, ?, ?, ?, ?)',
      [source, found, added, status, error, duration]);
  } catch (e) {}
}

// ── EXPIRE OLD JOBS ──
function expireOldJobs() {
  try {
    run("UPDATE jobs SET is_active = 0 WHERE expires_at < datetime('now') AND is_active = 1");
    console.log('⏰ Expired old jobs');
  } catch(e) {}
}

// ── MAIN SCRAPE FUNCTION ──
async function runAllScrapers() {
  console.log(`\n🔍 Starting scrape run: ${new Date().toISOString()}`);
  

  expireOldJobs();

  let totalAdded = 0;
  totalAdded += await scrapeRemoteOK();
  totalAdded += await scrapeJobicy();
  totalAdded += await scrapeWeWorkRemotely();
  totalAdded += await scrapeFreelancerRSS();
  totalAdded += await scrapeProBlogger();

  console.log(`\n✅ Scrape complete. Total new jobs: ${totalAdded}`);
  const _t = get('SELECT COUNT(*) as c FROM jobs WHERE is_active = 1'); console.log(`\n✅ Scrape complete. New: ${totalAdded}, Total: ${_t?.c||0}\n`);

  return totalAdded;
}

// Run immediately if called directly
if (require.main === module) {
  runAllScrapers().then(() => process.exit(0)).catch(console.error);
}

module.exports = { runAllScrapers };
