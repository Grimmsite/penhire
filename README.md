# PenHire – Complete Deployment Guide

## What You Have
A fully automated writing jobs platform with:
- ✅ Auto job scraping every 2 hours (RemoteOK, Jobicy, ProBlogger, Freelancer, WeWorkRemotely)
- ✅ M-Pesa STK Push for writer unlock payments
- ✅ PayPal for employer job posting fees
- ✅ Automated email notifications
- ✅ Admin dashboard
- ✅ JWT authentication
- ✅ SQLite database (zero config)
- ✅ Rate limiting & security headers

---

## PROJECT STRUCTURE
```
penhire/
├── server.js              ← Main server (start here)
├── package.json           ← Dependencies
├── .env.example           ← Copy to .env and fill in
├── config/
│   ├── setup.js           ← Run once to create database
│   └── database.js        ← DB connection
├── backend/
│   ├── mpesa.js           ← M-Pesa Daraja API
│   ├── paypal.js          ← PayPal REST API
│   └── email.js           ← Email notifications
├── scraper/
│   └── scraper.js         ← Auto job scraper
└── frontend/
    └── index.html         ← Your website (copy penhire.html here)
```

---

## STEP 1 – GET A SERVER

**Recommended: DigitalOcean Droplet or Hostinger VPS**
- Cost: ~$6/month (DigitalOcean) or KES 600/month (Hostinger Kenya)
- OS: Ubuntu 22.04 LTS
- Size: 1GB RAM is enough to start

**Alternative: Deploy on Railway.app (FREE to start)**
- Go to railway.app → New Project → Deploy from GitHub
- Free tier gives you $5/month credit = plenty for starting out

---

## STEP 2 – INSTALL ON YOUR SERVER

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone/upload your files to server
# Then install dependencies:
cd /var/www/penhire
npm install

# Copy and configure environment
cp .env.example .env
nano .env  # Fill in all your keys
```

---

## STEP 3 – GET YOUR API KEYS

### M-Pesa (Daraja API) – FREE
1. Go to https://developer.safaricom.co.ke
2. Create account → Create App
3. Get Consumer Key & Consumer Secret
4. For STK Push you need a Paybill or Till Number
5. Contact Safaricom Business for a Paybill: 0800 724 221

### PayPal Business – FREE
1. Go to https://developer.paypal.com
2. Create Business account
3. Go to My Apps → Create App
4. Copy Client ID and Secret

### Gmail App Password – FREE
1. Go to Google Account → Security → 2-Step Verification
2. Then Security → App Passwords
3. Create password for "Mail"
4. Use this as EMAIL_PASS (not your real password)

---

## STEP 4 – FILL IN .env FILE

Open .env and fill in:
```
PORT=3000
BASE_URL=https://penhire.com
JWT_SECRET=any_long_random_string_here

MPESA_CONSUMER_KEY=from_daraja_dashboard
MPESA_CONSUMER_SECRET=from_daraja_dashboard
MPESA_SHORTCODE=your_paybill_number
MPESA_PASSKEY=from_daraja_dashboard
MPESA_CALLBACK_URL=https://penhire.com/api/mpesa/callback

PAYPAL_CLIENT_ID=from_paypal_dashboard
PAYPAL_CLIENT_SECRET=from_paypal_dashboard
PAYPAL_MODE=live

EMAIL_USER=your@gmail.com
EMAIL_PASS=your_gmail_app_password

ADMIN_EMAIL=your@email.com
ADMIN_PASSWORD=your_strong_password
```

---

## STEP 5 – SET UP DATABASE & LAUNCH

```bash
# Create database and seed initial data
node config/setup.js

# Copy your frontend file
cp penhire.html frontend/index.html

# Start the server
npm start

# OR use PM2 to keep it running forever (recommended)
npm install -g pm2
pm2 start server.js --name penhire
pm2 save
pm2 startup  # Auto-restart on server reboot
```

---

## STEP 6 – POINT YOUR DOMAIN

1. Buy domain: penhire.com on Namecheap (~$12/year)
2. Add DNS A record pointing to your server IP
3. Install SSL (free):
```bash
sudo apt install certbot nginx
sudo certbot --nginx -d penhire.com
```

---

## HOW MONEY FLOWS TO YOU

### From Writers (M-Pesa)
- Writer clicks unlock → enters M-Pesa number
- M-Pesa STK push sent to their phone
- They confirm on phone
- KES 50–1,000 lands directly in YOUR M-Pesa/Paybill
- Job details sent to writer automatically

### From Employers (PayPal)
- Employer fills job form → pays $3–40 via PayPal
- Money lands in YOUR PayPal account
- Job goes live automatically
- Employer gets confirmation email

### You Do Nothing
Everything is 100% automatic after setup.

---

## SCRAPING SCHEDULE

The server automatically scrapes every 2 hours from:
| Source | Type | Jobs/run |
|--------|------|---------|
| RemoteOK | JSON API | 10–20 |
| Jobicy | JSON API | 10–20 |
| WeWorkRemotely | HTML | 10–15 |
| Freelancer RSS | RSS Feed | 15–30 |
| ProBlogger | RSS Feed | 10–15 |

**Estimated: 50–100 new jobs added per day automatically**

To manually trigger a scrape:
```bash
node scraper/scraper.js
# OR via admin API:
POST /api/admin/scrape  (with admin token)
```

---

## ADMIN DASHBOARD

Access at: https://penhire.com/admin
Login with your ADMIN_EMAIL and ADMIN_PASSWORD

Features:
- See total jobs, users, unlocks, revenue
- View scrape history and logs
- Activate/deactivate jobs
- See all transactions

---

## API ENDPOINTS SUMMARY

### Public
- GET  /api/jobs                    ← List jobs (preview only)
- GET  /api/jobs/:uuid              ← Single job preview

### Writers (requires login)
- POST /api/auth/register           ← Create account
- POST /api/auth/login              ← Login
- GET  /api/jobs/:uuid/full         ← Full job (if unlocked)
- POST /api/mpesa/initiate          ← Start M-Pesa payment
- GET  /api/mpesa/status/:id        ← Check payment status
- GET  /api/user/unlocks            ← My unlocked jobs

### Employers
- POST /api/paypal/create-job-order ← Create job + PayPal order
- POST /api/paypal/capture/:id      ← Confirm payment + post job

### Admin
- POST /api/auth/admin              ← Admin login
- GET  /api/admin/stats             ← Dashboard stats
- POST /api/admin/scrape            ← Manual scrape trigger
- GET  /api/admin/jobs              ← All jobs
- PATCH /api/admin/jobs/:id         ← Edit job
- DELETE /api/admin/jobs/:id        ← Remove job

---

## EXPECTED TIMELINE & REVENUE

| Month | Events | Est. Monthly Revenue |
|-------|--------|---------------------|
| 1 | Setup + first scraped jobs | KES 0 (building) |
| 2 | First writers register | KES 2,000–5,000 |
| 3 | Word spreads organically | KES 8,000–20,000 |
| 6 | Established platform | KES 35,000–80,000 |
| 12 | Scale achieved | KES 90,000–200,000+ |

---

## SUPPORT

If you need help deploying, contact:
- Safaricom Daraja: developer.safaricom.co.ke
- DigitalOcean support: digitalocean.com/support
- PayPal developer support: developer.paypal.com

Good luck! 🚀
