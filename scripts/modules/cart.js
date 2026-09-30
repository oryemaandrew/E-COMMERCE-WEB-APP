// scripts/modules/cart.js
import { products } from './products.js';
import { supabase } from './supabase.js';

const CART_STORAGE_KEY = 'vendora_cart_items';
const ORDER_STATUS_TOKEN_KEY = 'vendora_order_status_token';
const PAYMENT_API_BASE = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  && window.location.port !== '5000'
  ? 'http://localhost:5000'
  : '';

let cart = loadCart();

function loadCart() {
  try {
    const storedCart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
    return Array.isArray(storedCart) ? storedCart.filter(item => item && item.id != null) : [];
  } catch (error) {
    console.warn('Saved cart data was invalid and has been reset.');
    localStorage.removeItem(CART_STORAGE_KEY);
    return [];
  }
}

export function initCart() {
  const cartBtn = document.getElementById('cartBtn');
  const closeCartBtn = document.getElementById('closeCartBtn');
  const cartOverlay = document.getElementById('cartOverlay');
  const productContainer = document.getElementById('product-container');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const closeCheckoutBtn = document.getElementById('closeCheckoutBtn');
  const checkoutOverlay = document.getElementById('checkoutOverlay');
  const checkoutForm = document.getElementById('checkoutForm');
  const checkoutTotal = document.getElementById('checkoutTotal');
  const checkoutStatus = document.getElementById('checkoutStatus');
  const cartStatus = document.getElementById('cartStatus');
  const authorizePaymentBtn = document.getElementById('authorizePaymentBtn');
  const backToDashboardBtn = document.getElementById('backToDashboardBtn');

  if (productContainer) {
    productContainer.addEventListener('click', (e) => {
      const addBtn = e.target.closest('.add-to-cart-btn');
      if (addBtn) {
        const id = addBtn.dataset.id;
        addToCart(id);
      }
    });
  }

  if (cartBtn) cartBtn.addEventListener('click', openCart);
  if (closeCartBtn) closeCartBtn.addEventListener('click', closeCart);
  if (cartOverlay) {
    cartOverlay.addEventListener('click', (e) => {
      if (e.target === cartOverlay) closeCart();
    });
  }
  checkoutBtn?.addEventListener('click', openCheckout);
  backToDashboardBtn?.addEventListener('click', () => {
    closeCart();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  closeCheckoutBtn?.addEventListener('click', closeCheckout);
  checkoutOverlay?.addEventListener('click', (event) => {
    if (event.target === checkoutOverlay) closeCheckout();
  });
  checkoutForm?.addEventListener('submit', submitCheckout);

  const cartDrawer = document.getElementById('cartDrawer');
  if (cartDrawer) {
    cartDrawer.addEventListener('click', (e) => {
      const id = e.target.dataset.id;
      if (e.target.classList.contains('qty-inc')) updateQuantity(id, 1);
      if (e.target.classList.contains('qty-dec')) updateQuantity(id, -1);
      if (e.target.classList.contains('remove-item')) removeFromCart(id);
    });
  }

  updateCartUI();
  void handlePaymentReturn();

  function openCheckout() {
    if (!cart.length) {
      closeCart();
      window.location.href = 'checkout.html';
      return;
    }
    closeCart();
    window.location.href = 'checkout.html';
  }

  function closeCheckout() {
    if (checkoutOverlay) checkoutOverlay.hidden = true;
  }

  async function handlePaymentReturn() {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('orderId');
    const paymentStatus = params.get('status');
    if (!orderId || !paymentStatus) return;
    const orderStatusToken = sessionStorage.getItem(`${ORDER_STATUS_TOKEN_KEY}:${orderId}`);

    if (checkoutStatus) {
      checkoutStatus.textContent = 'Verifying your Pesapal payment...';
      checkoutStatus.hidden = false;
    }

    try {
      const response = await fetch(`${PAYMENT_API_BASE}/api/orders/${encodeURIComponent(orderId)}/status`, {
        headers: orderStatusToken ? { 'X-Order-Status-Token': orderStatusToken } : {}
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Unable to verify payment status.');

      if (result.status === 'completed') {
        cart = [];
        saveAndRender();
        if (checkoutStatus) checkoutStatus.textContent = `Payment confirmed for order #${orderId}. Thank you for your purchase.`;
      } else if (result.status === 'failed') {
        const providerReason = result.pesapalDescription || result.pesapalMessage;
        if (checkoutStatus) {
          checkoutStatus.textContent = providerReason
            ? `Pesapal declined the payment: ${providerReason}. Check the phone prompt and available balance, then retry.`
            : 'Pesapal reported that the payment failed, but did not provide a specific reason. Check the phone prompt and available balance, then retry.';
        }
      } else {
        if (checkoutStatus) checkoutStatus.textContent = 'Payment is still being confirmed. Please check your order status shortly.';
      }
      if (checkoutOverlay) checkoutOverlay.hidden = false;
    } catch (error) {
      console.error('Payment return verification error:', error);
      if (checkoutStatus) checkoutStatus.textContent = 'We could not verify the payment yet. Your cart has been kept safe.';
      if (checkoutOverlay) checkoutOverlay.hidden = false;
    } finally {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  async function submitCheckout(event) {
    event.preventDefault();
    if (!cart.length || !checkoutForm) return;

    const formData = new FormData(checkoutForm);
    const customerName = String(formData.get('customerName') || '').trim();
    const phone = String(formData.get('phone') || '').trim();
    const email = String(formData.get('email') || '').trim() || 'customer@vendorastore.com';
    if (authorizePaymentBtn) {
      authorizePaymentBtn.disabled = true;
      authorizePaymentBtn.textContent = 'Starting payment...';
    }
    if (checkoutStatus) checkoutStatus.hidden = true;

    try {
      const { data: sessionData } = await supabase.auth.getSession();

      // The server reads product prices and creates the order from IDs and quantities.
      const session = sessionData?.session;
      const checkoutResponse = await fetch(`${PAYMENT_API_BASE}/api/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify({
          items: cart.map(item => ({ productId: String(item.id), quantity: item.quantity })),
          customerName,
          phone,
          email
        })
      });
      const checkoutResult = await checkoutResponse.json().catch(() => ({}));
      if (!checkoutResponse.ok || !checkoutResult.success || !checkoutResult.order?.id) {
        throw new Error(checkoutResult.error || `Unable to create checkout order (HTTP ${checkoutResponse.status}).`);
      }
      sessionStorage.setItem(`${ORDER_STATUS_TOKEN_KEY}:${checkoutResult.order.id}`, checkoutResult.orderStatusToken);

      // Start Pesapal checkout through the server so credentials and totals stay private.
      const response = await fetch(`${PAYMENT_API_BASE}/api/payments/pesapal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: checkoutResult.order.id,
          orderToken: checkoutResult.orderStatusToken,
          phoneNumber: phone,
          email,
          source: 'storefront'
        })
      });
      const paymentResult = await response.json().catch(() => ({}));
      if (!response.ok || !paymentResult.success || !paymentResult.redirectUrl) {
        const providerMessage = paymentResult.error || paymentResult.message || paymentResult.detail;
        throw new Error(providerMessage
          ? `Unable to start Pesapal payment: ${providerMessage} Check the payment backend configuration.`
          : `Unable to start Pesapal payment (HTTP ${response.status}).`);
      }

      window.location.href = paymentResult.redirectUrl;

    } catch (error) {
      console.error('Checkout error:', error);
      if (checkoutStatus) {
        checkoutStatus.textContent = await formatPaymentError(error);
        checkoutStatus.hidden = false;
      }
    } finally {
      if (authorizePaymentBtn) {
        authorizePaymentBtn.disabled = false;
        authorizePaymentBtn.textContent = 'Send payment prompt';
      }
    }
  }
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
    return 'Could not connect to payment backend. Ensure node server.js is running on port 5000.';
  }

  if (lowerMessage.includes('row-level security') || lowerMessage.includes('permission denied')) {
    return 'Database policy error. Apply the latest migration SQL in Supabase.';
  }

  if (lowerMessage.includes('insufficient stock') || lowerMessage.includes('unavailable')) {
    return 'This item is no longer available in the requested quantity. Please update your cart and try again.';
  }

  if (lowerMessage.includes('amount_exceeds_default_limit') || lowerMessage.includes('amount exceeds limit')) {
    return 'Pesapal rejected this payment because the order total exceeds the account transaction limit. Use a smaller order or ask the Pesapal account owner to increase the limit.';
  }

  return message || 'Payment initialization failed. Please check details and try again.';
}

function addToCart(productId) {
  const product = products.find(p => String(p.id) === String(productId));
  if (!product) return;

  const availableStock = getAvailableStock(product);
  const existingItem = cart.find(item => String(item.id) === String(productId));
  if (availableStock !== null && (!availableStock || (existingItem && existingItem.quantity >= availableStock))) {
    alert(`${product.name || product.title || 'This item'} is out of stock.`);
    return;
  }

  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    cart.push({ ...product, quantity: 1 });
  }

  saveAndRender();
  openCart();
}

function updateQuantity(productId, delta) {
  const item = cart.find(i => String(i.id) === String(productId));
  if (!item) return;

  const availableStock = getAvailableStock(item);
  if (delta > 0 && availableStock !== null && item.quantity >= availableStock) {
    alert(`${item.name || item.title || 'This item'} has only ${availableStock} available.`);
    return;
  }

  item.quantity += delta;
  if (item.quantity <= 0) {
    removeFromCart(productId);
  } else {
    saveAndRender();
  }
}

function removeFromCart(productId) {
  cart = cart.filter(item => String(item.id) !== String(productId));
  saveAndRender();
}

function saveAndRender() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  updateCartUI();
}

