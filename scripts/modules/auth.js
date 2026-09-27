// scripts/modules/auth.js
import { supabase } from './supabase.js';
import { renderProducts } from './products.js';

export function initAdminAuth() {
  const loginForm = document.getElementById('adminLoginForm');
  const authModal = document.getElementById('adminAuthModal');
  const authStatus = document.getElementById('authStatus');
  const openBtn = document.getElementById('openAdminModalLink');
  const closeBtn = document.getElementById('closeAuthModalBtn');
  const logoutBtn = document.getElementById('adminLogoutBtn');
  const clearAdminPassword = () => {
    const passwordInput = document.getElementById('adminPassword');
    const passwordToggle = document.querySelector('[data-password-target="adminPassword"]');
    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.type = 'password';
    }
    passwordToggle?.setAttribute('aria-pressed', 'false');
    passwordToggle?.setAttribute('aria-label', 'Show password');
  };

  // --- 1. MODAL VISIBILITY CONTROLS ---
  if (openBtn) {
    openBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const modal = document.getElementById('adminAuthModal');
      if (modal) {
        loginForm?.reset();
        clearAdminPassword();
        modal.style.display = 'flex';
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }

  if (authModal) {
    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) closeModal();
    });
  }

  function closeModal() {
    const modal = document.getElementById('adminAuthModal');
    if (modal) {
      modal.style.display = 'none';
      loginForm?.reset();
      clearAdminPassword();
      if (authStatus) authStatus.textContent = '';
    }
  }

  // --- 2. LOGOUT CONTROL ---
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await supabase.auth.signOut();
    });
  }

  // --- 3. SUPABASE SESSION CHECK & LISTENERS ---
  supabase.auth.getSession().then(({ data: { session } }) => {
    toggleAdminControls(isAdminSession(session));
  });

  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log('Auth state changed:', event);
    toggleAdminControls(isAdminSession(session));

    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
      await renderProducts();
    }
  });

  // --- 4. HANDLE LOGIN FORM SUBMISSION ---
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('adminEmail');
      const passwordInput = document.getElementById('adminPassword');

      if (!emailInput || !passwordInput) return;

      const email = emailInput.value.trim();
      const password = passwordInput.value;

      if (authStatus) {
        authStatus.style.color = '#94a3b8';
        authStatus.textContent = 'Verifying credentials...';
      }


      clearAdminPassword();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        if (authStatus) {
          authStatus.style.color = '#ef4444';
          authStatus.textContent = error.message;
        }
      } else if (data.user?.app_metadata?.role !== 'admin') {
        await supabase.auth.signOut();
        if (authStatus) {
          authStatus.style.color = '#ef4444';
          authStatus.textContent = 'This account is not authorized for the admin portal.';
        }
      } else {
        loginForm.reset();
        window.location.assign('admin.html');
      }
    });
  }

  // --- 5. DYNAMIC UI TOGGLE ---
  function toggleAdminControls(isLoggedIn) {
    const adminPanel = document.getElementById('admin-panel') || document.getElementById('adminPanel');

    if (adminPanel) {
      adminPanel.style.display = isLoggedIn ? 'block' : 'none';
    }

    document.querySelectorAll('.delete-product-btn').forEach(btn => {
      btn.style.display = isLoggedIn ? 'inline-block' : 'none';
    });
  }

  function isAdminSession(session) {
    return session?.user?.app_metadata?.role === 'admin';
  }
}