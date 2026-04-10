// backend/email.js
// Automated email notifications for all platform events

const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const BRAND_COLOR = '#c9a84c';
const DARK = '#0f0e0c';

// ── BASE EMAIL TEMPLATE ──
function baseTemplate(content) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Georgia, serif; background: #f7f4ef; margin: 0; padding: 0; }
    .wrapper { max-width: 580px; margin: 0 auto; padding: 40px 20px; }
    .card { background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: ${DARK}; padding: 32px 40px; text-align: center; }
    .logo { color: white; font-size: 24px; font-weight: bold; text-decoration: none; }
    .logo span { color: ${BRAND_COLOR}; }
    .body { padding: 40px; }
    h2 { color: ${DARK}; font-size: 22px; margin: 0 0 16px; }
    p { color: #555; line-height: 1.7; font-size: 15px; margin: 0 0 16px; font-family: Arial, sans-serif; }
    .btn { display: inline-block; background: ${BRAND_COLOR}; color: ${DARK};
           padding: 14px 32px; border-radius: 8px; text-decoration: none;
           font-weight: bold; font-size: 15px; margin: 8px 0; }
    .highlight { background: #f7f4ef; border-left: 4px solid ${BRAND_COLOR};
                 padding: 16px 20px; border-radius: 0 8px 8px 0; margin: 20px 0; }
    .highlight strong { color: ${DARK}; font-size: 16px; }
    .footer-note { text-align: center; color: #aaa; font-size: 12px;
                   font-family: Arial, sans-serif; margin-top: 24px; }
    .divider { border: none; border-top: 1px solid #eee; margin: 24px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <div class="logo">✒ Pen<span>Hire</span></div>
      </div>
      <div class="body">
        ${content}
      </div>
    </div>
    <div class="footer-note">
      © 2026 PenHire · Kenya's Writing Jobs Platform<br>
      <a href="${process.env.BASE_URL}" style="color: ${BRAND_COLOR};">penhire.com</a>
    </div>
  </div>
</body>
</html>`;
}

// ── SEND EMAIL ──
async function sendEmail({ to, subject, html }) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to, subject, html
    });
    return { success: true };
  } catch (err) {
    console.error('Email error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── WELCOME EMAIL (Writer) ──
async function sendWelcome(user) {
  const html = baseTemplate(`
    <h2>Welcome to PenHire, ${user.name}! ✒</h2>
    <p>Your account is live. You can now browse and unlock writing jobs from employers in the US, UK, Canada, and Australia.</p>
    <div class="highlight">
      <strong>How to get started:</strong><br><br>
      <span style="font-family:Arial;font-size:14px;color:#555;">
        1. Browse the latest jobs at penhire.com/jobs<br>
        2. Find a job that matches your skills<br>
        3. Pay the small unlock fee via M-Pesa<br>
        4. Get the employer's details and apply directly<br>
        5. Get paid in dollars 🎉
      </span>
    </div>
    <a href="${process.env.BASE_URL}/jobs" class="btn">Browse Jobs Now →</a>
    <hr class="divider">
    <p style="font-size:13px;">Questions? Reply to this email and we'll help you out.</p>
  `);
  return sendEmail({ to: user.email, subject: 'Welcome to PenHire – Start earning in dollars', html });
}

// ── JOB UNLOCKED EMAIL ──
async function sendJobUnlocked(user, job) {
  const html = baseTemplate(`
    <h2>Job Unlocked! 🔓</h2>
    <p>You've successfully unlocked a job. Here are the full details:</p>
    <div class="highlight">
      <strong>${job.title}</strong><br>
      <span style="font-family:Arial;font-size:14px;color:#555;">
        🏢 ${job.company} · ${job.country}<br>
        💰 $${job.pay_min}–$${job.pay_max} ${job.pay_type}<br>
        📧 Apply to: <strong>${job.apply_email}</strong>
      </span>
    </div>
    <h3 style="color:${DARK};font-size:17px;">Full Job Description</h3>
    <p>${job.description}</p>
    ${job.requirements ? `<h3 style="color:${DARK};font-size:17px;">Requirements</h3><p>${job.requirements}</p>` : ''}
    <div class="highlight">
      <strong>How to apply:</strong><br>
      <span style="font-family:Arial;font-size:14px;color:#555;">
        Send your application, writing samples, and rate to:<br>
        <strong>${job.apply_email}</strong><br><br>
        ${job.apply_url ? `Or apply online: <a href="${job.apply_url}">${job.apply_url}</a>` : ''}
      </span>
    </div>
    <p style="font-size:13px;color:#aaa;">Good luck! Most applications are reviewed within 48 hours.</p>
  `);
  return sendEmail({ to: user.email, subject: `Job Unlocked: ${job.title}`, html });
}

// ── JOB POSTED EMAIL (Employer) ──
async function sendJobPosted(employer, job) {
  const html = baseTemplate(`
    <h2>Your Job is Live! 🎉</h2>
    <p>Your job posting is now live on PenHire and visible to 800+ Kenyan writers.</p>
    <div class="highlight">
      <strong>${job.title}</strong><br>
      <span style="font-family:Arial;font-size:14px;color:#555;">
        💰 Budget: $${job.pay_min}–$${job.pay_max}<br>
        📧 Applications sent to: ${employer.email}<br>
        ⏰ Expires: 30 days from today
      </span>
    </div>
    <p>Writers will apply directly to your email address. You can expect your first applications within a few hours.</p>
    <p style="font-size:13px;color:#aaa;">Need to edit or remove your listing? Reply to this email.</p>
  `);
  return sendEmail({ to: employer.email, subject: `Job Posted: ${job.title} is now live on PenHire`, html });
}

// ── NEW JOB ALERT (to all writers in category) ──
async function sendNewJobAlert(writers, job) {
  for (const writer of writers) {
    const html = baseTemplate(`
      <h2>New Job: ${job.title} 🆕</h2>
      <p>A new job matching your speciality was just posted.</p>
      <div class="highlight">
        <strong>${job.title}</strong><br>
        <span style="font-family:Arial;font-size:14px;color:#555;">
          🏢 ${job.company} · ${job.country}<br>
          💰 $${job.pay_min}–$${job.pay_max} ${job.pay_type}<br>
          🔓 Unlock fee: KES ${job.unlock_kes}
        </span>
      </div>
      <a href="${process.env.BASE_URL}/jobs/${job.uuid}" class="btn">View & Unlock Job →</a>
      <p style="font-size:12px;color:#aaa;margin-top:20px;">
        You're receiving this because you registered as a ${job.category} writer.
        <a href="${process.env.BASE_URL}/unsubscribe?email=${writer.email}" style="color:#aaa;">Unsubscribe</a>
      </p>
    `);
    await sendEmail({ to: writer.email, subject: `New ${job.category} job: ${job.title} – KES ${job.unlock_kes} to unlock`, html });
    // Small delay to avoid spam throttling
    await new Promise(r => setTimeout(r, 200));
  }
}

// ── ADMIN NEW JOB ALERT ──
async function sendAdminNewJob(job) {
  const html = baseTemplate(`
    <h2>New Job Posted 📋</h2>
    <div class="highlight">
      <strong>${job.title}</strong><br>
      <span style="font-family:Arial;font-size:14px;color:#555;">
        Source: ${job.source}<br>
        Category: ${job.category}<br>
        Pay: $${job.pay_min}–$${job.pay_max}<br>
        Company: ${job.company}
      </span>
    </div>
    <a href="${process.env.BASE_URL}/admin/jobs" class="btn">View in Admin →</a>
  `);
  return sendEmail({ to: process.env.ADMIN_EMAIL, subject: `New job posted: ${job.title}`, html });
}

module.exports = {
  sendWelcome,
  sendJobUnlocked,
  sendJobPosted,
  sendNewJobAlert,
  sendAdminNewJob,
  sendEmail
};
