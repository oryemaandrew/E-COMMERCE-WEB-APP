// scripts/modules/admin.js
import { supabase } from './supabase.js';
import { renderProducts } from './products.js';
import { categoryLabel, categoryValue, populateCategorySelect } from './categories.js';

const ADMIN_API_BASE = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  && window.location.port !== '5000'
  ? 'http://localhost:5000'
  : '';

async function deleteProduct(productId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const response = await fetch(`${ADMIN_API_BASE}/api/admin/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
    headers: sessionData?.session?.access_token
      ? { Authorization: `Bearer ${sessionData.session.access_token}` }
      : {}
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) {
    throw new Error(result.error || `HTTP ${response.status}`);
  }
}

// Setup Event Listeners for Product Deletion
export function setupDeleteListeners() {
  const productContainer = document.getElementById('product-container');
  if (!productContainer) return;

  productContainer.addEventListener('click', async (event) => {
    const deleteBtn = event.target.closest('.delete-product-btn');
    if (!deleteBtn) return;

    const productId = deleteBtn.getAttribute('data-id');
    const confirmDelete = confirm('Are you sure you want to permanently delete this product?');
    if (!confirmDelete) return;

    deleteBtn.textContent = 'Deleting...';
    deleteBtn.disabled = true;

    try {
      await deleteProduct(productId);

      const cardElement = document.getElementById(`product-${productId}`);
      if (cardElement) {
        cardElement.style.transition = 'all 0.3s ease';
        cardElement.style.opacity = '0';
        cardElement.style.transform = 'scale(0.9)';
        setTimeout(() => cardElement.remove(), 300);
      }

      alert('Product deleted successfully.');
    } catch (err) {
      alert('Failed to delete product: ' + err.message);
      deleteBtn.textContent = 'Delete';
      deleteBtn.disabled = false;
    }
  });
}

// Initialize Admin Form Operations (File Uploads & Direct Database Insert)
export function initAdmin() {
  const adminForm = document.getElementById('addProductForm') || document.getElementById('add-product-form');

  if (!adminForm) return;

  populateCategorySelect(document.getElementById('prod-category') || document.getElementById('prodCategory'));
  loadInventoryTable();
  initCustomerOrders();
  initCashierAccess();
  initAuditLog();

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const titleInput = document.getElementById('prodTitle') || document.getElementById('prod-name');
    const priceInput = document.getElementById('prodPrice') || document.getElementById('prod-price');
    const stockInput = document.getElementById('prodStock') || document.getElementById('prod-stock');
    const barcodeInput = document.getElementById('prodBarcode') || document.getElementById('prod-barcode');
    const categorySelect = document.getElementById('prodCategory') || document.getElementById('prod-category');
    const fileInput = document.getElementById('prodImageFile') || document.getElementById('prod-image-file');
    const urlInput = document.getElementById('prodImageUrl') || document.getElementById('prod-image-url');
    const submitBtn = adminForm.querySelector('button[type="submit"]');

    const title = titleInput ? titleInput.value.trim() : '';
    const price = priceInput ? parseFloat(priceInput.value) : 0;
    const stock = stockInput ? parseInt(stockInput.value, 10) : 0;
    const barcode = barcodeInput ? barcodeInput.value.trim() : '';
    const category = categoryValue(categorySelect?.value);
    let imageUrl = urlInput ? urlInput.value.trim() : '';

    if (submitBtn) {
      submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Uploading Item...</span>';
    try {
      if (!category) {
        throw new Error('Please select an item category.');
      }

      if (fileInput?.files.length) {
        const file = fileInput.files[0];
        const extension = file.name.split('.').pop().toLowerCase();
        const filePath = `items/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from('product-images')
          .upload(filePath, file, { upsert: false, contentType: file.type });

        if (uploadError) {
          throw new Error(`Image upload failed: ${uploadError.message}. Confirm that the product-images bucket exists and that you are signed in.`);
        }

        imageUrl = supabase.storage.from('product-images').getPublicUrl(filePath).data.publicUrl;
      }

      const { error: dbError } = await supabase
        .from('products')
        .insert([{
          name: title,
          price,
          category,
          stock_quantity: stock,
          barcode,
          image_url: imageUrl || null
        }]);

      if (dbError) {
        if (/image_url|schema cache|column.*does not exist/i.test(dbError.message || '')) {
          throw new Error(`The database is missing the image_url column. Run supabase-products-image-migration.sql in Supabase SQL Editor, then try again. (${dbError.message})`);
        }
        throw dbError;
      }

      alert('Product published to store successfully.');
      adminForm.reset();
      await loadInventoryTable();
      await renderProducts();

    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Save Product to Database</span>';
      }
    }
    }
  });
  // Attach global delete action handler
  setupDeleteListeners();
}

