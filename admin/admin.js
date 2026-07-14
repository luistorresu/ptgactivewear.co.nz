const state = {
  activeView: 'dashboard',
  currentProduct: null,
  currentOrder: null
};

function applyTheme(theme) {
  const selected = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = selected;
  localStorage.setItem('ptg-admin-theme', selected);
  const button = document.querySelector('[data-theme-toggle]');
  if (button) {
    const isDark = selected === 'dark';
    button.querySelector('.theme-icon').textContent = isDark ? '\u2600' : '\u263e';
    button.querySelector('[data-theme-label]').textContent = isDark ? 'Light theme' : 'Dark theme';
    button.setAttribute('aria-pressed', String(isDark));
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));
}

function money(cents, currency = 'NZD') {
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: String(currency || 'NZD').toUpperCase() }).format(Number(cents || 0) / 100);
}

function dateTime(value) {
  if (!value) return 'Not available';
  const date = new Date(String(value).includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' });
}

function setStatus(element, type, message) {
  if (!element) return;
  element.textContent = message;
  element.className = `status status-${type}`;
}

function clearStatus(element) {
  if (!element) return;
  element.textContent = '';
  element.className = 'status is-hidden';
}

async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!['GET', 'HEAD'].includes(method)) headers.set('X-PTG-Admin-Request', '1');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api/admin${path}`, { ...options, method, headers, credentials: 'same-origin' });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error('Your admin session has expired. Refresh the page to sign in again.');
  if (!response.ok || !result.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

function badge(text, type = 'neutral') {
  return `<span class="badge badge-${type}">${escapeHtml(text)}</span>`;
}

function empty(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function orderRows(orders) {
  if (!orders.length) return empty('No paid orders have been recorded yet.');
  return `<table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Fulfilment</th><th>Invoice</th><th>Date</th><th></th></tr></thead><tbody>${orders.map(order => `
    <tr>
      <td><strong>${escapeHtml(order.order_number || `Order #${order.id}`)}</strong><br><small>${escapeHtml(order.stripe_checkout_session_id)}</small></td>
      <td><strong>${escapeHtml(order.customer_name || 'Not provided')}</strong><br><small>${escapeHtml(order.customer_email || '')}</small></td>
      <td>${money(order.total_cents, order.currency)}</td>
      <td>${badge(order.payment_status, order.payment_status === 'paid' ? 'success' : 'warning')}</td>
      <td>${badge(order.fulfilment_status, order.fulfilment_status === 'fulfilled' ? 'success' : 'neutral')}</td>
      <td>${order.invoice_number ? badge(order.invoice_number, 'success') : badge('Not created', 'neutral')}</td>
      <td>${escapeHtml(dateTime(order.created_at))}</td>
      <td><button type="button" class="button button-secondary button-small" data-order-id="${Number(order.id)}">View</button></td>
    </tr>`).join('')}</tbody></table>`;
}

function movementActivity(movements) {
  if (!movements.length) return empty('No stock adjustments have been recorded.');
  return movements.map(item => `
    <div class="activity-item">
      <strong>${escapeHtml(item.product_name)} <span class="${item.change_quantity >= 0 ? 'change-positive' : 'change-negative'}">${item.change_quantity >= 0 ? '+' : ''}${Number(item.change_quantity)}</span></strong>
      <p>${escapeHtml(item.sku)} &middot; ${escapeHtml(item.reason)} &middot; ${escapeHtml(dateTime(item.created_at))}</p>
    </div>`).join('');
}

async function loadIdentity() {
  const result = await api('/me');
  document.getElementById('admin-email').textContent = result.identity.email;
}

async function loadDashboard() {
  const metrics = document.getElementById('dashboard-metrics');
  metrics.innerHTML = empty('Loading dashboard...');
  const result = await api('/dashboard');
  const values = [
    ['Sales today', money(result.summary.salesTodayCents)],
    ['Sales this month', money(result.summary.salesMonthCents)],
    ['Paid orders', result.summary.paidOrders],
    ['Awaiting fulfilment', result.summary.awaitingFulfilment],
    ['Low-stock variants', result.summary.lowStockVariants],
    ['Out-of-stock variants', result.summary.outOfStockVariants]
  ];
  metrics.innerHTML = values.map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  document.getElementById('dashboard-orders').innerHTML = orderRows(result.recentOrders);
  document.getElementById('dashboard-movements').innerHTML = movementActivity(result.recentMovements);
}

async function loadProducts() {
  const container = document.getElementById('products-table');
  container.innerHTML = empty('Loading products...');
  const result = await api('/products');
  if (!result.products.length) { container.innerHTML = empty('No products found.'); return; }
  container.innerHTML = `<table><thead><tr><th>Product</th><th>Price</th><th>Status</th><th>Inventory</th><th>Total stock</th><th>Variants</th><th></th></tr></thead><tbody>${result.products.map(product => `
    <tr>
      <td><div class="product-cell"><img src="${escapeHtml(product.primaryImage)}" alt=""><div><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.id)}</span></div></div></td>
      <td>${money(product.priceCents)}</td>
      <td>${product.active ? badge('Active', 'success') : badge('Inactive', 'danger')} ${product.availableForSale ? '' : badge('Not for sale', 'warning')}</td>
      <td>${product.trackInventory ? badge('Tracked', 'neutral') : badge('Not tracked', 'warning')}</td>
      <td><strong>${Number(product.totalStock)}</strong></td>
      <td>${Number(product.variantCount)}</td>
      <td><button type="button" class="button button-secondary button-small" data-product-id="${escapeHtml(product.id)}">Edit</button></td>
    </tr>`).join('')}</tbody></table>`;
}

