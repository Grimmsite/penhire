// scraper/scraper.js
// PenHire Auto Job Scraper — 8 sources, writing-focused
// Runs every 2 hours via cron in server.js

const axios   = require('axios');
const cheerio = require('cheerio');
const { run, get, all } = require('../config/database');
const { v4: uuidv4 }   = require('uuid');
require('dotenv').config();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── WRITING KEYWORDS (broad filter) ──
const WRITING_KEYWORDS = [
  'writ', 'content', 'copy', 'editor', 'editorial', 'blog', 'article',
  'journalist', 'journalist', 'reporter', 'author', 'ghostwrit',
  'technical writ', 'seo', 'social media', 'communications',
  'marketing writ', 'creative writ', 'script', 'proofreader'
];

function isWritingJob(title, desc = '') {
  const text = (title + ' ' + desc).toLowerCase();
  return WRITING_KEYWORDS.some(k => text.includes(k));
}

// ── UNLOCK FEE CALCULATOR ──
function calculateFees(payMax) {
  if (!payMax || payMax < 10)  return { unlock_kes: 50,   unlock_usd: 0.50, post_fee_usd: 3  };
  if (payMax < 30)             return { unlock_kes: 100,  unlock_usd: 1.00, post_fee_usd: 5  };
  if (payMax < 100)            return { unlock_kes: 200,  unlock_usd: 2.00, post_fee_usd: 10 };
  if (payMax < 500)            return { unlock_kes: 500,  unlock_usd: 4.00, post_fee_usd: 20 };
  return                              { unlock_kes: 1000, unlock_usd: 8.00, post_fee_usd: 40 };
}

// ── PARSE PAY FROM TEXT ──
function parsePay(text) {
  if (!text) return { pay_min: 20, pay_max: 60 };
  const nums = String(text).replace(/[,$€£k]/gi, (m) => m.toLowerCase() === 'k' ? '000' : '')
    .match(/\d+(\.\d+)?/g);
  if (!nums) return { pay_min: 20, pay_max: 60 };
  const vals = nums.map(Number).filter(n => n >= 5 && n <= 500000);
  if (!vals.length) return { pay_min: 20, pay_max: 60 };
  if (vals.length === 1) return { pay_min: Math.round(vals[0] * 0.8), pay_max: vals[0] };
  return { pay_min: Math.min(...vals), pay_max: Math.max(...vals) };
}

// ── DETECT CATEGORY ──
function detectCategory(title, desc = '') {
  const t = (title + ' ' + desc).toLowerCase();
  if (t.match(/technical|api|documentation|software|devops|saas|cloud|developer/)) return 'technical';
  if (t.match(/academic|research|essay|thesis|dissertation/))                       return 'academic';
  if (t.match(/social media|instagram|facebook|twitter|tiktok|linkedin/))           return 'social';
  if (t.match(/copy|sales|email marketing|ad copy|landing page|conversion/))        return 'copywriting';
  if (t.match(/seo|blog|article|content writ|web content/))                         return 'blog';
  return 'blog';
}

// ── EXTRACT TAGS ──
function extractTags(title, desc = '') {
  const map = {
    'SEO': /seo/i, 'WordPress': /wordpress/i, 'Technical': /technical/i,
    'Health': /health|medical|wellness/i, 'Finance': /financ|invest|crypto/i,
    'Travel': /travel/i, 'Technology': /tech|software|saas/i,
    'Marketing': /marketing/i, 'eCommerce': /ecommerce|e-commerce|shopify/i,
    'Academic': /academic|research/i, 'Social Media': /social media/i,
    'Copywriting': /copy/i, 'Blog': /blog/i, 'Remote': /remote/i
  };
  const text = title + ' ' + desc;
  return Object.entries(map).filter(([, rx]) => rx.test(text)).map(([k]) => k).slice(0, 5);
}

// ── INSERT JOB ──
function insertJob(job) {
  try {
    if (!job.title || !job.company) return false;

    // Deduplicate by source URL or title+company
    const existing = get(
      'SELECT id FROM jobs WHERE source_url = ? OR (title = ? AND company = ?)',
      [job.source_url || '', job.title, job.company]
    );
    if (existing) return false;

    const fees = calculateFees(job.pay_max);
    const tags = extractTags(job.title, job.description);

    run(`
      INSERT INTO jobs
      (uuid, title, company, country, category, pay_min, pay_max, pay_type,
       description, requirements, apply_email, apply_url, tags,
       unlock_kes, unlock_usd, post_fee_usd, source, source_url,
       is_active, expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,datetime('now','+30 days'))
    `, [
      uuidv4(),
      job.title.slice(0, 200),
      job.company.slice(0, 100),
      job.country || 'Remote',
      detectCategory(job.title, job.description),
      job.pay_min || fees.unlock_kes / 10,
      job.pay_max || 60,
      job.pay_type || 'Per Project',
      (job.description || job.title).slice(0, 3000),
      job.requirements || '',
      job.apply_email || 'apply@penhire.com',
      job.apply_url || '',
      JSON.stringify(tags),
      fees.unlock_kes,
      fees.unlock_usd,
      fees.post_fee_usd,
      job.source,
      job.source_url || ''
    ]);
    return true;
  } catch (err) {
    console.error('  Insert error:', err.message, '|', job.title?.slice(0, 40));
    return false;
  }
}

