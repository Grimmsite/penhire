// scraper/scraper.js
// PenHire Auto Job Scraper — Fixed version
// Changes: better headers to fix 403s, new working sources, fixed WeWorkRemotely selector

const axios   = require('axios');
const cheerio = require('cheerio');
const { run, get, all } = require('../config/database');
const { v4: uuidv4 }   = require('uuid');
require('dotenv').config();
function getUA() { return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'; }

// ── FULL BROWSER HEADERS (fixes most 403 blocks) ──
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
  'Connection': 'keep-alive'
};

const JSON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Referer': 'https://www.google.com/'
};

// ── WRITING KEYWORDS ──
const WRITING_KEYWORDS = [
  'writ', 'content', 'copy', 'editor', 'editorial', 'blog', 'article',
  'journalist', 'reporter', 'author', 'ghostwrit',
  'technical writ', 'seo', 'social media', 'communications',
  'marketing writ', 'creative writ', 'script', 'proofreader',
  // Academic writing
  'academic writ', 'research writ', 'grant writ', 'science writ',
  'scientific writ', 'medical writ', 'scholarly', 'dissertation',
  'academic editor', 'journal editor', 'scientific editor',
  'research communicat', 'science communicat', 'academic communicat',
  'publication', 'manuscript', 'peer review', 'research assistant'
];

function isWritingJob(title, desc = '') {
  const text = (title + ' ' + desc).toLowerCase();
  return WRITING_KEYWORDS.some(k => text.includes(k));
}

// ── UNLOCK FEE CALCULATOR ──
function calculateFees(payMax) {
  if (!payMax || payMax < 10)  return { unlock_kes: 100,  unlock_usd: 1.00, post_fee_usd: 3  };
  if (payMax < 30)             return { unlock_kes: 250,  unlock_usd: 2.00, post_fee_usd: 5  };
  if (payMax < 100)            return { unlock_kes: 1000, unlock_usd: 8.00, post_fee_usd: 10 };
  if (payMax < 500)            return { unlock_kes: 4000, unlock_usd: 32.00, post_fee_usd: 20 };
  return                              { unlock_kes: 6000, unlock_usd: 48.00, post_fee_usd: 40 };
}

// ── PARSE PAY ──
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
      job.pay_min || 20,
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

function logScrape(source, found, added, status, error, duration) {
  try {
    run('INSERT INTO scrape_log (source, jobs_found, jobs_added, status, error, duration_ms) VALUES (?,?,?,?,?,?)',
      [source, found, added, status, error || '', duration]);
  } catch (e) {}
}