function openCart() {
  const drawer = document.getElementById('cartDrawer');
  const overlay = document.getElementById('cartOverlay');
  drawer?.classList.add('open', 'active');
  overlay?.classList.add('open', 'active');
}

function closeCart() {
  const drawer = document.getElementById('cartDrawer');
  const overlay = document.getElementById('cartOverlay');
  drawer?.classList.remove('open', 'active');
  overlay?.classList.remove('open', 'active');
}

function updateCartUI() {
  const badge = document.getElementById('cartBadge');
  const cartItemsContainer = document.getElementById('cartItems');
  const cartTotalEl = document.getElementById('cartTotal');

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  if (badge) badge.textContent = totalItems;

  const totalPrice = cart.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);
  if (cartTotalEl) cartTotalEl.textContent = formatCurrency(totalPrice);

  if (!cartItemsContainer) return;

  if (cart.length === 0) {
    cartItemsContainer.innerHTML = `<p style="text-align:center; color: var(--text-muted); margin-top: 2rem;">Your cart is empty.</p>`;
    return;
  }

  cartItemsContainer.innerHTML = cart.map(item => `
    <div class="cart-item" style="display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem;">
      ${item.image_url || item.image
        ? `<img src="${item.image_url || item.image}" alt="${item.name || item.title || 'Product'}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 6px;" />`
        : '<div aria-hidden="true" style="width: 50px; height: 50px; border-radius: 6px; background: var(--accent-soft);"></div>'}
      <div class="cart-item-details" style="flex: 1;">
        <h4 style="margin: 0; font-size: 0.95rem;">${item.name || item.title || 'Unnamed item'}</h4>
        <p class="price" style="margin: 0.2rem 0; font-size: 0.85rem; color: var(--text-muted);">${formatCurrency(Number(item.price))}</p>
        <div class="cart-item-qty" style="display: flex; gap: 0.5rem; align-items: center;">
          <button class="qty-dec" data-id="${item.id}">-</button>
          <span>${item.quantity}</span>
          <button class="qty-inc" data-id="${item.id}">+</button>
        </div>
      </div>
      <button class="remove-item" data-id="${item.id}" aria-label="Remove item" style="background: none; border: none; color: #ef4444; font-size: 1.2rem; cursor: pointer;">&times;</button>
    </div>
  `).join('');
}

export function toggleCart(isOpen) {
  const drawer = document.getElementById('cartDrawer');
  const overlay = document.getElementById('cartOverlay');

  if (isOpen) {
    drawer?.classList.add('open', 'active');
    overlay?.classList.add('open', 'active');
  } else {
    drawer?.classList.remove('open', 'active');
    overlay?.classList.remove('open', 'active');
  }
}

function getCartTotal() {
  return cart.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);
}

function formatCurrency(amount) {
  return `UGX ${Number(amount).toLocaleString('en-UG')}`;
}

function getAvailableStock(product) {
  const stock = Number(product.stock_quantity ?? product.stock);
  if (!Number.isFinite(stock)) return null;
  return Math.max(0, stock - Number(product.stock_reserved || 0));
}