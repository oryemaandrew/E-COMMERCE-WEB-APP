import { supabase } from './supabase.js';
import { categoryLabel, categoryValue, renderCategoryFilters } from './categories.js';

document.addEventListener('DOMContentLoaded', async () => {
  const isSeparateLocalFrontend = !window.location.hostname
    || (['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port !== '5000');
  const paymentApiBase = isSeparateLocalFrontend ? 'http://localhost:5000' : '';
  let catalogProducts = [];
  let cart = [];
  let activeShift = null;
  let selectedPaymentMethod = 'Cash';

  // DOM Elements
  const loginForm = document.getElementById('cashier-login-form');
  const emailInput = document.getElementById('cashier-email');
  const passwordInput = document.getElementById('cashier-password');
  const passwordToggle = document.querySelector('[data-password-target="cashier-password"]');
  const closeCashierAuthBtn = document.getElementById('closeCashierAuthBtn');
  const authOverlay = document.getElementById('cashier-auth-overlay');
  const posInterface = document.getElementById('pos-interface');
  const barcodeInput = document.getElementById('barcode-input');
  const productGrid = document.getElementById('pos-product-grid');
  const ticketItemsContainer = document.getElementById('ticket-items');
  const subtotalEl = document.getElementById('pos-subtotal');
  const totalEl = document.getElementById('pos-total');
  const clearCartBtn = document.getElementById('clear-ticket-btn');
  const payNowBtn = document.getElementById('pay-now-btn');
  renderCategoryFilters(document.getElementById('pos-category-filters'));
  const categoryBtns = document.querySelectorAll('.filter-btn');
  const paymentBtns = document.querySelectorAll('.pay-btn');
  const cashPaymentFields = document.getElementById('cash-payment-fields');
  const customerPaymentFields = document.getElementById('customer-payment-fields');
  const cashReceivedInput = document.getElementById('cash-received');
  const customerPhoneInput = document.getElementById('customer-phone');
  const changeDueEl = document.getElementById('change-due');
  const openQrScannerBtn = document.getElementById('open-qr-scanner');
  const closeQrScannerBtn = document.getElementById('close-qr-scanner');
  const qrScannerModal = document.getElementById('qr-scanner-modal');
  const qrScannerVideo = document.getElementById('qr-scanner-video');
  const qrScannerStatus = document.getElementById('qr-scanner-status');
  let qrStream = null;
  let qrScanFrame = null;
  const receiptModal = document.getElementById('receipt-modal');
  const receiptMeta = document.getElementById('receipt-meta');
  const receiptContent = document.getElementById('receipt-content');
  const closeReceiptBtn = document.getElementById('close-receipt');
  const closeReceiptSecondaryBtn = document.getElementById('close-receipt-secondary');
  const printReceiptBtn = document.getElementById('print-receipt');
  const notificationsBtn = document.getElementById('pos-notifications-btn');
  const notificationsPanel = document.getElementById('pos-notifications-panel');
  const notificationCount = document.getElementById('pos-notification-count');
  const notificationList = document.getElementById('pos-notification-list');
  const clearNotificationsBtn = document.getElementById('clear-pos-notifications');
  const customerRequestCount = document.getElementById('cashier-request-count');
  const notificationsStorageKey = 'aura_pos_sale_notifications';
  const customerRequestsStorageKey = 'aura_customer_requests';
  let saleNotifications = loadSaleNotifications();
  let notificationsRead = false;
  let knownRequestCount = 0;

  passwordToggle?.addEventListener('click', () => {
    const isVisible = passwordInput.type === 'text';
    passwordInput.type = isVisible ? 'password' : 'text';
    passwordToggle.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
    passwordToggle.setAttribute('aria-pressed', String(!isVisible));
  });

  closeCashierAuthBtn?.addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  async function loadCustomerRequests() {
    try {
      const { data, error } = await supabase
        .from('customer_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return Array.isArray(data) ? data : [];
    } catch {
      try {
        const stored = JSON.parse(localStorage.getItem(customerRequestsStorageKey) || '[]');
        return Array.isArray(stored) ? stored : [];
      } catch {
        return [];
      }
    }
  }

  function saveCustomerRequests(requests) {
    localStorage.setItem(customerRequestsStorageKey, JSON.stringify(requests));
  }

  async function renderCustomerRequests() {
    const requestList = document.getElementById('cashier-request-list');
    const requestCount = document.getElementById('cashier-request-count');
    if (!requestList || !requestCount) return;

    const requests = await loadCustomerRequests();
    requestCount.textContent = String(requests.length);
    if (requests.length > knownRequestCount) notificationsRead = false;
    knownRequestCount = requests.length;
    updateNotificationBadge(requests.length);

    if (!activeShift) {
      requestList.innerHTML = '<p class="pos-empty-state">Log in to receive online customer requests.</p>';
      return;
    }

    if (!requests.length) {
      requestList.innerHTML = '<p class="pos-empty-state">No online customer requests yet.</p>';
      return;
    }

    requestList.innerHTML = requests.map(request => `
      <article class="pos-request-item">
        <div class="request-header">
          <strong>${escapeReceiptText(request.customer_name || request.customerName || 'Customer')}</strong>
          <span class="request-badge">${request.status || 'pending'}</span>
        </div>
        <p>${escapeReceiptText(request.item_name || request.itemName || request.request || 'Request details unavailable')}</p>
        <small>Phone: ${escapeReceiptText(request.phone || 'Not provided')} · Source: ${escapeReceiptText(request.source || 'online')}</small>
        <div class="request-actions">
          <button type="button" class="receive-request-btn" data-request-id="${request.id}" ${request.status === 'received' ? 'disabled' : ''}>${request.status === 'received' ? 'Received' : 'Receive'}</button>
        </div>
      </article>
    `).join('');

    requestList.querySelectorAll('.receive-request-btn').forEach(button => {
      button.addEventListener('click', async () => {
        const requestId = Number(button.dataset.requestId);
        const receivedAt = new Date().toISOString();
        const { error } = await supabase
          .from('customer_requests')
          .update({
            status: 'received',
            assigned_cashier: activeShift?.name || 'Cashier',
            received_at: receivedAt
          })
          .eq('id', requestId);

        if (error) {
          const stored = await loadCustomerRequests();
          const nextRequests = stored.map(request => Number(request.id) === requestId
            ? { ...request, status: 'received', assignedCashier: activeShift?.name || 'Cashier', receivedAt }
            : request);
          saveCustomerRequests(nextRequests);
        }

        await renderCustomerRequests();
        alert(`Customer request assigned to ${activeShift?.name || 'cashier'} for processing.`);
      });
    });
  }

  renderSaleNotifications();
  renderCustomerRequests();
  window.setInterval(() => {
    if (activeShift) renderCustomerRequests();
  }, 5000);

  notificationsBtn?.addEventListener('click', () => {
    const isOpen = !notificationsPanel?.classList.contains('hidden');
    notificationsPanel?.classList.toggle('hidden', isOpen);
    notificationsBtn.setAttribute('aria-expanded', String(!isOpen));
    if (!isOpen) {
      notificationsRead = true;
      notificationCount?.classList.add('hidden');
    }
  });

  clearNotificationsBtn?.addEventListener('click', () => {
    saleNotifications = [];
    saveSaleNotifications();
    renderSaleNotifications();
  });

  function loadSaleNotifications() {
    try {
      const stored = JSON.parse(localStorage.getItem(notificationsStorageKey) || '[]');
      return Array.isArray(stored) ? stored.slice(0, 20) : [];
    } catch {
      return [];
    }
  }

  function saveSaleNotifications() {
    localStorage.setItem(notificationsStorageKey, JSON.stringify(saleNotifications));
  }

  function updateNotificationBadge(requestCount = Number(customerRequestCount?.textContent || 0)) {
    const totalCount = saleNotifications.length + requestCount;
    notificationCount?.classList.toggle('hidden', totalCount === 0 || notificationsRead);
    if (notificationCount) notificationCount.textContent = String(Math.min(totalCount, 9));
  }

  function renderSaleNotifications() {
    if (!notificationList) return;

    updateNotificationBadge();

    if (saleNotifications.length === 0) {
      notificationList.innerHTML = '<p class="pos-notification-empty">No completed sales yet.</p>';
      return;
    }

    notificationList.innerHTML = saleNotifications.map(notification => `
      <article class="pos-notification-item">
        <span class="pos-notification-status" aria-hidden="true"></span>
        <div>
          <strong>Sale completed</strong>
          <p>${notification.paymentMethod} &middot; UGX ${Number(notification.amount).toLocaleString()}</p>
          <time datetime="${notification.timestamp}">${formatNotificationTime(notification.timestamp)}</time>
        </div>
      </article>
    `).join('');
  }

  function formatNotificationTime(timestamp) {
    return new Date(timestamp).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function addSaleNotification(orderId, amount, paymentMethod) {
    notificationsRead = false;
    saleNotifications.unshift({
      orderId: orderId || null,
      amount,
      paymentMethod,
      timestamp: new Date().toISOString()
    });
    saleNotifications = saleNotifications.slice(0, 20);
    saveSaleNotifications();
    renderSaleNotifications();
  }

  // Calculator Elements
  const calcModal = document.getElementById('calc-modal');
  const calcScreen = document.getElementById('calc-screen');
  const closeCalcBtn = document.getElementById('close-calc-btn');

  // 1. Load inventory from Supabase
  async function initializeData() {
    try {
      const { data: products, error: pErr } = await supabase
        .from('products')
        .select('*');

      if (!pErr && products) {
        catalogProducts = products;
        renderProducts(catalogProducts);
      }
    } catch (err) {
      console.error("Initialization Error:", err);
      if (loginForm) {
        const status = document.querySelector('.cashier-service-error') || document.createElement('p');
        status.className = 'cashier-service-error';
        status.setAttribute('role', 'alert');
        status.textContent = 'Unable to load products. Check the Supabase connection.';
        if (!status.parentElement) loginForm.appendChild(status);
      }
    }
  }

  await initializeData();

  // 2. Render Products Grid
  function renderProducts(items) {
  if (!productGrid) return;
  productGrid.innerHTML = '';

  if (!items.length) {
    productGrid.innerHTML = '<p class="pos-empty-state">No products found.</p>';
    return;
  }

  items.forEach(prod => {
    // Standardize title/name field dynamically
    const itemName = prod.name || prod.product_name || prod.title || 'Unnamed Item';
    const itemPrice = Number(prod.price || prod.unit_price || 0);
    const imageUrl = prod.image_url || prod.image || '';

    const card = document.createElement('div');
    card.className = 'pos-item-card';
    card.innerHTML = `
      ${imageUrl
        ? `<img src="${imageUrl}" alt="${itemName}" class="pos-item-image" loading="lazy" />`
        : '<div class="pos-item-image pos-item-image-placeholder" role="img" aria-label="Product image unavailable">No image</div>'}
      <div class="pos-item-details">
      <span class="pos-item-name">${itemName}</span>
      <span class="pos-item-category">${categoryLabel(prod.category_slug || prod.category)}</span>
      <span class="pos-item-price">UGX ${itemPrice.toLocaleString()}</span>
      <span class="pos-item-stock">Stock: ${prod.stock_quantity ?? prod.stock ?? 'N/A'}</span>
      </div>
    `;
    card.addEventListener('click', () => addToCart({ ...prod, name: itemName, price: itemPrice }));
    productGrid.appendChild(card);
  });
}

  // 3. Cart Logic
  function addToCart(product) {
    const existing = cart.find(i => i.id === product.id);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ ...product, qty: 1 });
    }
    updateCartUI();
  }

  function updateQty(id, delta) {
    const item = cart.find(i => i.id === id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
      cart = cart.filter(i => i.id !== id);
    }
    updateCartUI();
  }

  function updateCartUI() {
    ticketItemsContainer.innerHTML = '';
    let total = 0;

    if (!cart.length) {
      ticketItemsContainer.innerHTML = '<p class="pos-empty-state">No items added yet.</p>';
    }

    cart.forEach(item => {
      const itemTotal = item.price * item.qty;
      total += itemTotal;

      const row = document.createElement('div');
      row.className = 'ticket-item';
      row.innerHTML = `
        <div class="ticket-item-info">
          <strong>${item.name}</strong>
          <span>UGX ${Number(item.price).toLocaleString()} each</span>
        </div>
        <div class="ticket-qty-controls">
          <button type="button" class="btn-minus">-</button>
          <span>${item.qty}</span>
          <button type="button" class="btn-plus">+</button>
        </div>
        <span class="ticket-item-total">UGX ${Number(itemTotal).toLocaleString()}</span>
      `;

      row.querySelector('.btn-minus').addEventListener('click', () => updateQty(item.id, -1));
      row.querySelector('.btn-plus').addEventListener('click', () => updateQty(item.id, 1));

      ticketItemsContainer.appendChild(row);
    });

    const formattedTotal = `UGX ${total.toLocaleString()}`;
    if (subtotalEl) subtotalEl.textContent = formattedTotal;
    if (totalEl) totalEl.textContent = formattedTotal;
    updateChangeDue();
  }

  function updateChangeDue() {
    const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const received = Number(cashReceivedInput?.value || 0);
    const change = Math.max(received - total, 0);
    if (changeDueEl) changeDueEl.textContent = `UGX ${change.toLocaleString()}`;
  }

  // 4. Category Filtering
  categoryBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      categoryBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.getAttribute('data-category');

      if (!cat || cat === 'all') {
        renderProducts(catalogProducts);
      } else {
        const filtered = catalogProducts.filter(p =>
          categoryValue(p.category || p.category_slug) === cat.toLowerCase()
        );
        renderProducts(filtered);
      }
    });
  });

  // 5. Payment Selection
  paymentBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      paymentBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPaymentMethod = btn.getAttribute('data-method');
      cashPaymentFields?.classList.toggle('hidden', selectedPaymentMethod !== 'Cash');
      customerPaymentFields?.classList.toggle('hidden', selectedPaymentMethod === 'Cash');
      if (selectedPaymentMethod !== 'Cash' && cashReceivedInput) cashReceivedInput.value = '';
      updateChangeDue();
    });
  });

  cashReceivedInput?.addEventListener('input', updateChangeDue);

  openQrScannerBtn?.addEventListener('click', startQrScanner);
  closeQrScannerBtn?.addEventListener('click', closeQrScanner);
  qrScannerModal?.addEventListener('click', event => {
    if (event.target === qrScannerModal) closeQrScanner();
  });

  closeReceiptBtn?.addEventListener('click', closeReceipt);
  closeReceiptSecondaryBtn?.addEventListener('click', closeReceipt);
  printReceiptBtn?.addEventListener('click', () => window.print());

  function closeReceipt() {
    receiptModal?.classList.add('hidden');
    receiptModal?.setAttribute('aria-hidden', 'true');
  }

  function showReceipt(order, items, total, paymentMethod, cashReceived) {
    if (!receiptModal || !receiptContent) return;

    const orderNumber = order?.id || 'Pending';
    const timestamp = new Date();
    const change = paymentMethod === 'Cash' ? Math.max(cashReceived - total, 0) : 0;
    receiptMeta.textContent = `Order #${orderNumber} · ${timestamp.toLocaleString()}`;
    receiptContent.innerHTML = `
      <div class="receipt-line-items">
        ${items.map(item => `
          <div class="receipt-line">
            <span>${escapeReceiptText(item.name)} × ${item.qty}</span>
            <strong>UGX ${(item.price * item.qty).toLocaleString()}</strong>
          </div>
        `).join('')}
      </div>
      <div class="receipt-total-row"><span>Total</span><strong>UGX ${total.toLocaleString()}</strong></div>
      <div class="receipt-detail-row"><span>Payment method</span><span>${escapeReceiptText(paymentMethod)}</span></div>
      ${paymentMethod === 'Cash' ? `<div class="receipt-detail-row"><span>Change</span><span>UGX ${change.toLocaleString()}</span></div>` : ''}
    `;
    receiptModal.classList.remove('hidden');
    receiptModal.setAttribute('aria-hidden', 'false');
  }

  function escapeReceiptText(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[character]));
  }

  async function startQrScanner() {
    if (!qrScannerModal || !qrScannerVideo) return;

    qrScannerModal.classList.remove('hidden');
    qrScannerModal.setAttribute('aria-hidden', 'false');
    setQrScannerStatus('Starting camera...');

    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
      setQrScannerStatus('Camera scanning is not supported here. Use the search field with a USB scanner.');
      return;
    }

    try {
      const detector = new BarcodeDetector({
        formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e']
      });
      qrStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      qrScannerVideo.srcObject = qrStream;
      await qrScannerVideo.play();
      setQrScannerStatus('Point the camera at a product code.');
      scanFrame(detector);
    } catch (error) {
      console.error('QR scanner error:', error);
      setQrScannerStatus('Camera access was unavailable. Use the search field with a USB scanner.');
    }
  }

  async function scanFrame(detector) {
    if (!qrStream || !qrScannerVideo || qrScannerVideo.readyState < 2) {
      qrScanFrame = requestAnimationFrame(() => scanFrame(detector));
      return;
    }

    try {
      const codes = await detector.detect(qrScannerVideo);
      if (codes.length > 0 && processScannedValue(codes[0].rawValue)) return;
    } catch (error) {
      console.warn('Unable to read camera frame:', error);
    }

    qrScanFrame = requestAnimationFrame(() => scanFrame(detector));
  }

  function closeQrScanner() {
    if (qrScanFrame) cancelAnimationFrame(qrScanFrame);
    qrScanFrame = null;
    qrStream?.getTracks().forEach(track => track.stop());
    qrStream = null;
    if (qrScannerVideo) qrScannerVideo.srcObject = null;
    qrScannerModal?.classList.add('hidden');
    qrScannerModal?.setAttribute('aria-hidden', 'true');
  }

  function setQrScannerStatus(message) {
    if (qrScannerStatus) qrScannerStatus.textContent = message;
  }

  function processScannedValue(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return false;

    let lookupValue = value;
    let requestedQuantity = 1;
    try {
      const payload = JSON.parse(value);
      lookupValue = payload.barcode || payload.sku || payload.code || payload.product_id || payload.id || value;
      requestedQuantity = Math.min(Math.max(Number(payload.quantity) || 1, 1), 50);
    } catch {
      try {
        const params = new URL(value).searchParams;
        lookupValue = params.get('barcode') || params.get('sku') || params.get('product') || value;
      } catch {
        // Treat non-JSON, non-URL scanner content as a normal catalog code.
      }
    }

    const normalizedValue = String(lookupValue).toLowerCase();
    const match = catalogProducts.find(product => [
      product.id,
      product.barcode,
      product.sku,
      product.code,
      product.name,
      product.product_name,
      product.title
    ].some(field => String(field ?? '').toLowerCase() === normalizedValue));

    if (!match) {
      setQrScannerStatus('Product not found. Try another code or use the search field.');
      return false;
    }

    const productName = match.name || match.product_name || match.title || 'Unnamed Item';
    const product = { ...match, name: productName, price: Number(match.price || match.unit_price || 0) };
    for (let index = 0; index < requestedQuantity; index += 1) addToCart(product);
    barcodeInput.value = '';
    closeQrScanner();
    return true;
  }

  // 6. Barcode Scanner / Enter Action
  barcodeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!processScannedValue(barcodeInput.value)) {
        alert("Item not found.");
      }
    }
  });

  // Clear Cart Button
  clearCartBtn?.addEventListener('click', () => {
    cart = [];
    updateCartUI();
  });

  // 7. Complete Sale Button
  async function waitForPesapalPayment(order, saleItems, total) {
    const { data: sessionData } = await supabase.auth.getSession();
    const statusHeaders = sessionData?.session?.access_token
      ? { Authorization: `Bearer ${sessionData.session.access_token}` }
      : {};

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const response = await fetch(`${paymentApiBase}/api/orders/${encodeURIComponent(order.id)}/status`, {
        headers: statusHeaders
      });
      if (!response.ok) continue;

      const currentOrder = await response.json();
      if (currentOrder.status === 'completed') {
        addSaleNotification(order.id, total, currentOrder.payment_method || 'Pesapal');
        showReceipt(currentOrder, saleItems, total, currentOrder.payment_method || 'Pesapal', 0);
        alert(`Sale #${order.id} completed successfully (Pesapal).`);
        cart = [];
        updateCartUI();
        if (customerPhoneInput) customerPhoneInput.value = '';
        return;
      }
      if (currentOrder.status === 'failed') {
        throw new Error('Pesapal payment was not completed.');
      }
    }
    throw new Error('Timed out waiting for Pesapal payment confirmation.');
  }

  async function completeSale() {
  if (cart.length === 0) {
    alert("Cart is empty!");
    return;
  }

  const grandTotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const cashReceived = Number(cashReceivedInput?.value || 0);
  const saleItems = cart.map(item => ({ ...item }));

  if (selectedPaymentMethod === 'Cash' && cashReceived < grandTotal) {
    alert(`Cash received is short by UGX ${(grandTotal - cashReceived).toLocaleString()}.`);
    cashReceivedInput?.focus();
    return;
  }

  payNowBtn.disabled = true;
  payNowBtn.textContent = 'Processing sale...';

  try {
    const isCashSale = selectedPaymentMethod === 'Cash';
    if (!isCashSale && !customerPhoneInput?.value.trim()) {
      alert('Enter the customer phone number before starting a digital payment.');
      customerPhoneInput?.focus();
      return;
    }

    // 1. Insert Main Order Record
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert([{
        shift_id: activeShift?.shiftId || null,
        cashier_id: activeShift?.cashierId || null,
        total_amount: grandTotal,
        payment_method: selectedPaymentMethod,
        status: isCashSale ? 'completed' : 'pending',
        customer_phone: customerPhoneInput?.value.trim() || null
      }])
      .select()
      .single();

    if (orderErr) throw orderErr;

    // 2. Prepare & Insert Line Items for Receipt Tracking
    const orderItemsPayload = cart.map(item => ({
      order_id: order.id,
      product_id: item.id,
      product_name: item.name,
      unit_price: item.price,
      quantity: item.qty,
      subtotal: item.price * item.qty
    }));

    const { error: itemsErr } = await supabase
      .from('order_items')
      .insert(orderItemsPayload);

    if (itemsErr) throw itemsErr;

    if (!isCashSale) {
      const checkoutWindow = window.open('', '_blank');
      const response = await fetch(`${paymentApiBase}/api/payments/pesapal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: grandTotal,
          phoneNumber: customerPhoneInput.value.trim(),
          orderId: order.id
        })
      });
      const payment = await response.json();
      if (!response.ok || !payment.success || !payment.redirectUrl) {
        checkoutWindow?.close();
        throw new Error(payment.error || 'Unable to start Pesapal payment.');
      }
      if (checkoutWindow) {
        checkoutWindow.location.href = payment.redirectUrl;
      } else {
        window.open(payment.redirectUrl, '_blank');
      }
      await waitForPesapalPayment(order, saleItems, grandTotal);
      return;
    }

    addSaleNotification(order?.id, grandTotal, selectedPaymentMethod);
    showReceipt(order, saleItems, grandTotal, selectedPaymentMethod, cashReceived);
    alert(`Sale #${order.id} completed successfully (${selectedPaymentMethod}).`);
    // Clear Cart & Reset UI
    cart = [];
    updateCartUI();
    if (cashReceivedInput) cashReceivedInput.value = '';
    if (customerPhoneInput) customerPhoneInput.value = '';

  } catch (err) {
    console.error("Sale transaction error:", err);
    alert("Transaction failed: " + err.message);
  } finally {
    payNowBtn.disabled = false;
    payNowBtn.textContent = 'Complete Sale (Enter)';
  }
  }

  payNowBtn?.addEventListener('click', completeSale);
  cashReceivedInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      completeSale();
    }
  });

  // 8. Shift Authentication Handler
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const openingFloat = document.getElementById('starting-float').value || 0;
    let session = null;

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError || !authData.session) {
        throw new Error(authError?.message || 'Invalid cashier email or password.');
      }
      session = authData.session;

      const response = await fetch(`${paymentApiBase}/api/cashier/auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ openingFloat: Number(openingFloat) })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Invalid cashier credentials.');

      const activeOpeningFloat = Number(result.shift.opening_float ?? openingFloat);
      activeShift = { shiftId: result.shift.id, cashierId: result.cashier.id, name: result.cashier.full_name, openingFloat: activeOpeningFloat };
      document.getElementById('starting-float').value = activeOpeningFloat;

      document.getElementById('active-cashier-name').textContent = result.cashier.full_name;
      document.getElementById('display-float').textContent = activeOpeningFloat.toLocaleString();

      authOverlay.classList.add('hidden');
      posInterface.classList.remove('hidden');
      renderCustomerRequests();
      barcodeInput.focus();

    } catch (err) {
      const message = err instanceof TypeError && err.message === 'Failed to fetch'
        ? 'Cannot connect to the cashier service. Start the backend with "node server.js", then try again.'
        : err.message;
      if (session) await supabase.auth.signOut();
      alert(message);
      passwordInput.value = '';
    }
  });

  // 9. Quick Calculator Logic & Keyboard Shortcut (F2 key toggles calculator)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F2') {
      e.preventDefault();
      calcModal.classList.toggle('hidden');
    }
  });

  closeCalcBtn?.addEventListener('click', () => calcModal.classList.add('hidden'));

  document.querySelectorAll('.calc-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-val');

      if (val === 'C') {
        calcScreen.value = '0';
      } else if (val === 'DEL') {
        calcScreen.value = calcScreen.value.slice(0, -1) || '0';
      } else if (val === '=') {
        try {
          calcScreen.value = eval(calcScreen.value);
        } catch {
          calcScreen.value = 'Error';
        }
      } else {
        if (calcScreen.value === '0' || calcScreen.value === 'Error') {
          calcScreen.value = val;
        } else {
          calcScreen.value += val;
        }
      }
    });
  });

  // Lock Terminal Button
  document.getElementById('lock-terminal-btn')?.addEventListener('click', async () => {
    posInterface.classList.add('hidden');
    authOverlay.classList.remove('hidden');
    renderCustomerRequests();
    passwordInput.value = '';
    await supabase.auth.signOut();
  });

  // DOM Elements for Shift Closure
const closeShiftBtn = document.getElementById('close-shift-btn');
const closeShiftModal = document.getElementById('close-shift-modal');
const cancelEndShiftBtn = document.getElementById('cancel-end-shift-btn');
const confirmEndShiftBtn = document.getElementById('confirm-end-shift-btn');

// 1. Open End Shift Modal & Compute Totals
closeShiftBtn?.addEventListener('click', async () => {
  if (!activeShift?.shiftId) {
    alert("No active shift found!");
    return;
  }

  try {
    // Fetch total sales completed during this specific shift
    const { data: orders, error } = await supabase
      .from('orders')
      .select('total_amount, payment_method')
      .eq('shift_id', activeShift.shiftId)
      .eq('status', 'completed');

    if (error) throw error;

    const shiftSales = orders
      .filter(order => order.payment_method === 'Cash')
      .reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
    const openingFloat = Number(document.getElementById('starting-float').value || 0);
    const expectedDrawerTotal = openingFloat + shiftSales;

    // Populate modal text
    document.getElementById('shift-modal-float').textContent = `UGX ${openingFloat.toLocaleString()}`;
    document.getElementById('shift-modal-sales').textContent = `UGX ${shiftSales.toLocaleString()}`;
    document.getElementById('shift-modal-total').textContent = `UGX ${expectedDrawerTotal.toLocaleString()}`;

    // Show reconciliation modal
    closeShiftModal.classList.remove('hidden');

  } catch (err) {
    console.error("Error calculating shift summary:", err);
    alert("Unable to compile shift summary: " + err.message);
  }
});

// 2. Cancel / Resume Shift
cancelEndShiftBtn?.addEventListener('click', () => {
  closeShiftModal.classList.add('hidden');
});

// 3. Confirm & Close Shift in Supabase
confirmEndShiftBtn?.addEventListener('click', async () => {
  try {
    if (activeShift?.shiftId) {
      // Calculate final expected drawer total
      const { data: orders } = await supabase
        .from('orders')
        .select('total_amount, payment_method')
        .eq('shift_id', activeShift.shiftId)
        .eq('status', 'completed');

      const shiftSales = (orders || [])
        .filter(order => order.payment_method === 'Cash')
        .reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
      const openingFloat = Number(document.getElementById('starting-float').value || 0);
      const closingFloat = openingFloat + shiftSales;

      // Update shift status, closing timestamp, and total cash in Supabase
      const { error } = await supabase
        .from('cashier_shifts')
        .update({
          status: 'closed',
          ended_at: new Date().toISOString(),
          closing_float: closingFloat
        })
        .eq('id', activeShift.shiftId);

      if (error) throw error;
    }

    // Reset session variables & lock interface
    activeShift = null;
    cart = [];
    updateCartUI();

    closeShiftModal.classList.add('hidden');
    posInterface.classList.add('hidden');
    authOverlay.classList.remove('hidden');
    passwordInput.value = '';
    await supabase.auth.signOut();
    
    alert("Shift closed successfully. Register locked.");

  } catch (err) {
    console.error("Error closing shift:", err);
    alert("Failed to close shift: " + err.message);
  }
});
});