// ── LOG ──
function logScrape(source, found, added, status, error, duration) {
  try {
    run('INSERT INTO scrape_log (source, jobs_found, jobs_added, status, error, duration_ms) VALUES (?,?,?,?,?,?)',
      [source, found, added, status, error || '', duration]);
  } catch (e) {}
}

// ── EXPIRE OLD JOBS ──
function expireOldJobs() {
  try {
    run("UPDATE jobs SET is_active = 0 WHERE expires_at < datetime('now') AND is_active = 1");
  } catch (e) {}
}

// ══════════════════════════════════════════
// SOURCE 1: Himalayas (FREE JSON API — best source)
// Searches multiple writing keywords
// ══════════════════════════════════════════
async function scrapeHimalayas() {
  const start = Date.now();
  let found = 0, added = 0;
  const keywords = ['writer', 'content writer', 'copywriter', 'technical writer', 'editor', 'blog writer'];

  for (const kw of keywords) {
    try {
      const res = await axios.get('https://himalayas.app/jobs/api/search', {
        params: { q: kw, employment_type: 'Full Time,Part Time,Contractor', limit: 20 },
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        timeout: 15000
      });
      const jobs = res.data?.jobs || [];
      for (const j of jobs) {
        found++;
        const desc = (j.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const pay  = parsePay(j.salaryMin ? `${j.salaryMin}-${j.salaryMax}` : '');
        if (insertJob({
          title:       j.title,
          company:     j.companyName || 'Remote Company',
          country:     j.locationRestrictions?.[0] || 'Remote',
          pay_min:     pay.pay_min,
          pay_max:     pay.pay_max,
          pay_type:    j.employmentType || 'Full Time',
          description: desc.slice(0, 2000) || j.title,
          apply_url:   j.applicationLink || j.url || '',
          source:      'himalayas',
          source_url:  j.url || j.applicationLink || ''
        })) added++;
      }
      await sleep(500); // be polite to their API
    } catch (err) {
      console.error(`  Himalayas [${kw}] error:`, err.message);
    }
  }
  logScrape('himalayas', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Himalayas: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE 2: Jobicy (JSON API — multiple writing tags)
// ══════════════════════════════════════════
async function scrapeJobicy() {
  const start = Date.now();
  let found = 0, added = 0;
  const tags = ['writing', 'content', 'copywriting', 'blogging', 'editing'];

  for (const tag of tags) {
    try {
      const res = await axios.get(`https://jobicy.com/api/v2/remote-jobs`, {
        params: { tag, count: 20 },
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        timeout: 15000
      });
      const jobs = res.data?.jobs || [];
      for (const j of jobs) {
        found++;
        const desc = (j.jobDescription || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!isWritingJob(j.jobTitle, desc)) continue;
        const pay = parsePay(j.annualSalaryMin ? `${j.annualSalaryMin}-${j.annualSalaryMax}` : '');
        if (insertJob({
          title:       j.jobTitle,
          company:     j.companyName || 'Remote Company',
          country:     j.jobGeo || 'Remote',
          pay_min:     pay.pay_min,
          pay_max:     pay.pay_max,
          pay_type:    j.jobType || 'Full Time',
          description: desc.slice(0, 2000) || j.jobExcerpt || j.jobTitle,
          apply_url:   j.url || '',
          source:      'jobicy',
          source_url:  j.url || ''
        })) added++;
      }
      await sleep(400);
    } catch (err) {
      console.error(`  Jobicy [${tag}] error:`, err.message);
    }
  }
  logScrape('jobicy', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Jobicy: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE 3: RemoteOK (JSON API)
// ══════════════════════════════════════════
async function scrapeRemoteOK() {
  const start = Date.now();
  let found = 0, added = 0;
  const tags = ['writing', 'content', 'copywriting', 'marketing'];

  for (const tag of tags) {
    try {
      const res = await axios.get(`https://remoteok.com/api?tag=${tag}`, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        timeout: 15000
      });
      const jobs = (res.data || []).filter(j => j.position);
      for (const j of jobs.slice(0, 15)) {
        found++;
        const desc = (j.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!isWritingJob(j.position, desc)) continue;
        const pay = parsePay(j.salary || '');
        if (insertJob({
          title:       j.position,
          company:     j.company || 'Remote Company',
          country:     j.location || 'Remote',
          pay_min:     pay.pay_min,
          pay_max:     pay.pay_max,
          pay_type:    'Full Time',
          description: desc.slice(0, 2000) || j.position,
          apply_url:   j.url || `https://remoteok.com/l/${j.id}`,
          source:      'remoteok',
          source_url:  j.url || `https://remoteok.com/l/${j.id}`
        })) added++;
      }
      await sleep(1000); // RemoteOK is strict about rate limits
    } catch (err) {
      console.error(`  RemoteOK [${tag}] error:`, err.message);
    }
  }
  logScrape('remoteok', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ RemoteOK: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE 4: Himalayas RSS Feed (100 latest jobs)
// ══════════════════════════════════════════
async function scrapeHimalayasRSS() {
  const start = Date.now();
  let found = 0, added = 0;
  try {
    const res = await axios.get('https://himalayas.app/jobs/rss', {
      headers: { 'User-Agent': UA },
      timeout: 15000
    });
    const $ = cheerio.load(res.data, { xmlMode: true });
    $('item').each((i, el) => {
      found++;
      const title   = $(el).find('title').text().trim();
      const desc    = $(el).find('description').text().replace(/<[^>]*>/g, ' ').trim();
      const url     = $(el).find('link').text().trim();
      const company = $(el).find('companyName').text().trim() ||
                      $(el).find('[localName="companyName"]').text().trim() || 'Remote Company';
      if (!isWritingJob(title, desc)) return;
      const pay = parsePay(desc);
      if (insertJob({
        title, company, country: 'Remote',
        pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Full Time',
        description: desc.slice(0, 2000) || title,
        apply_url: url, source: 'himalayas_rss', source_url: url
      })) added++;
    });
  } catch (err) {
    console.error('  HimalayasRSS error:', err.message);
  }
  logScrape('himalayas_rss', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Himalayas RSS: ${added}/${found} writing jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE 5: ProBlogger RSS
// ══════════════════════════════════════════
async function scrapeProBlogger() {
  const start = Date.now();
  let found = 0, added = 0;
  try {
    const res = await axios.get('https://problogger.com/jobs/feed/', {
      headers: { 'User-Agent': UA },
      timeout: 15000
    });
    const $ = cheerio.load(res.data, { xmlMode: true });
    $('item').each((i, el) => {
      if (i >= 20) return false;
      found++;
      const title = $(el).find('title').text().trim();
      const desc  = $(el).find('description').text().replace(/<[^>]*>/g, ' ').trim();
      const url   = $(el).find('link').text().trim();
      const pay   = parsePay(desc);
      if (insertJob({
        title, company: 'Blog Owner', country: 'Remote',
        pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Per Article',
        description: desc.slice(0, 2000) || title,
        apply_url: url, source: 'problogger', source_url: url
      })) added++;
    });
  } catch (err) {
    console.error('  ProBlogger error:', err.message);
  }
  logScrape('problogger', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ ProBlogger: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE 6: WeWorkRemotely (HTML scraper)
// Multiple writing categories
// ══════════════════════════════════════════
async function scrapeWeWorkRemotely() {
  const start = Date.now();
  let found = 0, added = 0;
  const cats = [
    'remote-copywriting-jobs',
    'remote-marketing-jobs',
    'remote-writing-jobs'
  ];

  for (const cat of cats) {
    try {
      const res = await axios.get(`https://weworkremotely.com/categories/${cat}`, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html' },
        timeout: 15000
      });
      const $ = cheerio.load(res.data);
      $('section.jobs article').each((i, el) => {
        if (i >= 10) return false;
        found++;
        const title   = $(el).find('.title').text().trim();
        const company = $(el).find('.company').text().trim() || 'Remote Company';
        const region  = $(el).find('.region').text().trim() || 'Remote';
        const href    = $(el).find('a').attr('href');
        const url     = href ? `https://weworkremotely.com${href}` : '';
        if (!title) return;
        if (insertJob({
          title, company, country: region,
          pay_min: 30, pay_max: 100, pay_type: 'Per Month',
          description: `${title} at ${company}. Remote position. Visit job link for full details.`,
          apply_url: url, source: 'weworkremotely', source_url: url
        })) added++;
      });
      await sleep(1000);
    } catch (err) {
      console.error(`  WWR [${cat}] error:`, err.message);
    }
  }
  logScrape('weworkremotely', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ WeWorkRemotely: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE 7: Freelancer RSS (3 writing feeds)
// ══════════════════════════════════════════
async function scrapeFreelancer() {
  const start = Date.now();
  let found = 0, added = 0;
  const feeds = [
    'https://www.freelancer.com/rss/jobsrss.xml?skill=article-writing',
    'https://www.freelancer.com/rss/jobsrss.xml?skill=copywriting',
    'https://www.freelancer.com/rss/jobsrss.xml?skill=content-writing',
    'https://www.freelancer.com/rss/jobsrss.xml?skill=blog-writing',
    'https://www.freelancer.com/rss/jobsrss.xml?skill=technical-writing'
  ];

  for (const feed of feeds) {
    try {
      const res = await axios.get(feed, {
        headers: { 'User-Agent': UA },
        timeout: 12000
      });
      const $ = cheerio.load(res.data, { xmlMode: true });
      $('item').each((i, el) => {
        if (i >= 8) return false;
        found++;
        const title = $(el).find('title').text().trim();
        const desc  = $(el).find('description').text().replace(/<[^>]*>/g, ' ').trim();
        const url   = $(el).find('link').text().trim();
        const pay   = parsePay(desc);
        if (insertJob({
          title, company: 'Freelancer Client', country: 'Remote',
          pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Per Project',
          description: desc.slice(0, 1500) || title,
          apply_url: url, source: 'freelancer', source_url: url
        })) added++;
      });
      await sleep(500);
    } catch (err) {
      console.error('  Freelancer RSS error:', err.message);
    }
  }
  logScrape('freelancer', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Freelancer: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE 8: Authentic Jobs RSS
// ══════════════════════════════════════════
async function scrapeAuthenticJobs() {
  const start = Date.now();
  let found = 0, added = 0;
  try {
    const res = await axios.get('https://authenticjobs.com/feed/', {
      headers: { 'User-Agent': UA },
      timeout: 12000
    });
    const $ = cheerio.load(res.data, { xmlMode: true });
    $('item').each((i, el) => {
      if (i >= 20) return false;
      const title = $(el).find('title').text().trim();
      const desc  = $(el).find('description').text().replace(/<[^>]*>/g, ' ').trim();
      const url   = $(el).find('link').text().trim();
      if (!isWritingJob(title, desc)) return;
      found++;
      const pay = parsePay(desc);
      if (insertJob({
        title, company: 'Employer', country: 'Remote',
        pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Per Project',
        description: desc.slice(0, 2000) || title,
        apply_url: url, source: 'authenticjobs', source_url: url
      })) added++;
    });
  } catch (err) {
    console.error('  AuthenticJobs error:', err.message);
  }
  logScrape('authenticjobs', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ AuthenticJobs: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE 9: Workew RSS (remote jobs)
// ══════════════════════════════════════════
async function scrapeWorkew() {
  const start = Date.now();
  let found = 0, added = 0;
  try {
    const res = await axios.get('https://workew.com/feed/', {
      headers: { 'User-Agent': UA },
      timeout: 12000
    });
    const $ = cheerio.load(res.data, { xmlMode: true });
    $('item').each((i, el) => {
      if (i >= 20) return false;
      const title = $(el).find('title').text().trim();
      const desc  = $(el).find('description').text().replace(/<[^>]*>/g, ' ').trim();
      const url   = $(el).find('link').text().trim();
      if (!isWritingJob(title, desc)) return;
      found++;
      const pay = parsePay(desc);
      if (insertJob({
        title, company: 'Remote Employer', country: 'Remote',
        pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Remote',
        description: desc.slice(0, 2000) || title,
        apply_url: url, source: 'workew', source_url: url
      })) added++;
    });
  } catch (err) {
    console.error('  Workew error:', err.message);
  }
  logScrape('workew', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Workew: ${added}/${found} jobs added`);
  return added;
}

// ── SLEEP HELPER ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════
// MAIN — runs all scrapers
// ══════════════════════════════════════════
async function runAllScrapers() {
  console.log(`\n🔍 PenHire Scraper starting: ${new Date().toISOString()}`);
  expireOldJobs();

  let total = 0;
  total += await scrapeHimalayas();
  total += await scrapeJobicy();
  total += await scrapeHimalayasRSS();
  total += await scrapeProBlogger();
  total += await scrapeWeWorkRemotely();
  total += await scrapeFreelancer();
  total += await scrapeRemoteOK();
  total += await scrapeAuthenticJobs();
  total += await scrapeWorkew();

  const activeJobs = get('SELECT COUNT(*) as c FROM jobs WHERE is_active = 1');
  console.log(`\n✅ Scrape complete. New jobs this run: ${total}`);
  console.log(`📊 Total active jobs on platform: ${activeJobs?.c || 0}\n`);
  return total;
}

// Run directly if called as script
if (require.main === module) {
  runAllScrapers().then(() => process.exit(0)).catch(console.error);
}

module.exports = { runAllScrapers };
