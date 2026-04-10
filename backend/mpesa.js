// backend/mpesa.js
// Full Safaricom Daraja M-Pesa STK Push Integration

const axios = require('axios');
require('dotenv').config();

const MPESA_BASE = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

// ── GET ACCESS TOKEN ──
async function getAccessToken() {
  const credentials = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const response = await axios.get(
    `${MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${credentials}` } }
  );
  return response.data.access_token;
}

// ── GENERATE PASSWORD ──
function getPassword() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14);
  const raw = `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`;
  return {
    password: Buffer.from(raw).toString('base64'),
    timestamp
  };
}

// ── FORMAT PHONE ──
// Converts 07XX → 2547XX
function formatPhone(phone) {
  phone = phone.replace(/\s+/g, '').replace(/\+/g, '');
  if (phone.startsWith('07') || phone.startsWith('01')) {
    return '254' + phone.slice(1);
  }
  if (phone.startsWith('7') || phone.startsWith('1')) {
    return '254' + phone;
  }
  return phone;
}

// ── INITIATE STK PUSH ──
async function initiateSTKPush({ phone, amount, reference, description }) {
  const token = await getAccessToken();
  const { password, timestamp } = getPassword();
  const formattedPhone = formatPhone(phone);

  const payload = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.ceil(amount),
    PartyA: formattedPhone,
    PartyB: process.env.MPESA_SHORTCODE,
    PhoneNumber: formattedPhone,
    CallBackURL: process.env.MPESA_CALLBACK_URL,
    AccountReference: reference,
    TransactionDesc: description || 'PenHire Payment'
  };

  const response = await axios.post(
    `${MPESA_BASE}/mpesa/stkpush/v1/processrequest`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return response.data;
  // Returns: { MerchantRequestID, CheckoutRequestID, ResponseCode, ResponseDescription, CustomerMessage }
}

// ── QUERY STK STATUS ──
async function querySTKStatus(checkoutRequestId) {
  const token = await getAccessToken();
  const { password, timestamp } = getPassword();

  const response = await axios.post(
    `${MPESA_BASE}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return response.data;
}

// ── PROCESS CALLBACK ──
// Called by Safaricom when payment is complete
function processCallback(body) {
  const stkCallback = body?.Body?.stkCallback;
  if (!stkCallback) return null;

  const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;

  const result = {
    merchantRequestId: MerchantRequestID,
    checkoutRequestId: CheckoutRequestID,
    resultCode: ResultCode,
    resultDesc: ResultDesc,
    success: ResultCode === 0
  };

  if (ResultCode === 0 && CallbackMetadata?.Item) {
    const items = CallbackMetadata.Item;
    const get = (name) => items.find(i => i.Name === name)?.Value;
    result.amount       = get('Amount');
    result.receipt      = get('MpesaReceiptNumber');
    result.phone        = get('PhoneNumber');
    result.transDate    = get('TransactionDate');
  }

  return result;
}

module.exports = { initiateSTKPush, querySTKStatus, processCallback, formatPhone };
