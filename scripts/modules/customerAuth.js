import { supabase } from './supabase.js';

export function initCustomerAuth() {
  const authButton = document.getElementById('customerAuthBtn');
  const modal = document.getElementById('customerAuthModal');
  const closeButton = document.getElementById('closeCustomerAuthBtn');
  const form = document.getElementById('customerAuthForm');
  const title = document.getElementById('customerAuthTitle');
  const intro = document.getElementById('customerAuthIntro');
  const nameField = document.getElementById('customerAuthNameField');
  const nameInput = document.getElementById('customerAuthName');
  const emailInput = document.getElementById('customerAuthEmail');
  const passwordInput = document.getElementById('customerAuthPassword');
  const submitButton = document.getElementById('customerAuthSubmit');
  const switchButton = document.getElementById('customerAuthSwitch');
  const status = document.getElementById('customerAuthStatus');
  const passwordToggle = document.querySelector('[data-password-target="customerAuthPassword"]');
  const ordersButton = document.getElementById('customerOrdersBtn');
  const orderBadge = document.getElementById('customerOrderBadge');
  const ordersPanel = document.getElementById('customerOrdersPanel');
  const ordersList = document.getElementById('customerOrdersList');
  const ordersStatus = document.getElementById('customerOrdersStatus');
  const refreshOrdersButton = document.getElementById('refreshCustomerOrdersBtn');
  const closeOrdersButton = document.getElementById('closeCustomerOrdersBtn');
  let isSignUpMode = false;
  let currentSession = null;
  let orderSnapshot = new Map();
  let ordersInitialized = false;
  let ordersPanelOpen = false;

  if (!authButton || !modal || !form) return;

  const clearPassword = () => {
    passwordInput.value = '';
    passwordInput.type = 'password';
    passwordToggle?.setAttribute('aria-pressed', 'false');
    passwordToggle?.setAttribute('aria-label', 'Show password');
  };

  const setStatus = (message, isError = false) => {
    if (!status) return;
    status.textContent = message;
    status.style.display = message ? 'block' : 'none';
    status.style.color = isError ? '#b91c1c' : 'var(--text-muted)';
  };

  const getAuthErrorMessage = (error) => {
    if (error?.code === 'invalid_credentials') {
      return 'Email or password is incorrect. Check your details or create a customer account.';
    }
    if (error?.code === 'email_not_confirmed') {
      return 'Please confirm your email address before signing in.';
    }
    return error?.message || 'Unable to complete authentication.';
  };

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const setOrdersStatus = (message, isError = false) => {
    if (!ordersStatus) return;
    ordersStatus.textContent = message;
    ordersStatus.style.display = message ? 'block' : 'none';
    ordersStatus.style.color = isError ? '#b91c1c' : 'var(--text-muted)';
  };

  const renderCustomerOrders = async (announceChanges = false) => {
    if (!currentSession || !ordersPanel || !ordersList) return;

    ordersPanel.hidden = !ordersPanelOpen;
    setOrdersStatus('Loading your orders...');
    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, created_at, total_amount, payment_method, status')
      .eq('customer_id', currentSession.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      setOrdersStatus('Order history is temporarily unavailable. Please try again.', true);
      return;
    }

    const nextSnapshot = new Map((orders || []).map(order => [String(order.id), order.status]));
    const changedCount = ordersInitialized
      ? (orders || []).filter(order => orderSnapshot.get(String(order.id)) !== order.status).length
      : 0;
    orderSnapshot = nextSnapshot;
    ordersInitialized = true;

    if (changedCount > 0 && announceChanges) {
      setOrdersStatus(`${changedCount} order update${changedCount === 1 ? '' : 's'} available.`);
      if (orderBadge) {
        orderBadge.hidden = false;
        orderBadge.textContent = String(Math.min(changedCount, 9));
      }
    } else if (!ordersStatus?.textContent.includes('update')) {
      setOrdersStatus('');
    }

    if (!orders?.length) {
      ordersList.innerHTML = '<p class="customer-orders-empty">No orders yet. Your completed purchases will appear here.</p>';
      return;
    }

    ordersList.innerHTML = orders.map(order => `
      <article class="customer-order-item">
        <div>
          <strong>Order #${escapeHtml(order.id)}</strong>
          <time datetime="${escapeHtml(order.created_at)}">${new Date(order.created_at).toLocaleString()}</time>
        </div>
        <div class="customer-order-meta">
          <span>UGX ${Number(order.total_amount || 0).toLocaleString()}</span>
          <span>${escapeHtml(order.payment_method || 'Payment')}</span>
          <span class="customer-order-status customer-order-status-${escapeHtml(order.status || 'pending')}">${escapeHtml(order.status || 'pending')}</span>
        </div>
      </article>
    `).join('');
  };

  const updateMode = () => {
    if (nameField) nameField.hidden = !isSignUpMode;
    if (nameInput) nameInput.required = isSignUpMode;
    if (passwordInput) passwordInput.autocomplete = isSignUpMode ? 'new-password' : 'current-password';
    if (title) title.textContent = isSignUpMode ? 'Create your VENDORA account' : 'Sign in to shop faster';
    if (intro) intro.textContent = isSignUpMode
      ? 'Create an account to track orders and check out faster.'
      : 'Shop faster with your VENDORA account.';
    if (submitButton) submitButton.textContent = isSignUpMode ? 'Create customer account' : 'Sign in';
    if (switchButton) {
      switchButton.textContent = isSignUpMode
        ? 'Already have an account? Sign in'
        : 'New here? Create an account';
    }
  };

  const openModal = () => {
    modal.hidden = false;
    modal.style.display = 'flex';
    clearPassword();
    setStatus('');
    updateMode();
    (isSignUpMode ? nameInput : emailInput)?.focus();
  };

  const closeModal = () => {
    modal.hidden = true;
    modal.style.display = 'none';
    form.reset();
    clearPassword();
    setStatus('');
  };

  const updateAccountButton = (session) => {
    currentSession = session;
    authButton.textContent = session ? 'Sign out' : 'Sign in';
    authButton.setAttribute('aria-label', session ? 'Sign out of customer account' : 'Sign in to customer account');
    if (ordersButton) ordersButton.hidden = false;
    if (!session) {
      ordersPanelOpen = false;
      ordersPanel?.setAttribute('hidden', '');
      orderSnapshot = new Map();
      ordersInitialized = false;
      if (orderBadge) orderBadge.hidden = true;
      return;
    }
    renderCustomerOrders();
  };

  authButton.addEventListener('click', async () => {
    if (currentSession) {
      if (!window.confirm('Are you sure you want to sign out?')) return;
      const { error } = await supabase.auth.signOut();
      if (error) setStatus(error.message, true);
      return;
    }
    openModal();
  });

  closeButton?.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });

  switchButton?.addEventListener('click', () => {
    isSignUpMode = !isSignUpMode;
    setStatus('');
    updateMode();
  });

  ordersButton?.addEventListener('click', () => {
    if (!currentSession) {
      openModal();
      setStatus('Sign in to view your orders.');
      return;
    }

    ordersPanelOpen = true;
    ordersPanel?.removeAttribute('hidden');
    ordersPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (orderBadge) orderBadge.hidden = true;
    setOrdersStatus('');
    renderCustomerOrders();
  });

  refreshOrdersButton?.addEventListener('click', () => renderCustomerOrders(true));

  closeOrdersButton?.addEventListener('click', () => {
    ordersPanelOpen = false;
    ordersPanel?.setAttribute('hidden', '');
  });

  window.setInterval(() => {
    if (currentSession) renderCustomerOrders(true);
  }, 30000);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitButton.disabled = true;
    setStatus(isSignUpMode ? 'Creating your account...' : 'Signing you in...');

    try {
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const result = isSignUpMode
        ? await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: nameInput.value.trim(), role: 'customer' } }
          })
        : await supabase.auth.signInWithPassword({ email, password });

      if (result.error) throw result.error;

      if (isSignUpMode && !result.data.session) {
        clearPassword();
        setStatus('Account created. Check your email to confirm your account, then sign in.');
        isSignUpMode = false;
        updateMode();
        return;
      }

      closeModal();
    } catch (error) {
      setStatus(getAuthErrorMessage(error), true);
    } finally {
      clearPassword();
      submitButton.disabled = false;
    }
  });

  supabase.auth.getSession().then(({ data: { session } }) => updateAccountButton(session));
  supabase.auth.onAuthStateChange((_event, session) => updateAccountButton(session));
  updateMode();
}