async function loadOrders() {
  const container = document.getElementById('orders-table');
  container.innerHTML = empty('Loading orders...');
  const form = document.getElementById('order-filters');
  const params = new URLSearchParams(new FormData(form));
  for (const [key, value] of [...params]) if (!value) params.delete(key);
  document.querySelector('[data-export-orders]').href = `/api/admin/exports/orders?${params}`;
  const result = await api(`/orders?${params}`);
  container.innerHTML = orderRows(result.orders);
}

async function loadMovements() {
  const container = document.getElementById('movements-table');
  container.innerHTML = empty('Loading stock history...');
  const form = document.getElementById('movement-filters');
  const params = new URLSearchParams(new FormData(form));
  for (const [key, value] of [...params]) if (!value) params.delete(key);
  document.querySelector('[data-export-movements]').href = `/api/admin/exports/stock-movements?${params}`;
  document.querySelector('[data-export-inventory]').href = `/api/admin/exports/inventory?${params}`;
  const result = await api(`/stock-movements?${params}`);
  if (!result.movements.length) { container.innerHTML = empty('No stock adjustments have been recorded.'); return; }
  container.innerHTML = `<table><thead><tr><th>Date</th><th>Product</th><th>SKU / option</th><th>Change</th><th>Before</th><th>After</th><th>Reason</th><th>Changed by</th></tr></thead><tbody>${result.movements.map(item => `
    <tr>
      <td>${escapeHtml(dateTime(item.created_at))}</td>
      <td>${escapeHtml(item.product_name)}</td>
      <td><strong>${escapeHtml(item.sku)}</strong><br><small>${escapeHtml([item.size, item.colour, item.style].filter(Boolean).join(' / '))}</small></td>
      <td class="${item.change_quantity >= 0 ? 'change-positive' : 'change-negative'}"><strong>${item.change_quantity >= 0 ? '+' : ''}${Number(item.change_quantity)}</strong></td>
      <td>${Number(item.quantity_before)}</td><td>${Number(item.quantity_after)}</td>
      <td>${escapeHtml(item.reason)}</td><td>${escapeHtml(item.changed_by)}</td>
    </tr>`).join('')}</tbody></table>`;
}

