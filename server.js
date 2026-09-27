import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(projectRoot));

const requiredConfig = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'PESAPAL_BASE_URL',
  'PESAPAL_CONSUMER_KEY',
  'PESAPAL_CONSUMER_SECRET',
  'PESAPAL_IPN_ID'
];
const missingConfig = requiredConfig.filter(name => !process.env[name]);
if (missingConfig.length > 0) {
  throw new Error(`Missing required environment variables: ${missingConfig.join(', ')}`);
}
const configuredServerUrl = process.env.SERVER_URL || 'http://localhost:5000';
const isLocalServerUrl = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(configuredServerUrl);
const isPlaceholderServerUrl = /your-domain\.com/i.test(configuredServerUrl);
if (process.env.SERVER_URL && !/^https?:\/\//i.test(process.env.SERVER_URL)) {
  throw new Error('SERVER_URL must use HTTPS.');
}
if (isLocalServerUrl || isPlaceholderServerUrl) {
  console.warn('SERVER_URL is not publicly reachable. Pesapal callbacks require an HTTPS tunnel such as ngrok or Cloudflare Tunnel.');
}

const serverUrl = configuredServerUrl.replace(/\/$/, '');
const frontendUrl = (process.env.FRONTEND_URL || serverUrl).replace(/\/$/, '');

// Initialize Supabase Client with Service Role Key (Bypasses RLS for secure backend updates)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const cashierAuthAttempts = new Map();
const CASHIER_AUTH_WINDOW_MS = 60_000;
const CASHIER_AUTH_LIMIT = 8;

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

app.post('/api/cashier/auth', async (req, res) => {
  const { openingFloat } = req.body || {};
  const normalizedFloat = Number(openingFloat);
  const authorization = String(req.headers.authorization || '');
  const accessToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
  const attemptKey = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recentAttempts = (cashierAuthAttempts.get(attemptKey) || [])
    .filter(timestamp => now - timestamp < CASHIER_AUTH_WINDOW_MS);

  if (recentAttempts.length >= CASHIER_AUTH_LIMIT) {
    return res.status(429).json({ success: false, error: 'Too many sign-in attempts. Try again shortly.' });
  }
  recentAttempts.push(now);
  cashierAuthAttempts.set(attemptKey, recentAttempts);

  if (!accessToken || !Number.isFinite(normalizedFloat) || normalizedFloat < 0) {
    return res.status(400).json({ success: false, error: 'A valid signed-in cashier and opening float are required.' });
  }

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) {
      return res.status(401).json({ success: false, error: 'Your cashier session is invalid or expired.' });
    }

    const { data: cashier, error: cashierError } = await supabase
      .from('cashiers')
      .select('id, full_name, is_active')
      .eq('id', userData.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (cashierError) throw cashierError;
    if (!cashier) {
      return res.status(403).json({ success: false, error: 'This account is not an active cashier account.' });
    }

    const { data: openShift, error: openShiftError } = await supabase
      .from('cashier_shifts')
      .select('id, cashier_id, opening_float, status')
      .eq('cashier_id', cashier.id)
      .eq('status', 'open')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openShiftError) throw openShiftError;
    if (openShift) {
      return res.json({
        success: true,
        resumed: true,
        cashier: { id: cashier.id, full_name: cashier.full_name },
        shift: openShift
      });
    }

    const { data: shift, error: shiftError } = await supabase
      .from('cashier_shifts')
      .insert([{ cashier_id: cashier.id, opening_float: normalizedFloat, status: 'open' }])
      .select('id, cashier_id, opening_float, status')
      .single();

    if (shiftError) throw shiftError;

    return res.json({
      success: true,
      cashier: { id: cashier.id, full_name: cashier.full_name },
      shift
    });
  } catch (error) {
    console.error('Cashier authentication error:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to start cashier shift.' });
  }
});