function initCustomerOrders() {
  const searchInput = document.getElementById('order-search');
  const statusFilter = document.getElementById('order-status-filter');
  const visibilityFilter = document.getElementById('order-visibility-filter');
  if (!searchInput || !statusFilter || !visibilityFilter) return;

  let orders = [];

  const renderOrders = () => {
    const tableBody = document.getElementById('admin-orders-body');
    const statusMessage = document.getElementById('admin-orders-status');
    if (!tableBody) return;

    const search = searchInput.value.trim().toLowerCase();
    const selectedStatus = statusFilter.value;
    const showArchived = visibilityFilter.value === 'archived';
    const filteredOrders = orders.filter(order => {
      const matchesSearch = !search || [order.id, order.payment_method, order.cashierLabel, order.status]
        .some(value => String(value ?? '').toLowerCase().includes(search));
      const matchesStatus = selectedStatus === 'all' || order.status === selectedStatus;
      return matchesSearch && matchesStatus && Boolean(order.archived_at) === showArchived;
    });

    if (statusMessage) statusMessage.textContent = `${filteredOrders.length} order${filteredOrders.length === 1 ? '' : 's'} shown`;
    if (!filteredOrders.length) {
      tableBody.innerHTML = '<tr><td colspan="8" style="padding:0.75rem;">No matching customer orders.</td></tr>';
      return;
    }

    tableBody.innerHTML = filteredOrders.map(order => `
      <tr>
        <td style="padding:0.75rem; font-weight:600;">#${escapeAdminText(order.id)}</td>
        <td style="padding:0.75rem;">${formatOrderDate(order.created_at)}</td>
        <td style="padding:0.75rem;">${Number(order.itemCount || 0).toLocaleString()}</td>
        <td style="padding:0.75rem;">${escapeAdminText(order.payment_method || '-')}</td>
        <td style="padding:0.75rem;">${escapeAdminText(order.cashierLabel || '-')}</td>
        <td style="padding:0.75rem;">UGX ${Number(order.total_amount || 0).toLocaleString()}</td>
        <td style="padding:0.75rem; text-transform:capitalize;">${escapeAdminText(order.status || 'pending')}</td>
        <td style="padding:0.75rem; display:flex; gap:0.5rem; flex-wrap:wrap;">
          ${order.status === 'pending' && !order.archived_at
            ? `<button type="button" class="cancel-order-btn btn-danger-outline" data-order-id="${escapeAdminText(order.id)}">Cancel</button>`
            : ''}
          ${order.archived_at
            ? `<button type="button" class="archive-order-btn btn-secondary" data-order-id="${escapeAdminText(order.id)}" data-archived="false">Restore</button>`
            : order.status !== 'pending'
              ? `<button type="button" class="archive-order-btn btn-secondary" data-order-id="${escapeAdminText(order.id)}" data-archived="true">Archive</button>`
              : ''}
        </td>
      </tr>
    `).join('');

    tableBody.querySelectorAll('.cancel-order-btn').forEach(button => {
      button.addEventListener('click', async () => {
        const order = orders.find(item => String(item.id) === String(button.dataset.orderId));
        if (!order || order.status === 'cancelled') return;
        if (!confirm(`Cancel order #${order.id}? This keeps a record of the cancellation instead of permanently deleting it.`)) return;

        button.disabled = true;
        button.textContent = 'Cancelling...';
        const { data: sessionData } = await supabase.auth.getSession();
        const response = await fetch(`${ADMIN_API_BASE}/api/admin/orders/${encodeURIComponent(order.id)}/cancel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(sessionData?.session?.access_token
              ? { Authorization: `Bearer ${sessionData.session.access_token}` }
              : {})
          }
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
          alert('Failed to cancel order: ' + (result.error || `HTTP ${response.status}`));
          button.disabled = false;
          button.textContent = 'Cancel';
          return;
        }

        order.status = 'cancelled';
        if (statusMessage) statusMessage.textContent = `Order #${order.id} was cancelled.`;
        renderOrders();
      });
    });

    tableBody.querySelectorAll('.archive-order-btn').forEach(button => {
      button.addEventListener('click', async () => {
        const order = orders.find(item => String(item.id) === String(button.dataset.orderId));
        if (!order) return;
        const shouldArchive = button.dataset.archived === 'true';
        if (!confirm(`${shouldArchive ? 'Archive' : 'Restore'} order #${order.id}?`)) return;

        button.disabled = true;
        const { data: sessionData } = await supabase.auth.getSession();
        const response = await fetch(`${ADMIN_API_BASE}/api/admin/orders/${encodeURIComponent(order.id)}/archive`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(sessionData?.session?.access_token
              ? { Authorization: `Bearer ${sessionData.session.access_token}` }
              : {})
          },
          body: JSON.stringify({ archived: shouldArchive })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
          alert(result.error || 'Unable to update order archive state.');
          button.disabled = false;
          return;
        }

        order.archived_at = shouldArchive ? new Date().toISOString() : null;
        renderOrders();
      });
    });
  };

  const loadOrders = async () => {
    const tableBody = document.getElementById('admin-orders-body');
    try {
      let orderRows = [];

      try {
        const { data: rows, error: ordersError } = await supabase
          .from('orders')
          .select('id, created_at, total_amount, payment_method, cashier_id, status, archived_at')
          .order('created_at', { ascending: false });

        if (ordersError) throw ordersError;
        orderRows = rows || [];
      } catch (schemaError) {
        console.warn('Orders table does not include the expected columns; falling back to minimal fields.', schemaError);
        const { data: fallbackRows, error: fallbackError } = await supabase
          .from('orders')
          .select('id, created_at, total_amount')
          .order('created_at', { ascending: false });

        if (fallbackError) throw fallbackError;
        orderRows = (fallbackRows || []).map(order => ({
          ...order,
          payment_method: '—',
          cashier_id: null,
          status: 'completed'
        }));
      }

      let cashierById = {};
      try {
        const { data: cashierRows, error: cashiersError } = await supabase
          .from('cashiers')
          .select('id, cashier_code, full_name');

        if (cashiersError) throw cashiersError;
        cashierById = Object.fromEntries((cashierRows || []).map(cashier => [String(cashier.id), cashier]));
      } catch (cashiersError) {
        console.warn('Cashier directory is unavailable. Showing cashier IDs instead.', cashiersError);
      }

      let itemCountByOrderId = {};
      try {
        const { data: itemRows, error: itemsError } = await supabase
          .from('order_items')
          .select('order_id, quantity');

        if (itemsError) throw itemsError;

        (itemRows || []).forEach(item => {
          const orderId = item.order_id ?? item.orderId ?? item.orderID;
          const quantity = Number(item.quantity || 0);
          if (!orderId) return;
          itemCountByOrderId[orderId] = (itemCountByOrderId[orderId] || 0) + quantity;
        });
      } catch (itemError) {
        console.warn('Order item summary is unavailable. Showing item totals as zero.', itemError);
      }

      orders = (orderRows || []).map(order => ({
        ...order,
        cashierLabel: order.cashier_id
          ? [cashierById[String(order.cashier_id)]?.cashier_code, cashierById[String(order.cashier_id)]?.full_name]
            .filter(Boolean)
            .join(' - ') || order.cashier_id
          : '-',
        itemCount: Number(itemCountByOrderId[order.id] || 0)
      }));
      renderOrders();
    } catch (error) {
      console.error('Customer orders error:', error);
      if (tableBody) tableBody.innerHTML = '<tr><td colspan="8" style="padding:0.75rem;">Unable to load customer orders.</td></tr>';
    }
  };

  searchInput.addEventListener('input', renderOrders);
  statusFilter.addEventListener('change', renderOrders);
  visibilityFilter.addEventListener('change', renderOrders);
  loadOrders();
}

function formatOrderDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function escapeAdminText(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[character]));
}

async function loadInventoryTable() {
  const tableBody = document.getElementById('admin-inventory-body');
  if (!tableBody) return;

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    tableBody.innerHTML = '<tr><td colspan="6">Unable to load inventory.</td></tr>';
    return;
  }

  tableBody.innerHTML = (data || []).map(product => `
    <tr>
      <td>${product.barcode || product.sku || '-'}</td>
      <td>${product.title || product.name || 'Unnamed item'}</td>
      <td><span class="inventory-category">${categoryLabel(product.category_slug || product.category)}</span></td>
      <td>UGX ${Number(product.price || 0).toLocaleString()}</td>
      <td>${getAvailableStock(product)} / ${product.stock_quantity ?? product.stock ?? '-'}</td>
      <td><button type="button" class="delete-inventory-btn btn-danger-outline" data-id="${product.id}">Delete</button></td>
    </tr>
  `).join('') || '<tr><td colspan="6">No inventory items yet.</td></tr>';

  tableBody.querySelectorAll('.delete-inventory-btn').forEach(button => {
    button.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to permanently delete this product?')) return;
      try {
        await deleteProduct(button.dataset.id);
      } catch (error) {
        alert('Failed to delete product: ' + error.message);
        return;
      }
      await loadInventoryTable();
    });
  });
}