async function showView(view) {
  state.activeView = view;
  document.querySelectorAll('[data-view]').forEach(section => { section.hidden = section.dataset.view !== view; });
  document.querySelectorAll('[data-view-button]').forEach(button => button.classList.toggle('is-active', button.dataset.viewButton === view));
  const loaders = { dashboard: loadDashboard, products: loadProducts, orders: loadOrders, movements: loadMovements };
  try { await loaders[view](); } catch (error) { setStatus(document.getElementById('global-status'), 'error', error.message); }
}

function modal(name, open) {
  const element = document.getElementById(`${name}-modal`);
  element.hidden = !open;
  document.body.style.overflow = open ? 'hidden' : '';
}

function renderVariantList(product) {
  const container = document.getElementById('variant-list');
  if (!product.variants.length) { container.innerHTML = empty('No variants. Add one before enabling inventory tracking.'); return; }
  container.innerHTML = product.variants.map(variant => `
    <article class="variant-card" data-variant-card="${Number(variant.id)}">
      <form class="variant-edit-grid" data-variant-form="${Number(variant.id)}">
        <input type="hidden" name="version" value="${Number(variant.version)}">
        <label class="field"><span>SKU</span><input name="sku" value="${escapeHtml(variant.sku)}" required></label>
        <label class="field"><span>Size</span><input name="size" value="${escapeHtml(variant.size)}"></label>
        <label class="field"><span>Colour</span><input name="colour" value="${escapeHtml(variant.colour)}"></label>
        <label class="field"><span>Style</span><input name="style" value="${escapeHtml(variant.style)}"></label>
        <label class="toggle"><input name="active" type="checkbox" ${variant.active ? 'checked' : ''}><span>Active</span></label>
        <button type="submit" class="button button-secondary">Save option</button>
      </form>
      <form class="stock-adjust" data-stock-form="${Number(variant.id)}">
        <input type="hidden" name="version" value="${Number(variant.version)}">
        <div><p class="stock-current">Current stock<br><strong>${Number(variant.stockQuantity)}</strong></p></div>
        <label class="field"><span>Adjustment</span><select name="type"><option value="set">Set exact</option><option value="increase">Increase</option><option value="decrease">Decrease</option></select></label>
        <label class="field"><span>Quantity</span><input name="quantity" type="number" min="0" step="1" required></label>
        <label class="field"><span>Reason</span><input name="reason" maxlength="300" placeholder="Stock count, new delivery..." required></label>
        <button type="submit" class="button button-primary">Update stock</button>
      </form>
    </article>`).join('');
}

function fillProductForm(product) {
  const form = document.getElementById('product-form');
  form.elements.id.value = product.id;
  form.elements.version.value = product.version;
  form.elements.name.value = product.name;
  form.elements.description.value = product.description;
  form.elements.category.value = product.category;
  form.elements.productType.value = product.productType;
  form.elements.badge.value = product.badge;
  form.elements.price.value = (product.priceCents / 100).toFixed(2);
  form.elements.active.checked = product.active;
  form.elements.availableForSale.checked = product.availableForSale;
  form.elements.featured.checked = product.featured;
  form.elements.trackInventory.checked = product.trackInventory;
  form.elements.allowPlayerName.checked = product.allowPlayerName;
  form.elements.allowPlayerNumber.checked = product.allowPlayerNumber;
  form.elements.playerNamePrice.value = (product.playerNamePriceCents / 100).toFixed(2);
  form.elements.playerNumberPrice.value = (product.playerNumberPriceCents / 100).toFixed(2);
  form.elements.images.value = product.images.map(image => image.path).join('\n');
  document.getElementById('product-modal-title').textContent = product.name;
  const preview = document.getElementById('product-image-preview');
  preview.innerHTML = product.images[0] ? `<img src="${escapeHtml(product.images[0].path)}" alt="${escapeHtml(product.name)} preview">` : '';
  renderVariantList(product);
}