app.delete('/api/admin/products/:id', async (req, res) => {
  const authorization = String(req.headers.authorization || '');
  const accessToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';

  if (!accessToken) {
    return res.status(401).json({ success: false, error: 'Admin sign-in is required.' });
  }

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) {
      return res.status(401).json({ success: false, error: 'Your admin session is invalid or expired.' });
    }
    if (userData.user.app_metadata?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access is required to delete products.' });
    }

    const { data: deletedProduct, error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();

    if (deleteError) throw deleteError;
    if (!deletedProduct) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }

    return res.json({ success: true, id: deletedProduct.id });
  } catch (error) {
    console.error('Admin product deletion error:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to delete product.' });
  }
});

/**
 * 1. Helper: Fetch Bearer Access Token from Pesapal v3
 */
async function getPesapalToken() {
  const url = `${process.env.PESAPAL_BASE_URL}/api/Auth/RequestToken`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
    })
  });

  const data = await response.json();
  if (!response.ok || !data.token) {
    throw new Error(`Pesapal Auth Failed: ${data.error?.message || response.statusText}`);
  }
  return data.token;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function getPesapalStatus(orderTrackingId) {
  const token = await getPesapalToken();
  const statusUrl = new URL(`${process.env.PESAPAL_BASE_URL}/api/Transactions/GetTransactionStatus`);
  statusUrl.searchParams.set('orderTrackingId', orderTrackingId);
  const response = await fetch(statusUrl, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'Unable to verify Pesapal payment.');
  }
  return data;
}

async function syncPesapalOrder(orderTrackingId, merchantReference) {
  const statusData = await getPesapalStatus(orderTrackingId);
  const paymentStatus = String(statusData.payment_status_description || '').toLowerCase();
  const statusByProvider = {
    completed: 'completed',
    failed: 'failed',
    reversed: 'failed',
    invalid: 'failed'
  };
  const dbStatus = statusByProvider[paymentStatus];

  let orderId = String(merchantReference || '').match(/^POS-ORD-(\d+)-\d+$/)?.[1] || null;
  if (!orderId) {
    const { data: order, error } = await supabase
      .from('orders')
      .select('id')
      .eq('pesapal_tracking_id', orderTrackingId)
      .maybeSingle();
    if (error) throw error;
    orderId = order?.id ? String(order.id) : null;
  }

  if (orderId && dbStatus) {
    const { error } = await supabase
      .from('orders')
      .update({
        status: dbStatus,
        payment_method: statusData.payment_method || 'Pesapal',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);
    if (error) throw error;
  }

  return { orderId, paymentStatus, statusData };
}

/**
 * Helper: Used previously to register IPN URL with Pesapal
 */
async function registerIpnUrl() {
  try {
    const token = await getPesapalToken();

    const response = await fetch(`${process.env.PESAPAL_BASE_URL}/api/URLSetup/RegisterIPN`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        url: `${serverUrl}/api/payments/pesapal-ipn`,
        ipn_notification_type: 'GET'
      })
    });

    const data = await response.json();
    console.log("Your PESAPAL_IPN_ID is:", data.ipn_id);
  } catch (err) {
    console.error("IPN Registration Error:", err.message);
  }
}

/**
 * 2. POST /api/payments/pesapal
 * Initiates payment prompt via Pesapal v3
 */
