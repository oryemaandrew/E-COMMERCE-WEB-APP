// scripts/main.js

// ==========================================
// 1. MODULE IMPORTS
// ==========================================
import { supabase } from './modules/supabase.js';
import { initAdminAuth } from './modules/auth.js';
import { initCustomerAuth } from './modules/customerAuth.js';
import { renderProducts, initFilters, initProductDetails } from './modules/products.js';
import { initCart } from './modules/cart.js';
import { initAdmin, setupDeleteListeners } from './modules/admin.js';
import { initTheme } from './modules/theme.js';
import { initCustomerRequestForm } from './modules/contact.js';


// ==========================================
// 2. MAIN APP INITIALIZER
// ==========================================
async function initializeApp() {
  console.log("VENDORA Store Initialized");

  // --- A. Theme Toggle Setup ---
  initTheme();
  initMobileNavigation();
  initPasswordToggles();

  // --- C. Initialize Auth State Observer ---
  initAdminAuth();
  const adminReturnReason = new URLSearchParams(window.location.search).get('admin');
  if (adminReturnReason) {
    const message = adminReturnReason === 'not-authorized'
      ? 'This account is not authorized for the admin portal.'
      : 'Please sign in with an authorized admin account.';
    document.getElementById('openAdminModalLink')?.click();
    const authStatus = document.getElementById('authStatus');
    if (authStatus) {
      authStatus.style.color = '#ef4444';
      authStatus.textContent = message;
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  }
  initCustomerAuth();

  // --- D. Restore Admin Panel Visibility From Active Session ---
  await restoreAdminState();

  initCart();

  // --- E. Fetch & Render Catalog from Supabase ---
  await renderProducts();

  // --- F. Initialize Filters, Cart & Admin Listeners AFTER Products Load ---
  initFilters();
  initProductDetails();
  initCustomerRequestForm();

  if (typeof initAdmin === 'function') initAdmin();
  if (typeof setupDeleteListeners === 'function') setupDeleteListeners();
}

function initMobileNavigation() {
  const toggle = document.getElementById('mobileNavToggle');
  const menu = document.getElementById('mobileMenu');
  if (!toggle || !menu) return;

  const closeNavigation = () => {
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation');
  };

  toggle.addEventListener('click', () => {
    const isOpen = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
  });

  menu.querySelectorAll('a, button').forEach(control => control.addEventListener('click', closeNavigation));
  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) closeNavigation();
  });
}

function initPasswordToggles() {
  document.querySelectorAll('[data-password-target]').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const input = document.getElementById(toggle.dataset.passwordTarget);
      if (!input) return;
      const isVisible = input.type === 'text';
      input.type = isVisible ? 'password' : 'text';
      toggle.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
      toggle.setAttribute('aria-pressed', String(!isVisible));
    });
  });
}

// Module dependencies can finish loading after DOMContentLoaded has fired.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp, { once: true });
} else {
  initializeApp();
}

// ==========================================
// 3. HELPER FUNCTIONS
// ==========================================

async function restoreAdminState() {
  const adminPanel = document.getElementById('admin-panel') || document.getElementById('adminPanel');
  if (!adminPanel) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.app_metadata?.role === 'admin') {
      adminPanel.style.display = 'block';
    } else {
      adminPanel.style.display = 'none';
    }
  } catch (err) {
    console.error("Session restoration error:", err);
    adminPanel.style.display = 'none';
  }
}