async function openProduct(productId) {
  clearStatus(document.getElementById('product-modal-status'));
  modal('product', true);
  document.getElementById('product-modal-title').textContent = 'Loading product...';
  try {
    const result = await api(`/products/${encodeURIComponent(productId)}`);
    state.currentProduct = result.product;
    fillProductForm(result.product);
  } catch (error) {
    setStatus(document.getElementById('product-modal-status'), 'error', error.message);
  }
}

async function refreshCurrentProduct(message = '') {
  const result = await api(`/products/${encodeURIComponent(state.currentProduct.id)}`);
  state.currentProduct = result.product;
  fillProductForm(result.product);
  if (message) setStatus(document.getElementById('product-modal-status'), 'success', message);
}

async function saveProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const becomesUnavailable = state.currentProduct && ((state.currentProduct.active && !form.elements.active.checked) || (state.currentProduct.availableForSale && !form.elements.availableForSale.checked));
  if (becomesUnavailable && !window.confirm('This will remove the product from sale. Continue?')) return;
  const images = form.elements.images.value.split(/\r?\n/).map(path => path.trim()).filter(Boolean).map(path => ({ path, altText: form.elements.name.value.trim() }));
  const body = {
    version: Number(form.elements.version.value),
    name: form.elements.name.value,
    description: form.elements.description.value,
    category: form.elements.category.value,
    productType: form.elements.productType.value,
    badge: form.elements.badge.value,
    priceCents: Math.round(Number(form.elements.price.value) * 100),
    active: form.elements.active.checked,
    availableForSale: form.elements.availableForSale.checked,
    featured: form.elements.featured.checked,
    trackInventory: form.elements.trackInventory.checked,
    allowPlayerName: form.elements.allowPlayerName.checked,
    allowPlayerNumber: form.elements.allowPlayerNumber.checked,
    playerNamePriceCents: Math.round(Number(form.elements.playerNamePrice.value || 0) * 100),
    playerNumberPriceCents: Math.round(Number(form.elements.playerNumberPrice.value || 0) * 100),
    images
  };
  try {
    const result = await api(`/products/${encodeURIComponent(body.id || state.currentProduct.id)}`, { method: 'PUT', body: JSON.stringify(body) });
    state.currentProduct = result.product;
    fillProductForm(result.product);
    setStatus(document.getElementById('product-modal-status'), 'success', 'Product saved successfully.');
    await loadProducts();
  } catch (error) { setStatus(document.getElementById('product-modal-status'), 'error', error.message); }
}

async function saveVariant(form) {
  const variantId = Number(form.dataset.variantForm);
  const body = {
    version: Number(form.elements.version.value), sku: form.elements.sku.value,
    size: form.elements.size.value, colour: form.elements.colour.value,
    style: form.elements.style.value, active: form.elements.active.checked
  };
  if (!body.active && !window.confirm('This option will no longer be selectable. Continue?')) return;
  await api(`/variants/${variantId}`, { method: 'PUT', body: JSON.stringify(body) });
  await refreshCurrentProduct('Variant saved successfully.');
}

async function adjustStock(form) {
  const variantId = Number(form.dataset.stockForm);
  const body = {
    version: Number(form.elements.version.value), type: form.elements.type.value,
    quantity: Number(form.elements.quantity.value), reason: form.elements.reason.value
  };
  await api(`/variants/${variantId}/adjust-stock`, { method: 'POST', body: JSON.stringify(body) });
  await refreshCurrentProduct('Stock updated and recorded in the audit history.');
}

async function addVariant(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = { sku: form.elements.sku.value, size: form.elements.size.value, colour: form.elements.colour.value, style: form.elements.style.value, active: form.elements.active.checked };
  await api(`/products/${encodeURIComponent(state.currentProduct.id)}/variants`, { method: 'POST', body: JSON.stringify(body) });
  form.reset(); form.elements.active.checked = true;
  await refreshCurrentProduct('Variant added successfully.');
}

