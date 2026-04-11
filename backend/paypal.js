// backend/paypal.js — PenHire PayPal Integration

const BASE_URL    = process.env.BASE_URL    || 'https://penhire.onrender.com';
const CLIENT_ID   = process.env.PAYPAL_CLIENT_ID;
const CLIENT_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_API  = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

// ── GET ACCESS TOKEN ──
async function getAccessToken() {
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method:  'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('PayPal auth failed: ' + JSON.stringify(data));
  return data.access_token;
}

// ── CREATE ORDER ──
// Accepts: { amount, description, referenceId, return_url, cancel_url }
async function createOrder({ amount, description, referenceId, return_url, cancel_url }) {
  const token = await getAccessToken();

  const returnUrl = return_url || `${BASE_URL}/payment/success`;
  const cancelUrl = cancel_url || `${BASE_URL}/payment/cancel`;

  const body = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: referenceId || `penhire-${Date.now()}`,
      description:  description  || 'PenHire Job Posting',
      amount: {
        currency_code: 'USD',
        value:         parseFloat(amount).toFixed(2),
      },
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name:          'PenHire',
          locale:              'en-US',
          landing_page:        'LOGIN',
          shipping_preference: 'NO_SHIPPING',
          user_action:         'PAY_NOW',
          return_url:          returnUrl,
          cancel_url:          cancelUrl,
        },
      },
    },
  };

  const res = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  const order = await res.json();
  if (!order.id) throw new Error('PayPal order creation failed: ' + JSON.stringify(order));

  // Find the payer-action approval link
  const approvalUrl = order.links?.find(l => l.rel === 'payer-action')?.href
    || order.links?.find(l => l.rel === 'approve')?.href;

  if (!approvalUrl) throw new Error('No PayPal approval URL returned');

  return { orderId: order.id, approvalUrl };
}

// ── CAPTURE ORDER ──
async function captureOrder(orderId) {
  const token = await getAccessToken();

  const res = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
  });

  const data = await res.json();

  if (data.status === 'COMPLETED') {
    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
    return {
      success:    true,
      orderId:    data.id,
      status:     data.status,
      payerEmail: data.payer?.email_address || '',
      amount:     capture?.amount?.value    || '0',
    };
  }

  return { success: false, status: data.status, error: data.message || 'Capture failed' };
}

module.exports = { createOrder, captureOrder };
