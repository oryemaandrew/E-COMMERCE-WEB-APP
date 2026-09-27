export const PRODUCT_CATEGORIES = [
  { value: 'fresh-produce', label: 'Fresh Produce' },
  { value: 'dairy-eggs', label: 'Dairy & Eggs' },
  { value: 'meat-seafood', label: 'Meat & Seafood' },
  { value: 'bakery', label: 'Bakery' },
  { value: 'pantry-staples', label: 'Pantry Staples' },
  { value: 'beverages', label: 'Beverages' },
  { value: 'snacks', label: 'Snacks' },
  { value: 'frozen-foods', label: 'Frozen Foods' },
  { value: 'household', label: 'Household' },
  { value: 'personal-care', label: 'Personal Care' },
  { value: 'baby-care', label: 'Baby Care' },
  { value: 'pet-care', label: 'Pet Care' },
  { value: 'apparel-footwear', label: 'Apparel & Footwear' },
  { value: 'other', label: 'Other' }
];

const categoryLabels = new Map(PRODUCT_CATEGORIES.map(category => [category.value, category.label]));
const categoryValues = new Map(PRODUCT_CATEGORIES.map(category => [category.label.toLowerCase(), category.value]));
const legacyCategoryAliases = new Map([
  ['shoes', 'apparel-footwear'],
  ['clothes', 'apparel-footwear'],
  ['groceries', 'pantry-staples']
]);

export function categoryLabel(value) {
  if (!value) return 'Other';
  const normalized = String(value).toLowerCase();
  return categoryLabels.get(legacyCategoryAliases.get(normalized) || normalized) || String(value);
}

export function categoryValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return legacyCategoryAliases.get(normalized) || categoryValues.get(normalized) || normalized.replace(/\s*&\s*/g, '-and-').replace(/\s+/g, '-');
}

export function populateCategorySelect(select, { includePlaceholder = true } = {}) {
  if (!select) return;
  select.innerHTML = includePlaceholder ? '<option value="" disabled selected>Select Category</option>' : '';
  PRODUCT_CATEGORIES.forEach(category => {
    const option = document.createElement('option');
    option.value = category.value;
    option.textContent = category.label;
    select.appendChild(option);
  });
}

export function renderCategoryFilters(container, activeCategory = 'all') {
  if (!container) return;
  container.innerHTML = [
    '<button class="filter-btn active" data-category="all">All Items</button>',
    ...PRODUCT_CATEGORIES.map(category => `<button class="filter-btn" data-category="${category.value}">${category.label}</button>`)
  ].join('');
  container.querySelectorAll('.filter-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.category === activeCategory);
  });
}