async function openOrder(orderId) {
  modal('order', true);
  const container = document.getElementById('order-modal-content');
  container.innerHTML = empty('Loading order...');
  try {
    const result = await api(`/orders/${orderId}`);
    const order = result.order;
    state.currentOrder = order;
    document.getElementById('order-modal-title').textContent = order.order_number || `Order #${order.id}`;
    const address = order.shipping_address || {};
    const billing = order.billing_address || {};
    const formatAddress = value => [value.line1, value.line2, value.city, value.state, value.postal_code, value.country].filter(Boolean).join(', ') || 'Not provided';
    container.innerHTML = `
      <div class="order-actions"><a class="button button-secondary" href="/admin/invoice.html?order=${Number(order.id)}" target="_blank" rel="noopener">View Invoice</a><a class="button button-secondary" href="/admin/invoice.html?order=${Number(order.id)}&print=1" target="_blank" rel="noopener">Download PDF</a></div>
      <div class="order-summary">
        <div><span>Order number</span><strong>${escapeHtml(order.order_number || 'Pending')}</strong></div>
        <div><span>Invoice</span><strong>${escapeHtml(order.invoice_number || 'Created when viewed')}</strong></div>
        <div><span>Stripe reference</span><strong>${escapeHtml(order.stripe_checkout_session_id)}</strong></div>
        <div><span>Payment intent</span><strong>${escapeHtml(order.stripe_payment_intent_id || 'Not provided')}</strong></div>
        <div><span>Placed</span><strong>${escapeHtml(dateTime(order.created_at))}</strong></div>
        <div><span>Paid</span><strong>${escapeHtml(dateTime(order.payment_date))}</strong></div>
        <div><span>Customer</span><strong>${escapeHtml(order.customer_name || 'Not provided')}</strong></div>
        <div><span>Email</span><strong>${escapeHtml(order.customer_email || 'Not provided')}</strong></div>
        <div><span>Phone</span><strong>${escapeHtml(order.customer_phone || 'Not provided')}</strong></div>
        <div><span>Total</span><strong>${money(order.total_cents, order.currency)}</strong></div>
        <div><span>Payment</span><strong>${escapeHtml(order.payment_status)}</strong></div>
        <div><span>Shipping address</span><strong>${escapeHtml(formatAddress(address))}</strong></div>
        <div><span>Billing address</span><strong>${escapeHtml(formatAddress(billing))}</strong></div>
        <div><span>Refund</span><strong>${escapeHtml(order.refund_status)}</strong></div>
      </div>
      <div class="order-items"><h3>Items</h3>${(order.items || []).map(item => `<div class="order-item"><strong>${Number(item.quantity)} &times; ${escapeHtml(item.product_name)}</strong><br>${escapeHtml(item.sku)}${item.size ? `<br>Size: ${escapeHtml(item.size)}` : ''}${item.colour || item.style ? `<br>Colour/style: ${escapeHtml([item.colour,item.style].filter(Boolean).join(' / '))}` : ''}${item.player_name ? `<br>Player name: ${escapeHtml(item.player_name)}` : ''}${item.player_number ? `<br>Player number: ${escapeHtml(item.player_number)}` : ''}<br>Personalisation: ${money(item.customisation_total_cents, order.currency)}<br>${money(item.item_total_cents, order.currency)}</div>`).join('') || empty('No order items found.')}</div>
      <form id="fulfilment-form" class="fulfilment-form">
        <label class="field"><span>Fulfilment status</span><select name="status">${['paid','processing','ready_for_collection','shipped','completed','cancelled','refunded'].map(status => `<option value="${status}" ${order.fulfilment_status === status ? 'selected' : ''}>${status.replace(/_/g, ' ')}</option>`).join('')}</select></label>
        <label class="field"><span>Reason or note</span><input name="reason" maxlength="500" placeholder="Optional status note"></label>
        <label class="field field-wide"><span>Internal notes</span><textarea name="internalNotes" rows="3" maxlength="4000">${escapeHtml(order.internal_notes || '')}</textarea></label>
        <button type="submit" class="button button-primary">Update fulfilment</button>
      </form>
      <div class="order-history"><h3>Fulfilment history</h3>${(order.fulfilment_history || []).map(item => `<p><strong>${escapeHtml(item.previous_status)} &rarr; ${escapeHtml(item.new_status)}</strong><br>${escapeHtml(item.reason || 'No note')} &middot; ${escapeHtml(item.changed_by)} &middot; ${escapeHtml(dateTime(item.created_at))}</p>`).join('') || empty('No status changes recorded.')}</div>
      <div class="order-history"><h3>Related stock movements</h3>${(order.stock_movements || []).map(item => `<p><strong>${escapeHtml(item.product_name)} ${Number(item.change_quantity)}</strong><br>${escapeHtml(item.reason)} &middot; ${escapeHtml(dateTime(item.created_at))}</p>`).join('') || empty('No related stock movements.')}</div>`;
  } catch (error) { container.innerHTML = empty(error.message); }
}

