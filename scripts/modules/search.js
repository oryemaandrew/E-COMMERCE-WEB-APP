import { renderProducts } from './products.js';

export function initSearch() {
  const searchInput = document.getElementById('searchInput');
  if (!searchInput) return;

  // Modern input listener with instant reactivity
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    renderProducts(undefined, query);
  });
}