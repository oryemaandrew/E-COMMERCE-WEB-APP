const STORAGE_KEY = 'vendora_theme';

export function initTheme() {
  const toggleBtn = document.getElementById('themeToggle');
  
  // 1. Determine initial theme (Saved setting > OS system preference > default to light)
  const savedTheme = localStorage.getItem(STORAGE_KEY);
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = savedTheme === 'dark' || savedTheme === 'light'
    ? savedTheme
    : (systemPrefersDark ? 'dark' : 'light');

  // 2. Apply theme on load
  applyTheme(initialTheme);

  // 3. Attach click event handler
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      
      applyTheme(newTheme);
      localStorage.setItem(STORAGE_KEY, newTheme);
    });
  }

  // 4. Listen for system preference changes dynamically
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const toggleBtn = document.getElementById('themeToggle');
  
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-label', `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`);
    toggleBtn.innerHTML = theme === 'dark' ? 'Light' : 'Dark';
  }
}