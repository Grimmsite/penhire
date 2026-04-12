// backend/email.js — PenHire Email Service (Brevo HTTP API)
const https = require('https');
require('dotenv').config();

const BASE_URL  = process.env.BASE_URL  || 'https://penhire.onrender.com';
const FROM_NAME = 'PenHire';
const FROM_ADDR = process.env.SMTP_USER || 'grimmsite33@gmail.com';

// ── SHARED STYLES ──
const FONT  = `font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;`;
const GOLD  = '#c9a84c';
const INK   = '#0f0e0c';
const PAPER = '#f7f4ef';
const SAGE  = '#4a6741';
const MUTED = '#8a8478';

function baseTemplate(contentHtml) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ede9e0;${FONT}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ede9e0;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr>
        <td style="background:${INK};border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;">
          <a href="${BASE_URL}" style="text-decoration:none;">
            <span style="${FONT}font-size:28px;font-weight:900;color:${PAPER};letter-spacing:-0.5px;">
              ✒ Pen<span style="color:${GOLD}">Hire</span>
            </span>
          </a>
        </td>
      </tr>
      <tr>
        <td style="background:#ffffff;padding:40px 40px 32px;">
          ${contentHtml}
        </td>
      </tr>
      <tr>
        <td style="background:${INK};border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;">
          <p style="margin:0;${FONT}font-size:12px;color:rgba(247,244,239,0.4);line-height:1.6;">
            © ${new Date().getFullYear()} PenHire · Writing Jobs for Kenyan Writers<br>
            <a href="${BASE_URL}" style="color:${GOLD};text-decoration:none;">penhire.com</a>
            &nbsp;·&nbsp;
            <a href="mailto:${FROM_ADDR}" style="color:${GOLD};text-decoration:none;">Contact Support</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── GENERIC SEND via Brevo HTTP API ──
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
        if (res.statusCode === 201 || res.statusCode === 200) resolve({ success: true });
        else reject(new Error('Brevo error ' + res.statusCode + ': ' + data));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── WELCOME EMAIL ──
async function sendWelcome(user) {
  const html = baseTemplate(`
    <h1 style="margin:0 0 8px;${FONT}font-size:26px;font-weight:900;color:${INK};">
      Welcome to PenHire, ${user.name.split(' ')[0]}! 🎉
    </h1>
    <p style="margin:0 0 28px;${FONT}font-size:15px;color:${MUTED};line-height:1.6;">
      Your account is live. You now have access to hundreds of real writing jobs
      from employers in the US, UK, Canada, and Australia.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};border-radius:12px;padding:24px;margin-bottom:28px;">
      <tr>
        <td>
          <p style="margin:0 0 6px;${FONT}font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${GOLD};">Your Account</p>
          <p style="margin:0 0 4px;${FONT}font-size:14px;color:${INK};"><strong>Name:</strong> ${user.name}</p>
          <p style="margin:0 0 4px;${FONT}font-size:14px;color:${INK};"><strong>Email:</strong> ${user.email}</p>
          <p style="margin:0;${FONT}font-size:14px;color:${INK};"><strong>Speciality:</strong> ${user.speciality || 'General Writing'}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 20px;${FONT}font-size:14px;color:${MUTED};line-height:1.7;">
      Browse jobs, unlock the ones that interest you with a small fee, and apply directly to employers.
      No middlemen. No commissions. Get paid in dollars.
    </p>
    <a href="${BASE_URL}/jobs" style="display:inline-block;background:${GOLD};color:${INK};${FONT}font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;margin-bottom:8px;">
      Browse Writing Jobs →
    </a>
  `);
  await sendEmail({ to: user.email, subject: `Welcome to PenHire, ${user.name.split(' ')[0]}! ✒`, html });
}