function expireOldJobs() {
  try {
    run("UPDATE jobs SET is_active = 0 WHERE expires_at < datetime('now') AND is_active = 1");
  } catch (e) {}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════
// SOURCE 1: Remotive (FREE JSON API — very reliable)
// ══════════════════════════════════════════
async function scrapeRemotive() {
  const start = Date.now();
  let found = 0, added = 0;
  const categories = ['writing', 'marketing', 'copywriting'];
  for (const cat of categories) {
    try {
      const res = await axios.get('https://remotive.com/api/remote-jobs', {
        params: { category: cat, limit: 20 },
        headers: JSON_HEADERS,
        timeout: 15000
      });
      const jobs = res.data?.jobs || [];
      for (const j of jobs) {
        found++;
        const desc = (j.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!isWritingJob(j.title, desc)) continue;
        const pay = parsePay(j.salary || '');
        if (insertJob({
          title:       j.title,
          company:     j.company_name || 'Remote Company',
          country:     j.candidate_required_location || 'Worldwide',
          pay_min:     pay.pay_min,
          pay_max:     pay.pay_max,
          pay_type:    j.job_type || 'Full Time',
          description: desc.slice(0, 2000) || j.title,
          apply_url:   j.url || '',
          source:      'remotive',
          source_url:  j.url || ''
        })) added++;
      }
      await sleep(500);
    } catch (err) {
      console.error(`  Remotive [${cat}] error:`, err.message);
    }
  }
  logScrape('remotive', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Remotive: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE 2: Jobicy (JSON API)
// ══════════════════════════════════════════
async function scrapeJobicy() {
  const start = Date.now();
  let found = 0, added = 0;
  const tags = ['writing', 'content', 'copywriting', 'blogging', 'editing'];
  for (const tag of tags) {
    try {
      const res = await axios.get('https://jobicy.com/api/v2/remote-jobs', {
        params: { tag, count: 20 },
        headers: JSON_HEADERS,
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
// SOURCE 3: WeWorkRemotely (fixed selector)
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
        headers: { ...HEADERS, 'Referer': 'https://weworkremotely.com/' },
        timeout: 20000
      });
      const $ = cheerio.load(res.data);
      // Try multiple selectors — WWR changes their HTML occasionally
      const items = $('li.feature, section.jobs li, ul.jobs li').filter((i, el) => {
        return $(el).find('a').attr('href')?.includes('/remote-jobs/');
      });
      items.each((i, el) => {
        if (i >= 15) return false;
        found++;
        const title   = $(el).find('.title, span.title, .position').text().trim() ||
                        $(el).find('a').first().text().trim();
        const company = $(el).find('.company, span.company, .company-name').text().trim() || 'Remote Company';
        const href    = $(el).find('a').attr('href') || '';
        const url     = href.startsWith('http') ? href : `https://weworkremotely.com${href}`;
        if (!title || title.length < 3) return;
        if (insertJob({
          title, company, country: 'Remote',
          pay_min: 30, pay_max: 100, pay_type: 'Per Month',
          description: `${title} at ${company}. Remote writing position. Visit the job link for full details and application instructions.`,
          apply_url: url, source: 'weworkremotely', source_url: url
        })) added++;
      });
      await sleep(1500);
    } catch (err) {
      console.error(`  WWR [${cat}] error:`, err.message);
    }
  }
  logScrape('weworkremotely', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ WeWorkRemotely: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE 4: ProBlogger RSS
// ══════════════════════════════════════════
async function scrapeProBlogger() {
  const start = Date.now();
  let found = 0, added = 0;
  try {
    const res = await axios.get('https://problogger.com/jobs/feed/', {
      headers: HEADERS,
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
// SOURCE 5: AuthenticJobs RSS
// ══════════════════════════════════════════
async function scrapeAuthenticJobs() {
  const start = Date.now();
  let found = 0, added = 0;
  try {
    const res = await axios.get('https://authenticjobs.com/feed/', {
      headers: HEADERS,
      timeout: 15000
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
// SOURCE 6: Workew RSS
// ══════════════════════════════════════════
async function scrapeWorkew() {
  const start = Date.now();
  let found = 0, added = 0;
  try {
    const res = await axios.get('https://workew.com/feed/', {
      headers: HEADERS,
      timeout: 15000
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

// ══════════════════════════════════════════
// SOURCE 7: MediaBistro RSS (fixed URL)
// ══════════════════════════════════════════
async function scrapeMediaBistro() {
  const start = Date.now();
  let found = 0, added = 0;
  const urls = [
    'https://www.mediabistro.com/jobs/rss/',
    'https://www.mediabistro.com/feed/'
  ];
  for (const feedUrl of urls) {
    try {
      const res = await axios.get(feedUrl, { headers: HEADERS, timeout: 15000 });
      const $ = cheerio.load(res.data, { xmlMode: true });
      $('item').each((i, el) => {
        if (i >= 20) return false;
        const title   = $(el).find('title').text().trim();
        const desc    = $(el).find('description').text().replace(/<[^>]*>/g, ' ').trim();
        const url     = $(el).find('link').text().trim();
        const company = $(el).find('company').text().trim() || 'Remote Employer';
        if (!isWritingJob(title, desc)) return;
        found++;
        const pay = parsePay(desc);
        if (insertJob({
          title, company, country: 'Remote',
          pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Per Article',
          description: desc.slice(0, 2000) || title,
          apply_url: url, source: 'mediabistro', source_url: url
        })) added++;
      });
      if (found > 0) break;
    } catch (err) {
      console.error('  MediaBistro error:', err.message);
    }
  }
  logScrape('mediabistro', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ MediaBistro: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE 8: Remote.co (fixed URL + longer timeout)
// ══════════════════════════════════════════
async function scrapeRemoteCo() {
  const start = Date.now();
  let found = 0, added = 0;
  const feeds = [
    'https://remote.co/remote-jobs/writer/feed/',
    'https://remote.co/remote-jobs/content/feed/'
  ];
  for (const feedUrl of feeds) {
    try {
      const res = await axios.get(feedUrl, { headers: HEADERS, timeout: 25000 });
      const $ = cheerio.load(res.data, { xmlMode: true });
      $('item').each((i, el) => {
        if (i >= 20) return false;
        const title   = $(el).find('title').text().trim();
        const desc    = $(el).find('description').text().replace(/<[^>]*>/g, ' ').trim();
        const url     = $(el).find('link').text().trim();
        const company = $(el).find('creator').text().trim() || 'Remote Employer';
        if (!isWritingJob(title, desc)) return;
        found++;
        const pay = parsePay(desc);
        if (insertJob({
          title, company, country: 'Remote',
          pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Full Time',
          description: desc.slice(0, 2000) || title,
          apply_url: url, source: 'remoteco', source_url: url
        })) added++;
      });
      await sleep(1000);
    } catch (err) {
      console.error('  Remote.co error:', err.message);
    }
  }
  logScrape('remoteco', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Remote.co: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE 9: JournalismJobs (fixed URL)
// ══════════════════════════════════════════
async function scrapeJournalismJobs() {
  const start = Date.now();
  let found = 0, added = 0;
  const feeds = [
    'https://www.journalismjobs.com/feed',
    'https://www.journalismjobs.com/rss.php'
  ];
  for (const feedUrl of feeds) {
    try {
      const res = await axios.get(feedUrl, { headers: HEADERS, timeout: 15000 });
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
          title, company: 'Media Employer', country: 'Remote',
          pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Full Time',
          description: desc.slice(0, 2000) || title,
          apply_url: url, source: 'journalismjobs', source_url: url
        })) added++;
      });
      if (found > 0) break;
    } catch (err) {
      console.error('  JournalismJobs error:', err.message);
    }
  }
  logScrape('journalismjobs', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ JournalismJobs: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE 10: BloggingPro RSS (new — writing only)
// ══════════════════════════════════════════
async function scrapeBloggingPro() {
  const start = Date.now();
  let found = 0, added = 0;
  try {
    const res = await axios.get('https://www.bloggingpro.com/feed/', {
      headers: HEADERS,
      timeout: 15000
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
        title, company: 'Blog Employer', country: 'Remote',
        pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Per Article',
        description: desc.slice(0, 2000) || title,
        apply_url: url, source: 'bloggingpro', source_url: url
      })) added++;
    });
  } catch (err) {
    console.error('  BloggingPro error:', err.message);
  }
  logScrape('bloggingpro', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ BloggingPro: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE 11: Himalayas JSON API (with better headers)
// ══════════════════════════════════════════
async function scrapeHimalayas() {
  const start = Date.now();
  let found = 0, added = 0;
  const keywords = ['writer', 'content writer', 'copywriter', 'technical writer', 'editor', 'blog writer'];
  for (const kw of keywords) {
    try {
      const res = await axios.get('https://himalayas.app/jobs/api/search', {
        params: { q: kw, limit: 20 },
        headers: { ...JSON_HEADERS, 'Referer': 'https://himalayas.app/' },
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
      await sleep(800);
    } catch (err) {
      console.error(`  Himalayas [${kw}] error:`, err.message);
    }
  }
  logScrape('himalayas', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Himalayas: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE 12: RemoteOK (with better headers + delay)
// ══════════════════════════════════════════
async function scrapeRemoteOK() {
  const start = Date.now();
  let found = 0, added = 0;
  try {
    await sleep(2000); // RemoteOK needs a pause before request
    const res = await axios.get('https://remoteok.com/api', {
      headers: { ...JSON_HEADERS, 'Referer': 'https://remoteok.com/' },
      timeout: 20000
    });
    const jobs = (res.data || []).filter(j => j.position);
    for (const j of jobs.slice(0, 50)) {
      const desc = (j.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!isWritingJob(j.position, desc)) continue;
      found++;
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
  } catch (err) {
    console.error('  RemoteOK error:', err.message);
  }
  logScrape('remoteok', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ RemoteOK: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// MAIN — runs all scrapers
// ══════════════════════════════════════════

// ══════════════════════════════════════════
// SOURCE: The Muse API (free, no auth needed)
// ══════════════════════════════════════════
async function scrapeTheMuse() {
  const start = Date.now();
  let found = 0, added = 0;
  const keywords = ['writer', 'editor', 'content', 'copywriter', 'journalist'];
  for (const kw of keywords) {
    try {
      const res = await axios.get('https://www.themuse.com/api/public/jobs', {
        params: { category: 'Writing', page: 0 },
        headers: { 'User-Agent': getUA(), 'Accept': 'application/json' },
        timeout: 15000
      });
      const jobs = (res.data?.results || []).filter(j => isWritingJob(j.name || '', ''));
      for (const j of jobs.slice(0, 15)) {
        found++;
        const desc = (j.contents || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const url = j.refs?.landing_page || '';
        if (insertJob({
          title: j.name,
          company: j.company?.name || 'Remote Company',
          country: j.locations?.[0]?.name || 'Remote',
          pay_min: 30, pay_max: 80, pay_type: j.type || 'Full Time',
          description: desc.slice(0, 2000) || j.name,
          apply_url: url, source: 'themuse', source_url: url
        })) added++;
      }
      await sleep(600);
      break;
    } catch (err) {
      console.error(`  TheMuse [${kw}] error:`, err.message);
    }
  }
  logScrape('themuse', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ TheMuse: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE: Arbeitnow API (free, no auth, remote jobs)
// ══════════════════════════════════════════
async function scrapeArbeitnow() {
  const start = Date.now();
  let found = 0, added = 0;
  try {
    const res = await axios.get('https://www.arbeitnow.com/api/job-board-api', {
      params: { page: 1 },
      headers: { 'User-Agent': getUA(), 'Accept': 'application/json' },
      timeout: 15000
    });
    const jobs = res.data?.data || [];
    for (const j of jobs) {
      const desc = (j.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!isWritingJob(j.title, desc)) continue;
      found++;
      const pay = parsePay(desc);
      if (insertJob({
        title: j.title,
        company: j.company_name || 'Remote Company',
        country: j.location || 'Remote',
        pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Full Time',
        description: desc.slice(0, 2000) || j.title,
        apply_url: j.url || '', source: 'arbeitnow', source_url: j.url || ''
      })) added++;
    }
  } catch (err) {
    console.error('  Arbeitnow error:', err.message);
  }
  logScrape('arbeitnow', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Arbeitnow: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE: Adzuna API (free tier, 200 req/day)
// ══════════════════════════════════════════
async function scrapeAdzuna() {
  const start = Date.now();
  let found = 0, added = 0;
  const APP_ID = process.env.ADZUNA_APP_ID || '';
  const APP_KEY = process.env.ADZUNA_APP_KEY || '';
  if (!APP_ID || !APP_KEY) {
    console.log('  ⚠️ Adzuna: no API credentials set, skipping');
    return 0;
  }
  const keywords = ['content writer', 'copywriter', 'technical writer', 'blog writer'];
  for (const kw of keywords) {
    try {
      const res = await axios.get(`https://api.adzuna.com/v1/api/jobs/gb/search/1`, {
        params: { app_id: APP_ID, app_key: APP_KEY, what: kw, results_per_page: 20, content_type: 'application/json' },
        headers: { 'User-Agent': getUA() },
        timeout: 15000
      });
      const jobs = res.data?.results || [];
      for (const j of jobs) {
        found++;
        const desc = (j.description || '').replace(/<[^>]*>/g, ' ').trim();
        const pay = parsePay(j.salary_max ? `${j.salary_min}-${j.salary_max}` : '');
        if (insertJob({
          title: j.title,
          company: j.company?.display_name || 'Company',
          country: j.location?.display_name || 'Remote',
          pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Full Time',
          description: desc.slice(0, 2000) || j.title,
          apply_url: j.redirect_url || '', source: 'adzuna', source_url: j.redirect_url || ''
        })) added++;
      }
      await sleep(500);
    } catch (err) {
      console.error(`  Adzuna [${kw}] error:`, err.message);
    }
  }
  logScrape('adzuna', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Adzuna: ${added}/${found} jobs added`);
  return added;
}


// ══════════════════════════════════════════
// SOURCE: Reed.co.uk API (UK #1 job site)
// Requires REED_API_KEY env var
// ══════════════════════════════════════════
async function scrapeReed() {
  const start = Date.now();
  let found = 0, added = 0;
  const REED_KEY = process.env.REED_API_KEY || '';
  if (!REED_KEY) { console.log('  ⚠️ Reed: no API key set, skipping'); return 0; }
  const keywords = ['content writer', 'copywriter', 'technical writer', 'editor', 'journalist', 'blog writer'];
  for (const kw of keywords) {
    try {
      const auth = Buffer.from(REED_KEY + ':').toString('base64');
      const res = await axios.get('https://www.reed.co.uk/api/1.0/search', {
        params: { keywords: kw, locationName: 'United Kingdom', resultsToTake: 25, minimumSalary: 0 },
        headers: { 'Authorization': 'Basic ' + auth, 'User-Agent': getUA() },
        timeout: 15000
      });
      const jobs = res.data?.results || [];
      for (const j of jobs) {
        found++;
        const desc = (j.jobDescription || j.snippet || '').replace(/<[^>]*>/g, ' ').trim();
        const pay = parsePay(j.maximumSalary ? `${j.minimumSalary}-${j.maximumSalary}` : '');
        const url = j.jobUrl || `https://www.reed.co.uk/jobs/${j.jobId}`;
        if (insertJob({
          title: j.jobTitle,
          company: j.employerName || 'UK Employer',
          country: j.locationName || 'United Kingdom',
          pay_min: pay.pay_min, pay_max: pay.pay_max,
          pay_type: j.contractType || 'Full Time',
          description: desc.slice(0, 2000) || j.jobTitle,
          apply_url: j.jobUrl || url,
          source: 'reed', source_url: url
        })) added++;
      }
      await sleep(500);
    } catch (err) {
      console.error(`  Reed [${kw}] error:`, err.message);
    }
  }
  logScrape('reed', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Reed.co.uk: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE: jobs.ac.uk RSS (UK academic & writing jobs)
// ══════════════════════════════════════════
async function scrapeJobsAcUk() {
  const start = Date.now();
  let found = 0, added = 0;
  const feeds = [
    'https://www.jobs.ac.uk/feeds/subject-areas/media-and-communications',
    'https://www.jobs.ac.uk/feeds/subject-areas/languages-and-literature',
    'https://www.jobs.ac.uk/feeds/subject-areas/journalism',
    'https://www.jobs.ac.uk/feeds/type-roles/professional-or-managerial'
  ];
  for (const feed of feeds) {
    try {
      const res = await axios.get(feed, {
        headers: { 'User-Agent': getUA() },
        timeout: 12000
      });
      const $ = cheerio.load(res.data, { xmlMode: true });
      $('item').each((i, el) => {
        if (i >= 15) return false;
        const title = $(el).find('title').text().trim();
        const desc  = $(el).find('description').text().replace(/<[^>]*>/g, ' ').trim();
        const url   = $(el).find('link').text().trim();
        const company = $(el).find('publisher').text().trim() || 'UK University';
        if (!isWritingJob(title, desc)) return;
        found++;
        const pay = parsePay(desc);
        if (insertJob({
          title, company, country: 'United Kingdom',
          pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Full Time',
          description: desc.slice(0, 2000) || title,
          apply_url: url, source: 'jobsacuk', source_url: url
        })) added++;
      });
      await sleep(600);
    } catch (err) {
      console.error(`  jobs.ac.uk error:`, err.message);
    }
  }
  logScrape('jobsacuk', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ jobs.ac.uk: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE: Jobicy UK region filter
// ══════════════════════════════════════════
async function scrapeJobicyUK() {
  const start = Date.now();
  let found = 0, added = 0;
  const tags = ['writing', 'content', 'copywriting'];
  for (const tag of tags) {
    try {
      const res = await axios.get('https://jobicy.com/api/v2/remote-jobs', {
        params: { tag, count: 50 },
        headers: { 'User-Agent': getUA(), 'Accept': 'application/json' },
        timeout: 15000
      });
      const jobs = res.data?.jobs || [];
      for (const j of jobs) {
        found++;
        const desc = (j.jobDescription || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!isWritingJob(j.jobTitle, desc)) continue;
        const pay = parsePay(j.annualSalaryMin ? `${j.annualSalaryMin}-${j.annualSalaryMax}` : '');
        if (insertJob({
          title: j.jobTitle,
          company: j.companyName || 'UK Company',
          country: 'United Kingdom',
          pay_min: pay.pay_min, pay_max: pay.pay_max,
          pay_type: j.jobType || 'Full Time',
          description: desc.slice(0, 2000) || j.jobTitle,
          apply_url: j.url || '', source: 'jobicy_uk', source_url: j.url || ''
        })) added++;
      }
      await sleep(600);
    } catch (err) {
      console.error(`  Jobicy UK [${tag}] error:`, err.message);
    }
  }
  logScrape('jobicy_uk', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Jobicy UK: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// SOURCE: Guardian Jobs RSS (UK quality journalism jobs)
// ══════════════════════════════════════════
async function scrapeGuardianJobs() {
  const start = Date.now();
  let found = 0, added = 0;
  const feeds = [
    'https://jobs.theguardian.com/jobs/media/rss/',
    'https://jobs.theguardian.com/jobs/marketing/rss/',
    'https://jobs.theguardian.com/jobs/journalism/rss/'
  ];
  for (const feed of feeds) {
    try {
      const res = await axios.get(feed, {
        headers: { 'User-Agent': getUA() },
        timeout: 12000
      });
      const $ = cheerio.load(res.data, { xmlMode: true });
      $('item').each((i, el) => {
        if (i >= 15) return false;
        const title   = $(el).find('title').text().trim();
        const desc    = $(el).find('description').text().replace(/<[^>]*>/g, ' ').trim();
        const url     = $(el).find('link').text().trim();
        const company = $(el).find('company').text().trim() || 'UK Employer';
        if (!isWritingJob(title, desc)) return;
        found++;
        const pay = parsePay(desc);
        if (insertJob({
          title, company, country: 'United Kingdom',
          pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Full Time',
          description: desc.slice(0, 2000) || title,
          apply_url: url, source: 'guardianjobs', source_url: url
        })) added++;
      });
      await sleep(500);
    } catch (err) {
      console.error(`  Guardian Jobs error:`, err.message);
    }
  }
  logScrape('guardianjobs', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Guardian Jobs: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// ACADEMIC SOURCE 1: HigherEdJobs RSS (US — largest academic job board)
// ══════════════════════════════════════════
async function scrapeHigherEdJobs() {
  const start = Date.now();
  let found = 0, added = 0;
  // HigherEdJobs RSS feeds by category
  const feeds = [
    'https://www.higheredjobs.com/rss/articlesFeed.cfm?type=2',   // Communications/Writing
    'https://www.higheredjobs.com/rss/articlesFeed.cfm?type=11',  // Journalism
    'https://www.higheredjobs.com/rss/articlesFeed.cfm?type=3',   // Administrative (grants/research comms)
  ];
  for (const feed of feeds) {
    try {
      const res = await axios.get(feed, {
        headers: { 'User-Agent': getUA(), 'Accept': 'application/rss+xml, application/xml, text/xml' },
        timeout: 15000
      });
      const $ = cheerio.load(res.data, { xmlMode: true });
      $('item').each((i, el) => {
        if (i >= 20) return false;
        const title   = $(el).find('title').text().trim();
        const desc    = $(el).find('description').text().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const url     = $(el).find('link').text().trim();
        const company = $(el).find('institution, author').text().trim() || 'US University';
        if (!isWritingJob(title, desc)) return;
        found++;
        const pay = parsePay(desc);
        if (insertJob({
          title, company, country: 'United States',
          pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Full Time',
          description: desc.slice(0, 2000) || title,
          apply_url: url, source: 'higheredjobs', source_url: url
        })) added++;
      });
      await sleep(700);
    } catch (err) {
      console.error(`  HigherEdJobs error:`, err.message);
    }
  }
  logScrape('higheredjobs', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ HigherEdJobs: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// ACADEMIC SOURCE 2: Chronicle of Higher Education Jobs RSS
// ══════════════════════════════════════════
async function scrapeChronicleJobs() {
  const start = Date.now();
  let found = 0, added = 0;
  const feeds = [
    'https://www.academickeys.com/rss/jobs_by_discipline.php?discipline=Communication',
    'https://www.academickeys.com/rss/jobs_by_discipline.php?discipline=English',
    'https://www.academickeys.com/rss/jobs_by_discipline.php?discipline=Journalism'
  ];
  for (const feed of feeds) {
    try {
      const res = await axios.get(feed, {
        headers: { ...HEADERS, 'Referer': 'https://jobs.chronicle.com/' },
        timeout: 15000
      });
      const $ = cheerio.load(res.data, { xmlMode: true });
      $('item').each((i, el) => {
        if (i >= 15) return false;
        const title   = $(el).find('title').text().trim();
        const desc    = $(el).find('description').text().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const url     = $(el).find('link').text().trim();
        const company = $(el).find('dc\\:creator, creator, author').text().trim() || 'US Institution';
        if (!isWritingJob(title, desc)) return;
        found++;
        const pay = parsePay(desc);
        if (insertJob({
          title, company, country: 'United States',
          pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Full Time',
          description: desc.slice(0, 2000) || title,
          apply_url: url, source: 'chronicle', source_url: url
        })) added++;
      });
      await sleep(700);
    } catch (err) {
      console.error(`  Chronicle Jobs [${feed}] error:`, err.message);
    }
  }
  logScrape('chronicle', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Chronicle Higher Ed Jobs: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// ACADEMIC SOURCE 3: Inside Higher Ed Careers RSS
// ══════════════════════════════════════════
async function scrapeInsideHigherEd() {
  const start = Date.now();
  let found = 0, added = 0;
  const feeds = [
    'https://careers.insidehighered.com/jobs/rss/?field=Communications+%26+Marketing',
    'https://careers.insidehighered.com/jobs/rss/?field=Writing+%26+Editing'
  ];
  for (const feed of feeds) {
    try {
      const res = await axios.get(feed, {
        headers: { ...HEADERS, 'Referer': 'https://careers.insidehighered.com/' },
        timeout: 15000
      });
      const $ = cheerio.load(res.data, { xmlMode: true });
      $('item').each((i, el) => {
        if (i >= 15) return false;
        const title   = $(el).find('title').text().trim();
        const desc    = $(el).find('description').text().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const url     = $(el).find('link').text().trim();
        const company = $(el).find('dc\\:creator, creator').text().trim() || 'Higher Ed Institution';
        if (!isWritingJob(title, desc)) return;
        found++;
        const pay = parsePay(desc);
        if (insertJob({
          title, company, country: 'United States',
          pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Full Time',
          description: desc.slice(0, 2000) || title,
          apply_url: url, source: 'insidehighered', source_url: url
        })) added++;
      });
      await sleep(700);
    } catch (err) {
      console.error(`  Inside Higher Ed [${feed}] error:`, err.message);
    }
  }
  logScrape('insidehighered', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Inside Higher Ed: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// ACADEMIC SOURCE 4: Times Higher Education Jobs RSS (UK/Global)
// ══════════════════════════════════════════
async function scrapeTimesHigherEd() {
  const start = Date.now();
  let found = 0, added = 0;
  const feeds = [
    'https://euraxess.ec.europa.eu/jobs/rss',  // Communications
    'https://jobs.sciencecareers.org/jobs/rss/', // Editing/Publishing
    'https://jobs.sciencecareers.org/jobs/rss/', // Research Support
  ];
  for (const feed of feeds) {
    try {
      const res = await axios.get(feed, {
        headers: { ...HEADERS, 'Referer': 'https://www.timeshighereducation.com/' },
        timeout: 15000
      });
      const $ = cheerio.load(res.data, { xmlMode: true });
      $('item').each((i, el) => {
        if (i >= 15) return false;
        const title   = $(el).find('title').text().trim();
        const desc    = $(el).find('description').text().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const url     = $(el).find('link').text().trim();
        const company = $(el).find('company, dc\\:creator').text().trim() || 'UK/Global University';
        if (!isWritingJob(title, desc)) return;
        found++;
        const pay = parsePay(desc);
        if (insertJob({
          title, company, country: 'United Kingdom',
          pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Full Time',
          description: desc.slice(0, 2000) || title,
          apply_url: url, source: 'timeshighered', source_url: url
        })) added++;
      });
      await sleep(700);
    } catch (err) {
      console.error(`  Times Higher Ed [${feed}] error:`, err.message);
    }
  }
  logScrape('timeshighered', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ Times Higher Education Jobs: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// ACADEMIC SOURCE 5: EuroScienceJobs RSS (Europe — research & science writing)
// ══════════════════════════════════════════
async function scrapeEuroScienceJobs() {
  const start = Date.now();
  let found = 0, added = 0;
  // EuroScienceJobs provides an open RSS feed covering research positions across Europe
  const feeds = [
    'https://www.nature.com/naturejobs/science/jobs.rss',
    'https://euraxess.ec.europa.eu/jobs/rss'
  ];
  for (const feed of feeds) {
    try {
      const res = await axios.get(feed, {
        headers: { 'User-Agent': getUA(), 'Accept': 'application/rss+xml, application/xml, text/xml' },
        timeout: 15000
      });
      const $ = cheerio.load(res.data, { xmlMode: true });
      $('item').each((i, el) => {
        if (i >= 20) return false;
        const title   = $(el).find('title').text().trim();
        const desc    = $(el).find('description').text().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const url     = $(el).find('link').text().trim();
        const company = $(el).find('dc\\:creator, creator, author').text().trim() || 'European Institution';
        if (!isWritingJob(title, desc)) return;
        found++;
        const pay = parsePay(desc);
        if (insertJob({
          title, company, country: 'Europe',
          pay_min: pay.pay_min, pay_max: pay.pay_max, pay_type: 'Full Time',
          description: desc.slice(0, 2000) || title,
          apply_url: url, source: 'eurosciencejobs', source_url: url
        })) added++;
      });
      await sleep(700);
    } catch (err) {
      console.error(`  EuroScienceJobs [${feed}] error:`, err.message);
    }
  }
  logScrape('eurosciencejobs', found, added, 'success', '', Date.now() - start);
  console.log(`  ✅ EuroScienceJobs: ${added}/${found} jobs added`);
  return added;
}

// ══════════════════════════════════════════
// MAIN — runs all scrapers
// ══════════════════════════════════════════
async function runAllScrapers() {
  console.log(`\n🔍 PenHire Scraper starting: ${new Date().toISOString()}`);
  expireOldJobs();

  let total = 0;
  // ── General remote writing sources ──
  total += await scrapeRemotive();
  total += await scrapeJobicy();
  total += await scrapeWeWorkRemotely();
  total += await scrapeProBlogger();
  total += await scrapeAuthenticJobs();
  total += await scrapeWorkew();
  total += await scrapeMediaBistro();
  total += await scrapeRemoteCo();
  total += await scrapeJournalismJobs();
  total += await scrapeBloggingPro();
  total += await scrapeArbeitnow();
  total += await scrapeAdzuna();
  total += await scrapeReed();
  // ── Academic writing sources ──
  total += await scrapeJobsAcUk();
  total += await scrapeGuardianJobs();
  total += await scrapeHigherEdJobs();   // US — largest academic board
  // total += await scrapeChronicleJobs();  // blocked 403  // US — Chronicle of Higher Ed
  // total += await scrapeInsideHigherEd();  // returns 0 // US — Inside Higher Ed Careers
  // total += await scrapeTimesHigherEd();   // blocked 404  // UK/Global — Times Higher Education
  // total += await scrapeEuroScienceJobs(); // blocked 404// Europe — research & science writing

  const activeJobs = get('SELECT COUNT(*) as c FROM jobs WHERE is_active = 1');
  console.log(`\n✅ Scrape complete. New jobs this run: ${total}`);
  console.log(`📊 Total active jobs on platform: ${activeJobs?.c || 0}\n`);
  return total;
}

if (require.main === module) {
  runAllScrapers().then(() => process.exit(0)).catch(console.error);
}

module.exports = { runAllScrapers };