async function saveFulfilment(form) {
  const result = await api(`/orders/${state.currentOrder.id}`, { method: 'PUT', body: JSON.stringify({ fulfilmentStatus: form.elements.status.value, reason: form.elements.reason.value, internalNotes: form.elements.internalNotes.value }) });
  state.currentOrder = result.order;
  setStatus(document.getElementById('global-status'), 'success', 'Order fulfilment status updated.');
  modal('order', false);
  await loadOrders();
}

document.addEventListener('click', event => {
  const themeButton = event.target.closest('[data-theme-toggle]');
  if (themeButton) applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  const viewButton = event.target.closest('[data-view-button]');
  if (viewButton) showView(viewButton.dataset.viewButton);
  const refreshButton = event.target.closest('[data-refresh]');
  if (refreshButton) showView(refreshButton.dataset.refresh);
  const productButton = event.target.closest('[data-product-id]');
  if (productButton) openProduct(productButton.dataset.productId);
  const orderButton = event.target.closest('[data-order-id]');
  if (orderButton) openOrder(Number(orderButton.dataset.orderId));
  const closeButton = event.target.closest('[data-close-modal]');
  if (closeButton) modal(closeButton.dataset.closeModal, false);
});

document.addEventListener('submit', async event => {
  try {
    if (event.target.id === 'product-form') return await saveProduct(event);
    if (event.target.id === 'add-variant-form') return await addVariant(event);
    if (event.target.id === 'fulfilment-form') { event.preventDefault(); return await saveFulfilment(event.target); }
    if (event.target.id === 'order-filters') { event.preventDefault(); return await loadOrders(); }
    if (event.target.id === 'movement-filters') { event.preventDefault(); return await loadMovements(); }
    if (event.target.matches('[data-variant-form]')) { event.preventDefault(); return await saveVariant(event.target); }
    if (event.target.matches('[data-stock-form]')) { event.preventDefault(); return await adjustStock(event.target); }
  } catch (error) {
    event.preventDefault();
    setStatus(document.getElementById('product-modal-status'), 'error', error.message);
  }
});

document.getElementById('order-filters').addEventListener('reset', () => setTimeout(loadOrders, 0));
document.getElementById('movement-filters').addEventListener('reset', () => setTimeout(loadMovements, 0));

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { modal('product', false); modal('order', false); }
});

(async function initialise() {
  applyTheme(document.documentElement.dataset.theme);
  try {
    await loadIdentity();
    await showView('dashboard');
  } catch (error) {
    setStatus(document.getElementById('global-status'), 'error', error.message);
  }
})();