// ── JOB UNLOCKED EMAIL ──
async function sendJobUnlocked(user, job) {
  const jobDetailUrl = `${BASE_URL}/job/${job.uuid}`;
  const applyUrl     = job.apply_url || job.source_url || '';
  const applyEmail   = job.apply_email || '';
  const payRange     = job.pay_max
    ? `$${job.pay_min || 0} – $${job.pay_max} ${job.pay_type || 'per project'}`
    : `$${job.pay_min || 0} ${job.pay_type || 'per project'}`;

  const rawDesc   = (job.description || '').replace(/<[^>]*>/g, '').trim();
  const descParas = rawDesc.split(/\n{2,}/).filter(Boolean).map(p =>
    `<p style="margin:0 0 12px;${FONT}font-size:14px;color:#333;line-height:1.7;">${p.replace(/\n/g, '<br>')}</p>`
  ).join('');

  const html = baseTemplate(`
    <div style="background:linear-gradient(135deg,${INK},#2a2820);border-radius:12px;padding:28px 32px;margin-bottom:32px;">
      <p style="margin:0 0 6px;${FONT}font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${GOLD};">Job Unlocked</p>
      <h1 style="margin:0 0 8px;${FONT}font-size:22px;font-weight:900;color:${PAPER};line-height:1.2;">${job.title}</h1>
      <p style="margin:0;${FONT}font-size:14px;color:rgba(247,244,239,0.6);">${job.company || 'Remote Employer'} · ${job.country || 'Remote'}</p>
    </div>
    <p style="margin:0 0 28px;${FONT}font-size:15px;color:${MUTED};line-height:1.6;">
      Hi ${user.name.split(' ')[0]}, you've unlocked full access to this job. Here's everything you need to apply — good luck! 🎉
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td width="48%" style="background:${PAPER};border-radius:10px;padding:16px;text-align:center;">
          <p style="margin:0 0 4px;${FONT}font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">Pay</p>
          <p style="margin:0;${FONT}font-size:16px;font-weight:900;color:${SAGE};">${payRange}</p>
        </td>
        <td width="4%"></td>
        <td width="48%" style="background:${PAPER};border-radius:10px;padding:16px;text-align:center;">
          <p style="margin:0 0 4px;${FONT}font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">Category</p>
          <p style="margin:0;${FONT}font-size:16px;font-weight:900;color:${INK};">${job.category || 'Writing'}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 12px;${FONT}font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${GOLD};">Job Description</p>
    <div style="margin-bottom:28px;">
      ${descParas || `<p style="margin:0;${FONT}font-size:14px;color:${MUTED};">See full details on PenHire.</p>`}
    </div>
    <div style="background:#f0f9f0;border:1px solid rgba(74,103,65,0.2);border-radius:12px;padding:24px;margin-bottom:32px;">
      <p style="margin:0 0 12px;${FONT}font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${SAGE};">How to Apply</p>
      ${applyEmail ? `<p style="margin:0 0 8px;${FONT}font-size:14px;color:${INK};">📧 <strong>Email:</strong> <a href="mailto:${applyEmail}" style="color:${SAGE};text-decoration:none;">${applyEmail}</a></p>` : ''}
      ${applyUrl ? `<p style="margin:0 0 16px;${FONT}font-size:14px;color:${INK};">🔗 <strong>Apply Link:</strong> <a href="${applyUrl}" style="color:${SAGE};text-decoration:none;word-break:break-all;">${applyUrl}</a></p>
      <a href="${applyUrl}" style="display:inline-block;background:${SAGE};color:#fff;${FONT}font-size:14px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:8px;">Apply on Original Posting →</a>` : ''}
    </div>
    <div style="border-top:1px solid #ede9e0;padding-top:24px;text-align:center;">
      <a href="${jobDetailUrl}" style="display:inline-block;background:${INK};color:${PAPER};${FONT}font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;">
        View Full Job on PenHire →
      </a>
    </div>
  `);
  await sendEmail({ to: user.email, subject: `🔓 Job Unlocked: ${job.title} — Full Details Inside`, html });
}

// ── JOB POSTED EMAIL ──
async function sendJobPosted(employer, job) {
  const html = baseTemplate(`
    <h1 style="margin:0 0 8px;${FONT}font-size:24px;font-weight:900;color:${INK};">Your job is now live! 🎉</h1>
    <p style="margin:0 0 28px;${FONT}font-size:15px;color:${MUTED};line-height:1.6;">
      Writers can now see and unlock your job listing on PenHire.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};border-radius:12px;padding:24px;margin-bottom:28px;">
      <tr>
        <td>
          <p style="margin:0 0 6px;${FONT}font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${GOLD};">Job Details</p>
          <p style="margin:0 0 4px;${FONT}font-size:14px;color:${INK};"><strong>Title:</strong> ${job.title}</p>
          <p style="margin:0 0 4px;${FONT}font-size:14px;color:${INK};"><strong>Category:</strong> ${job.category || 'Writing'}</p>
          <p style="margin:0;${FONT}font-size:14px;color:${INK};"><strong>Applications to:</strong> ${job.apply_email || 'N/A'}</p>
        </td>
      </tr>
    </table>
    <a href="${BASE_URL}" style="display:inline-block;background:${GOLD};color:${INK};${FONT}font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;">
      Visit PenHire →
    </a>
  `);
  await sendEmail({ to: employer.email, subject: `Your job is live on PenHire: ${job.title}`, html });
}

module.exports = { sendEmail, sendWelcome, sendJobUnlocked, sendJobPosted };
