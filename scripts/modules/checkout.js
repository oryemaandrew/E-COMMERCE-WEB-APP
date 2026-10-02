import { supabase } from './supabase.js';
import { initTheme } from './theme.js';

const CART_STORAGE_KEY = 'vendora_cart_items';
const ORDER_STATUS_TOKEN_KEY = 'vendora_order_status_token';
const PAYMENT_API_BASE = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  && window.location.port !== '5000'
  ? 'http://localhost:5000'
  : '';

initTheme();

const form = document.getElementById('checkoutForm');
const content = document.getElementById('checkoutContent');
const emptyState = document.getElementById('checkoutEmpty');
const submitButton = document.getElementById('authorizePaymentBtn');
const statusMessage = document.getElementById('checkoutStatus');
const pickupProof = document.getElementById('pickupProof');
const pickupQrImage = document.getElementById('pickupQrImage');
const pickupOrderNumber = document.getElementById('pickupOrderNumber');

let cart = readCart();
renderSummary();
form?.addEventListener('submit', submitCheckout);
void handlePaymentReturn();

function readCart() {
  try {
    const stored = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
    return Array.isArray(stored)
      ? stored.filter(item => item && item.id != null && Number(item.quantity) > 0)
      : [];
  } catch {
    localStorage.removeItem(CART_STORAGE_KEY);
    return [];
  }
}

function renderSummary() {
  content.hidden = cart.length === 0;
  emptyState.hidden = cart.length > 0;
}

async function submitCheckout(event) {
  event.preventDefault();
  if (!cart.length || !form) return;

  const formData = new FormData(form);
  const customerName = String(formData.get('customerName') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const email = String(formData.get('email') || '').trim() || 'customer@vendorastore.com';
  submitButton.disabled = true;
  submitButton.querySelector('span:first-child').textContent = 'Starting secure payment...';
  setStatus('', '');

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    const checkoutResponse = await fetch(`${PAYMENT_API_BASE}/api/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
      },
      body: JSON.stringify({
        items: cart.map(item => ({ productId: String(item.id), quantity: Number(item.quantity) })),
        customerName,
        phone,
        email
      })
    });
    const checkoutResult = await checkoutResponse.json().catch(() => ({}));
    if (!checkoutResponse.ok || !checkoutResult.success || !checkoutResult.order?.id) {
      throw new Error(checkoutResult.error || `Unable to create checkout order (HTTP ${checkoutResponse.status}).`);
    }

    const orderId = checkoutResult.order.id;
    const orderToken = checkoutResult.orderStatusToken;
    sessionStorage.setItem(`${ORDER_STATUS_TOKEN_KEY}:${orderId}`, orderToken);

    const paymentResponse = await fetch(`${PAYMENT_API_BASE}/api/payments/pesapal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, orderToken, phoneNumber: phone, email, source: 'storefront' })
    });
    const paymentResult = await paymentResponse.json().catch(() => ({}));
    if (!paymentResponse.ok || !paymentResult.success || !paymentResult.redirectUrl) {
      const reason = paymentResult.error || paymentResult.message || paymentResult.detail;
      throw new Error(reason
        ? `Unable to start Pesapal payment: ${reason}`
        : `Unable to start Pesapal payment (HTTP ${paymentResponse.status}).`);
    }

    window.location.assign(paymentResult.redirectUrl);
  } catch (error) {
    console.error('Checkout error:', error);
    setStatus(await formatPaymentError(error), 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector('span:first-child').textContent = 'Continue to secure payment';
  }
}

async function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('orderId');
  if (!orderId || !params.get('status')) return;

  setStatus('Checking your payment with Pesapal...', 'pending');
  try {
    const orderToken = sessionStorage.getItem(`${ORDER_STATUS_TOKEN_KEY}:${orderId}`);
    if (!orderToken) throw new Error('This checkout session cannot authorize the order status check.');

    let result = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(`${PAYMENT_API_BASE}/api/orders/${encodeURIComponent(orderId)}/status`, {
        headers: { 'X-Order-Status-Token': orderToken }
      });
      result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Unable to verify payment status.');
      if (result.status === 'completed' || result.status === 'failed') break;
      setStatus('Your payment is still being confirmed. Keep this page open; your pickup QR will appear after confirmation.', 'pending');
      await new Promise(resolve => window.setTimeout(resolve, 3000));
    }

    if (result?.status === 'completed') {
      const qrResponse = await fetch(`${PAYMENT_API_BASE}/api/orders/${encodeURIComponent(orderId)}/pickup-qr`, {
        headers: { 'X-Order-Status-Token': orderToken }
      });
      const qrResult = await qrResponse.json().catch(() => ({}));
      if (!qrResponse.ok || !qrResult.success || !qrResult.qrCode) {
        throw new Error(qrResult.error || 'Payment is confirmed, but the pickup QR could not be generated.');
      }

      localStorage.removeItem(CART_STORAGE_KEY);
      sessionStorage.removeItem(`${ORDER_STATUS_TOKEN_KEY}:${orderId}`);
      pickupQrImage.src = qrResult.qrCode;
      pickupQrImage.alt = `Verified pickup QR code for order ${orderId}`;
      pickupOrderNumber.textContent = `Order #${orderId}`;
      pickupProof.hidden = false;
      setStatus(`Payment confirmed for order #${orderId}. Thank you for shopping with VENDORA.`, 'success');
    } else if (result?.status === 'failed') {
      setStatus(result.pesapalDescription || result.pesapalMessage || 'Payment was not completed. Your cart is still saved so you can try again.', 'error');
    } else {
      setStatus('Your payment is still being confirmed. You can safely check your order status shortly.', 'pending');
    }
  } catch (error) {
    console.error('Payment return verification error:', error);
    setStatus('We could not verify the payment yet. Your cart has been kept safe.', 'error');
  } finally {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

function setStatus(message, kind) {
  statusMessage.textContent = message;
  statusMessage.className = `checkout-status${kind ? ` is-${kind}` : ''}`;
  statusMessage.hidden = !message;
}

async function formatPaymentError(error) {
  let responseMessage = '';
  if (error?.context instanceof Response) {
    try {
      const responseBody = await error.context.clone().json();
      responseMessage = String(responseBody?.error || '');
    } catch {
      responseMessage = '';
    }
  }

  const message = responseMessage || String(error?.message || error || '');
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('failed to fetch') || lowerMessage.includes('networkerror')) {
    return 'Could not connect to the payment service. Please try again in a moment.';
  }
  if (lowerMessage.includes('insufficient stock') || lowerMessage.includes('unavailable')) {
    return 'An item in your cart is no longer available in that quantity. Return to your cart and update it.';
  }
  if (lowerMessage.includes('amount_exceeds_default_limit') || lowerMessage.includes('amount exceeds limit')) {
    return 'This order exceeds the account transaction limit. Please use a smaller order or contact support.';
  }
  return message || 'Payment could not be started. Check your details and try again.';
}

function formatCurrency(amount) {
  return `UGX ${Number(amount).toLocaleString('en-UG')}`;
}