function getAvailableStock(product) {
  const stock = Number(product.stock_quantity ?? product.stock);
  if (!Number.isFinite(stock)) return '-';
  return Math.max(0, stock - Number(product.stock_reserved || 0));
}

function initCashierAccess() {
  const tableBody = document.getElementById('admin-cashiers-body');
  const visibilityFilter = document.getElementById('admin-cashier-visibility');
  if (!tableBody) return;
  let cashierRows = [];

  const renderCashiers = () => {
    const visibility = visibilityFilter?.value || 'all';
    const cashiers = cashierRows.filter(cashier =>
      visibility === 'all' || (visibility === 'active' ? cashier.is_active : !cashier.is_active)
    );
    if (!cashiers.length) {
      const label = visibility === 'suspended' ? 'suspended' : visibility === 'all' ? '' : 'active';
      tableBody.innerHTML = `<tr><td colspan="4" style="padding:0.75rem;">No ${label ? `${label} ` : ''}cashier accounts found.</td></tr>`;
      return;
    }

    tableBody.innerHTML = cashiers.map(cashier => `
      <tr>
        <td style="padding:0.75rem;"><strong>${escapeAdminText(cashier.full_name)}</strong><br><small>${escapeAdminText(cashier.email)}</small></td>
        <td style="padding:0.75rem;">${escapeAdminText(cashier.cashier_code)}</td>
        <td style="padding:0.75rem;"><span class="admin-access-status ${cashier.is_active ? 'is-active' : 'is-suspended'}">${cashier.is_active ? 'Active' : 'Suspended'}</span></td>
        <td style="padding:0.75rem;"><button type="button" class="cashier-access-btn ${cashier.is_active ? 'btn-danger-outline' : 'btn-secondary'}" data-cashier-id="${escapeAdminText(cashier.id)}">${cashier.is_active ? 'Suspend access' : 'Restore access'}</button></td>
      </tr>
    `).join('');

    tableBody.querySelectorAll('.cashier-access-btn').forEach(button => {
      button.addEventListener('click', async () => {
        const cashier = cashiers.find(item => String(item.id) === String(button.dataset.cashierId));
        if (!cashier) return;
        const nextState = !cashier.is_active;
        if (!confirm(`${nextState ? 'Restore' : 'Suspend'} POS access for ${cashier.full_name}?`)) return;

        button.disabled = true;
        const { error } = await supabase
          .from('cashiers')
          .update({ is_active: nextState })
          .eq('id', cashier.id);
        if (error) {
          alert(`Unable to update cashier access: ${error.message}`);
          button.disabled = false;
          return;
        }

        cashier.is_active = nextState;
        renderCashiers();
      });
    });
  };

  visibilityFilter?.addEventListener('change', renderCashiers);

  supabase
    .from('cashiers')
    .select('id, full_name, email, cashier_code, is_active')
    .order('full_name')
    .then(({ data, error }) => {
      if (error) {
        tableBody.innerHTML = `<tr><td colspan="4" style="padding:0.75rem;">Unable to load cashier access: ${escapeAdminText(error.message)}</td></tr>`;
        return;
      }
      cashierRows = data || [];
      renderCashiers();
    });
}

