// backend/paypal.js
// PayPal REST API Integration for Employer Job Posting Fees

const axios = require('axios');
require('dotenv').config();

const PAYPAL_BASE = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

// ── GET ACCESS TOKEN ──
async function getPayPalToken() {
  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const response = await axios.post(
    `${PAYPAL_BASE}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  return response.data.access_token;
}

// ── CREATE ORDER ──
async function createOrder({ amount, description, referenceId }) {
  const token = await getPayPalToken();

  const response = await axios.post(
    `${PAYPAL_BASE}/v2/checkout/orders`,
    {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: referenceId,
        description: description,
        amount: {
          currency_code: 'USD',
          value: amount.toFixed(2)
        }
      }],
      application_context: {
        brand_name: 'PenHire',
        landing_page: 'BILLING',
        user_action: 'PAY_NOW',
        return_url: `${process.env.BASE_URL}/payment/success`,
        cancel_url: `${process.env.BASE_URL}/payment/cancel`
      }
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const order = response.data;
  const approvalUrl = order.links.find(l => l.rel === 'approve')?.href;

  return {
    orderId: order.id,
    approvalUrl,
    status: order.status
  };
}

// ── CAPTURE ORDER (after user approves) ──
async function captureOrder(orderId) {
  const token = await getPayPalToken();

  const response = await axios.post(
    `${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`,
    {},
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const order = response.data;
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];

  return {
    orderId: order.id,
    status: order.status,
    captureId: capture?.id,
    amount: capture?.amount?.value,
    currency: capture?.amount?.currency_code,
    payerEmail: order.payer?.email_address,
    success: order.status === 'COMPLETED'
  };
}

// ── GET ORDER DETAILS ──
async function getOrder(orderId) {
  const token = await getPayPalToken();
  const response = await axios.get(
    `${PAYPAL_BASE}/v2/checkout/orders/${orderId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return response.data;
}

module.exports = { createOrder, captureOrder, getOrder };
