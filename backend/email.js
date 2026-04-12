// backend/email.js — PenHire Email Service (Brevo HTTP API)
const https = require('https');
require('dotenv').config();

const BASE_URL  = process.env.BASE_URL  || 'https://penhire.onrender.com';
const FROM_NAME = 'PenHire';
const FROM_ADDR = 'grimmsite33@gmail.com';

async function sendEmail({ to, subject, html }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      sender: { name: FROM_NAME, email: FROM_ADDR },
      to: [{ email: to }],
      subject,
      htmlContent: html
    });
    const options = {
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 201 || res.statusCode === 200) {
          resolve({ success: true });
        } else {
          reject(new Error('Brevo API error: ' + data));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sendWelcome(user) {
  await sendEmail({
    to: user.email,
    subject: 'Welcome to PenHire ' + user.name.split(' ')[0] + '!',
    html: '<h1>Welcome to PenHire, ' + user.name.split(' ')[0] + '!</h1><p>Your account is ready. <a href="' + BASE_URL + '/jobs">Browse writing jobs now</a>.</p>'
  });
}

async function sendJobUnlocked(user, job) {
  await sendEmail({
    to: user.email,
    subject: 'Job Unlocked: ' + job.title,
    html: '<h1>You unlocked: ' + job.title + '</h1><p>Apply email: ' + (job.apply_email || 'N/A') + '</p><p><a href="' + (job.apply_url || BASE_URL) + '">Apply Now</a></p>'
  });
}

async function sendJobPosted(employer, job) {
  await sendEmail({
    to: employer.email,
    subject: 'Your job is live on PenHire: ' + job.title,
    html: '<h1>Your job is live!</h1><p>' + job.title + ' is now visible to writers on PenHire.</p>'
  });
}

module.exports = { sendEmail, sendWelcome, sendJobUnlocked, sendJobPosted };