function initAuditLog() {
  const tableBody = document.getElementById('admin-audit-body');
  const refreshButton = document.getElementById('refreshAuditBtn');
  if (!tableBody) return;

  const loadAuditEvents = async () => {
    tableBody.innerHTML = '<tr><td colspan="5" style="padding:0.75rem;">Loading audit log...</td></tr>';
    const { data: sessionData } = await supabase.auth.getSession();
    const response = await fetch(`${ADMIN_API_BASE}/api/admin/audit-events?limit=50`, {
      headers: sessionData?.session?.access_token
        ? { Authorization: `Bearer ${sessionData.session.access_token}` }
        : {}
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) {
      tableBody.innerHTML = `<tr><td colspan="5" style="padding:0.75rem;">${escapeAdminText(result.error || 'Unable to load audit log.')}</td></tr>`;
      return;
    }

    if (!result.events.length) {
      tableBody.innerHTML = '<tr><td colspan="5" style="padding:0.75rem;">No audit events recorded yet.</td></tr>';
      return;
    }

    tableBody.innerHTML = result.events.map(event => {
      const details = event.details || {};
      const detailText = event.event_type === 'cash_sale_completed'
        ? `UGX ${Number(details.total_amount || 0).toLocaleString()} received UGX ${Number(details.cash_received || 0).toLocaleString()} change UGX ${Number(details.change_due || 0).toLocaleString()}`
        : `${details.payment_method || 'Payment'} · UGX ${Number(details.total_amount || 0).toLocaleString()}`;
      return `
        <tr>
          <td style="padding:0.75rem;">${escapeAdminText(formatOrderDate(event.created_at))}</td>
          <td style="padding:0.75rem; font-weight:600;">#${escapeAdminText(event.order_id)}</td>
          <td style="padding:0.75rem;">${escapeAdminText(event.event_type.replaceAll('_', ' '))}</td>
          <td style="padding:0.75rem;">${escapeAdminText(event.actor_id || '-')}</td>
          <td style="padding:0.75rem;">${escapeAdminText(detailText)}</td>
        </tr>
      `;
    }).join('');
  };

  refreshButton?.addEventListener('click', loadAuditEvents);
  loadAuditEvents();
}