app.post('/api/payments/pesapal', async (req, res) => {
  const { orderId, phoneNumber, email } = req.body;

  if (!orderId || !phoneNumber) {
    return res.status(400).json({ success: false, error: 'Missing required parameters: phoneNumber, orderId' });
  }

  try {
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('total_amount, status')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const amountToCharge = Number(order.total_amount);
    if (!Number.isFinite(amountToCharge) || amountToCharge <= 0) {
      return res.status(400).json({ success: false, error: 'Order amount is invalid' });
    }

    const token = await getPesapalToken();

    const orderPayload = {
      id: `POS-ORD-${orderId}-${Date.now()}`,
      currency: "UGX",
      amount: amountToCharge,
      description: `Payment for Supermarket POS Order #${orderId}`,
      callback_url: `${serverUrl}/api/payments/pesapal-callback`,
      notification_id: process.env.PESAPAL_IPN_ID,
      billing_address: {
        email_address: email || "cashier@supermarket.com",
        phone_number: phoneNumber,
        country_code: "UG",
        first_name: "Customer",
        last_name: "POS"
      }
    };

    const response = await fetch(`${process.env.PESAPAL_BASE_URL}/api/Transactions/SubmitOrderRequest`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(orderPayload)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error?.message || "Failed to submit order to Pesapal");
    }

    // Update local order record with Pesapal Order Tracking ID
    await supabase
      .from('orders')
      .update({ 
        pesapal_tracking_id: result.order_tracking_id,
        status: 'pending'
      })
      .eq('id', orderId);

    res.json({
      success: true,
      orderTrackingId: result.order_tracking_id,
      redirectUrl: result.redirect_url
    });

  } catch (err) {
    console.error("Payment Submission Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 4. GET /api/payments/pesapal-ipn
 * Webhook handler called automatically by Pesapal when payment status changes
 */
app.get('/api/payments/pesapal-ipn', async (req, res) => {
  const { OrderTrackingId, OrderNotificationType, OrderMerchantReference } = req.query;

  if (!OrderTrackingId) {
    return res.status(400).send("Missing OrderTrackingId");
  }

  try {
    const synced = await syncPesapalOrder(
      String(OrderTrackingId),
      String(OrderMerchantReference || '')
    );
    if (synced.orderId && synced.paymentStatus) {
      console.log(`Order #${synced.orderId} Pesapal status: '${synced.paymentStatus}'.`);
    }

    // Mandatory response format required by Pesapal IPN protocol
    res.status(200).json({
      orderNotificationType: OrderNotificationType,
      orderTrackingId: OrderTrackingId,
      orderMerchantReference: OrderMerchantReference,
      status: 200
    });

  } catch (err) {
    console.error("IPN Processing Error:", err.message);
    res.status(500).send("IPN Handler Internal Error");
  }
});

/**
 * 5. GET /api/orders/:id/status
 * Polling endpoint for cashier terminal UI to check if payment complete
 */
app.get('/api/orders/:id/status', async (req, res) => {
  const { id } = req.params;

  try {
    let { data: order, error } = await supabase
      .from('orders')
      .select('id, status, payment_method, total_amount, pesapal_tracking_id, payment_transactions(status)')
      .eq('id', id)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status === 'pending' && order.pesapal_tracking_id) {
      try {
        await syncPesapalOrder(order.pesapal_tracking_id, '');
        const refreshed = await supabase
          .from('orders')
          .select('id, status, payment_method, total_amount, pesapal_tracking_id, payment_transactions(status)')
          .eq('id', id)
          .single();
        order = refreshed.data || order;
      } catch (err) {
        console.error('Pesapal status polling error:', err.message);
      }
    }

    res.json({
      orderId: order.id,
      status: order.status,
      transactionStatus: order.payment_transactions?.[0]?.status || 'pending',
      payment_method: order.payment_method,
      total_amount: order.total_amount
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 5. GET /api/payments/pesapal-callback
 * Redirect landing page after user completes/cancels payment on Pesapal UI
 */
app.get('/api/payments/pesapal-callback', async (req, res) => {
  const { OrderTrackingId, OrderMerchantReference } = req.query;

  // Extract original orderId from MerchantReference "POS-ORD-{orderId}-{timestamp}"
  const parts = OrderMerchantReference ? OrderMerchantReference.split('-') : [];
  const orderId = parts.length >= 3 ? parts[2] : null;

  console.log(`[Pesapal Callback] Returned for Order #${orderId}, Tracking ID: ${OrderTrackingId}`);

  if (orderId) {
    const callbackUrl = new URL('/cashier.html', `${frontendUrl}/`);
    callbackUrl.searchParams.set('orderId', orderId);
    callbackUrl.searchParams.set('trackingId', OrderTrackingId || '');
    callbackUrl.searchParams.set('status', 'processing');
    return res.redirect(callbackUrl.toString());
  }

  res.redirect(new URL('/cashier.html', `${frontendUrl}/`).toString());
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Pesapal POS Payment Backend running on port ${PORT}`);
  
  // Registration disabled now that PESAPAL_IPN_ID is saved in .env
   //registerIpnUrl();
});