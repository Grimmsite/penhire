// backend/intasend.js
// IntaSend payment helper for PenHire
// Handles job unlocking (KES) and job posting (USD)

const IntaSend = require('intasend-node');
require('dotenv').config();

const intasend = new IntaSend(
  process.env.INTASEND_PUBLISHABLE_KEY,
  process.env.INTASEND_SECRET_KEY,
  process.env.INTASEND_TEST_MODE === 'true' // false = live, true = test
);

/**
 * Create a checkout link for job unlocking (KES)
 * Called when a user wants to unlock a job
 */
async function createUnlockCheckout({ email, first_name, last_name, phone, amount, jobUuid, userId, jobId }) {
  const collection = intasend.collection();
  const response = await collection.charge({
    first_name: first_name || 'User',
    last_name:  last_name  || '',
    email:      email,
    phone_number: phone   || '',
    amount:     amount,
    currency:   'KES',
    api_ref:    `unlock_${jobId}_${userId}_${Date.now()}`,
    redirect_url: `${process.env.BASE_URL}/payment/unlock-success?job=${jobUuid}`,
  });
  return response;
}

/**
 * Create a checkout link for job posting (USD)
 * Called when an employer wants to post a job
 */
async function createPostingCheckout({ email, first_name, last_name, amount, jobTitle, tempJobId }) {
  const collection = intasend.collection();
  const response = await collection.charge({
    first_name: first_name || 'Employer',
    last_name:  last_name  || '',
    email:      email,
    amount:     amount,
    currency:   'USD',
    api_ref:    `posting_${tempJobId}_${Date.now()}`,
    redirect_url: `${process.env.BASE_URL}/payment/success`,
  });
  return response;
}

module.exports = { intasend, createUnlockCheckout, createPostingCheckout };
