import { supabase } from './supabase.js';
import { categoryLabel, renderCategoryFilters } from './categories.js';

export let products = [];
let currentProducts = [];
let activeCategory = 'all';
let currentSearchTerm = '';
let currentPage = 0;
let hasMoreProducts = true;
let isLoadingProducts = false;
let isAdminCatalog = false;
let catalogObserver = null;
const PRODUCTS_PER_PAGE = 24;

function getAvailableStock(product) {
  const stock = Number(product.stock_quantity ?? product.stock);
  if (!Number.isFinite(stock)) return null;
  return Math.max(0, stock - Number(product.stock_reserved || 0));
}

// Fetch one catalog page so the browser never renders the entire inventory.
export async function fetchProducts({ reset = false } = {}) {
  if (isLoadingProducts || (!hasMoreProducts && !reset)) return [];
  isLoadingProducts = true;

  try {
    if (reset) {
      currentPage = 0;
      hasMoreProducts = true;
      products = [];
      currentProducts = [];
    }

    let query = supabase
      .from('products')
      .select('id,name,price,category,stock_quantity,stock_reserved,barcode,image_url,created_at')
      .order('created_at', { ascending: false })
      .range(currentPage * PRODUCTS_PER_PAGE, (currentPage + 1) * PRODUCTS_PER_PAGE - 1);

    if (activeCategory !== 'all') query = query.eq('category', activeCategory);
    if (currentSearchTerm) query = query.ilike('name', `%${currentSearchTerm}%`);

    const { data, error } = await query;

    if (error) throw error;
    const page = data || [];
    products = [...products, ...page];
    currentProducts = [...currentProducts, ...page];
    currentPage += 1;
    hasMoreProducts = page.length === PRODUCTS_PER_PAGE;
    return page;
  } catch (err) {
    console.error('Failed to load products from database:', err);
    if (!currentPage) products = [];
    hasMoreProducts = false;
    return [];
  } finally {
    isLoadingProducts = false;
  }
}

// Render catalog to DOM
export async function renderProducts() {
  const container = document.getElementById('product-container');
  if (!container) return;

  // Loading state
  container.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 3rem 0;">Loading catalog...</p>`;

  // 1. Check if user is logged in as admin
  const { data: { session } } = await supabase.auth.getSession();
  isAdminCatalog = session?.user?.app_metadata?.role === 'admin';

  // 2. Fetch the first page of live inventory
  await fetchProducts({ reset: true });
  renderCategoryFilters(document.getElementById('store-category-filters'), activeCategory);

  // 3. Display the first page and prepare the next-page trigger
  displayProducts(currentProducts, isAdminCatalog);
  setupInfiniteLoading(container);
}

