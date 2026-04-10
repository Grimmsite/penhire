# PenHire – Render + GitHub Deployment Guide

## STEP 1 – Push to GitHub

On your computer, open terminal and run:

```bash
# Navigate to your penhire folder
cd penhire

# Initialize git
git init

# Add all files
git add .

# First commit
git commit -m "Initial PenHire deployment"

# Create repo on GitHub first at github.com/new
# Then connect and push:
git remote add origin https://github.com/YOURUSERNAME/penhire.git
git branch -M main
git push -u origin main
```

---

## STEP 2 – Create Render Web Service

1. Go to **render.com** → Sign up (free)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account
4. Select your **penhire** repository
5. Fill in these settings:

| Setting | Value |
|---------|-------|
| Name | penhire |
| Region | Oregon (US West) |
| Branch | main |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Plan | Free |

6. Click **"Create Web Service"**

---

## STEP 3 – Add Environment Variables on Render

In your Render dashboard → your service → **Environment** tab.
Add each of these one by one:

### Required (won't work without these)
```
NODE_ENV          = production
JWT_SECRET        = (click "Generate" for a random value)
BASE_URL          = https://penhire.onrender.com  ← your Render URL
ADMIN_EMAIL       = your@email.com
ADMIN_PASSWORD    = YourStrongPassword123!
```

### M-Pesa (get from developer.safaricom.co.ke)
```
MPESA_CONSUMER_KEY     = paste from Daraja
MPESA_CONSUMER_SECRET  = paste from Daraja
MPESA_SHORTCODE        = your paybill number
MPESA_PASSKEY          = paste from Daraja
MPESA_CALLBACK_URL     = https://penhire.onrender.com/api/mpesa/callback
MPESA_ENV              = production
```

### PayPal (get from developer.paypal.com)
```
PAYPAL_CLIENT_ID       = paste from PayPal
PAYPAL_CLIENT_SECRET   = paste from PayPal
PAYPAL_MODE            = live
```

### Email (Gmail)
```
EMAIL_HOST   = smtp.gmail.com
EMAIL_PORT   = 587
EMAIL_USER   = your@gmail.com
EMAIL_PASS   = your_gmail_app_password
EMAIL_FROM   = PenHire <noreply@penhire.com>
```

Click **"Save Changes"** — Render auto-redeploys.

---

## STEP 4 – Important: Free Tier Limitation

Render's **free tier spins down after 15 minutes of inactivity**.
This means:
- First visit after idle takes ~30 seconds to load
- Database resets on each deploy (jobs re-scraped automatically)

**To fix this for $7/month:**
1. Upgrade to Render "Starter" plan
2. Add a **Disk** in your service settings:
   - Mount path: `/var/data`
   - Size: 1 GB
3. The database will now persist forever

**Free workaround** (keep alive):
Use UptimeRobot (free at uptimerobot.com) to ping your site every 5 minutes:
- Monitor URL: `https://penhire.onrender.com/api/health`
- Interval: Every 5 minutes
This prevents Render from spinning down your server.

---

## STEP 5 – Custom Domain (Optional)

1. Buy **penhire.com** on Namecheap (~$12/year)
2. In Render → Settings → Custom Domains → Add `penhire.com`
3. Render gives you a CNAME record
4. Add that CNAME in your Namecheap DNS settings
5. SSL is automatic and free ✅

---

## STEP 6 – Auto Deploy (Already Set Up)

Every time you push to GitHub, Render automatically redeploys:

```bash
# Make a change, then:
git add .
git commit -m "Update something"
git push

# Render detects the push and redeploys in ~2 minutes
```

---

## VERIFY DEPLOYMENT

After deploy, check these URLs:

- `https://penhire.onrender.com` → Your website
- `https://penhire.onrender.com/api/health` → Should return `{"status":"ok",...}`
- `https://penhire.onrender.com/api/jobs` → Should return scraped jobs

---

## TROUBLESHOOTING

**Build fails:**
- Check Render logs (Dashboard → Logs tab)
- Most common issue: missing environment variables

**M-Pesa callback not working:**
- Make sure MPESA_CALLBACK_URL uses your actual Render URL (not localhost)
- Safaricom requires HTTPS — Render provides this for free

**No jobs showing:**
- Jobs are scraped 30 seconds after server starts
- Check logs for scraper output
- Visit `/api/health` to confirm server is running

**Database empty after redeploy:**
- Expected on free tier — scraper refills it automatically within 1 minute
- Upgrade to paid + disk to persist data

---

## FILE STRUCTURE IN YOUR REPO

```
penhire/
├── .gitignore          ← keeps .env and node_modules out of git
├── render.yaml         ← Render auto-detects this
├── package.json        ← dependencies and start command
├── server.js           ← main server
├── config/
│   ├── database.js     ← auto-creates database on start
│   └── setup.js        ← optional manual setup
├── backend/
│   ├── mpesa.js        ← M-Pesa payments
│   ├── paypal.js       ← PayPal payments
│   └── email.js        ← email notifications
├── scraper/
│   └── scraper.js      ← auto job scraper
└── frontend/
    └── index.html      ← your website
```