// Helper for rendering cards
export function displayProducts(productsList, isAdmin = false, { append = false } = {}) {
  const container = document.getElementById('product-container');
  if (!container) return;

  if (!append && productsList.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
        <p style="font-size: 1.2rem; margin-bottom: 0.5rem;">No items available.</p>
      </div>
    `;
    return;
  }

  const cards = productsList.map(product => `
    <div class="product-card" id="product-${product.id}">
      ${isAdmin ? `<button class="delete-product-btn" data-id="${product.id}" title="Delete Item">Delete</button>` : ''}
      ${product.image_url || product.image
        ? `<img src="${product.image_url || product.image}" alt="${product.name || product.title}" class="product-image" width="346" height="244" loading="lazy" decoding="async" />`
        : '<div class="product-image product-image-placeholder" role="img" aria-label="Product image unavailable">No image</div>'}
      <div class="product-details">
        <span class="product-category">${categoryLabel(product.category_slug || product.category)}</span>
        <h3 class="product-title">${product.name || product.title || 'Unnamed item'}</h3>
        <p class="product-price">UGX ${Number(product.price).toLocaleString('en-UG')}</p>
        <p class="product-stock">${getAvailableStock(product) === null ? 'Stock available' : getAvailableStock(product) > 0 ? `${getAvailableStock(product)} available` : 'Out of stock'}</p>
        <button class="btn btn-primary add-to-cart-btn" data-id="${product.id}" ${getAvailableStock(product) === 0 ? 'disabled' : ''} style="width: 100%; margin-top: 0.8rem;">
          ${getAvailableStock(product) === 0 ? 'Unavailable' : 'Add to Cart'}
        </button>
      </div>
    </div>
  `).join('');
  if (append) container.insertAdjacentHTML('beforeend', cards);
  else container.innerHTML = cards;
}

async function loadNextPage() {
  const page = await fetchProducts();
  if (page.length) {
    displayProducts(page, isAdminCatalog, { append: true });
  } else if (!hasMoreProducts) {
    const sentinel = document.querySelector('.catalog-load-sentinel');
    if (sentinel) sentinel.textContent = 'All products loaded';
  }
}

function setupInfiniteLoading(container) {
  catalogObserver?.disconnect();
  document.querySelector('.catalog-load-sentinel')?.remove();

  const sentinel = document.createElement('div');
  sentinel.className = 'catalog-load-sentinel';
  sentinel.setAttribute('aria-live', 'polite');
  sentinel.textContent = 'Loading more products...';
  container.after(sentinel);

  catalogObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) void loadNextPage();
  }, { rootMargin: '200px 0px' });
  catalogObserver.observe(sentinel);
}

// Product detail modal initializer
export function initProductDetails() {
  const productContainer = document.getElementById('product-container');
  if (!productContainer) return;

  const existingModal = document.querySelector('.product-detail-modal');
  if (!existingModal) {
    const modal = document.createElement('div');
    modal.className = 'product-detail-modal';
    modal.setAttribute('hidden', 'hidden');
    modal.innerHTML = `
      <div class="product-detail-backdrop" aria-hidden="true"></div>
      <div class="product-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="product-detail-title">
        <button type="button" class="product-detail-close" aria-label="Close product details">×</button>
        <div class="product-detail-layout">
          <img class="product-detail-image" src="" alt="" />
          <div class="product-detail-copy">
            <p class="product-detail-meta"></p>
            <h2 id="product-detail-title"></h2>
            <p class="product-detail-price"></p>
            <p class="product-detail-stock"></p>
            <p class="product-detail-description"></p>
            <button type="button" class="btn btn-primary add-to-cart-btn">Add to Cart</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const modal = document.querySelector('.product-detail-modal');
  const closeButton = modal?.querySelector('.product-detail-close');
  const backdrop = modal?.querySelector('.product-detail-backdrop');
  const detailImage = modal?.querySelector('.product-detail-image');
  const detailMeta = modal?.querySelector('.product-detail-meta');
  const detailTitle = modal?.querySelector('#product-detail-title');
  const detailPrice = modal?.querySelector('.product-detail-price');
  const detailStock = modal?.querySelector('.product-detail-stock');
  const detailDescription = modal?.querySelector('.product-detail-description');
  const addToCartButton = modal?.querySelector('.add-to-cart-btn');

  const closeModal = () => {
    if (!modal) return;
    modal.setAttribute('hidden', 'hidden');
    document.body.classList.remove('product-details-open');
  };

  closeButton?.addEventListener('click', closeModal);
  backdrop?.addEventListener('click', closeModal);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.hasAttribute('hidden')) {
      closeModal();
    }
  });

  productContainer.addEventListener('click', (event) => {
      const card = event.target.closest('.product-card');
      if (!card) return;
      if (event.target.closest('.add-to-cart-btn') || event.target.closest('.delete-product-btn')) return;

      const productId = card.id.replace('product-', '');
      const product = products.find(item => String(item.id) === String(productId));
      if (!product || !modal) return;

      detailImage.src = product.image_url || product.image || '';
      detailImage.alt = product.name || product.title || 'Product';
      detailMeta.textContent = categoryLabel(product.category_slug || product.category || '');
      detailTitle.textContent = product.name || product.title || 'Unnamed item';
      detailPrice.textContent = `UGX ${Number(product.price || 0).toLocaleString()}`;
      const availableStock = getAvailableStock(product);
      detailStock.textContent = availableStock === null ? 'Stock available' : availableStock > 0 ? `${availableStock} available` : 'Out of stock';
      detailDescription.textContent = product.description || 'Freshly stocked and ready for checkout.';
      addToCartButton.dataset.id = product.id;
      addToCartButton.disabled = availableStock === 0;
      addToCartButton.textContent = availableStock === 0 ? 'Unavailable' : 'Add to Cart';
      modal.removeAttribute('hidden');
      document.body.classList.add('product-details-open');
  });
}

// Filter and search initialization
export function initFilters() {
  const filterContainer = document.getElementById('store-category-filters');
  const searchInput = document.getElementById('searchInput');

  if (!filterContainer && !searchInput) return;

  let filterTimer;
  function applyFilters() {
    currentSearchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    clearTimeout(filterTimer);
    filterTimer = setTimeout(async () => {
      const container = document.getElementById('product-container');
      if (!container) return;
      container.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 3rem 0;">Loading catalog...</p>`;
      await fetchProducts({ reset: true });
      displayProducts(currentProducts, isAdminCatalog);
      setupInfiniteLoading(container);
    }, 250);
  }

  if (filterContainer) {
    filterContainer.addEventListener('click', (event) => {
      const button = event.target.closest('.filter-btn');
      if (!button || !filterContainer.contains(button)) return;

      activeCategory = button.dataset.category || 'all';
      filterContainer.querySelectorAll('.filter-btn').forEach(filterBtn => {
        filterBtn.classList.toggle('active', filterBtn === button);
      });
      applyFilters();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', applyFilters);
  }
}