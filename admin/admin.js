const state = {
  activeView: 'dashboard',
  currentProduct: null,
  currentOrder: null,
  pictureProducts: [],
  currentPictureProduct: null
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
      <td><strong>${escapeHtml(order.order_number || `Order #${order.id}`)}</strong></td>
      <td><strong>${escapeHtml(order.customer_name || 'Not provided')}</strong><br><small>${escapeHtml(order.customer_email || '')}</small></td>
      <td>${money(order.total_cents, order.currency)}</td>
      <td>${badge(order.payment_status, order.payment_status === 'paid' ? 'success' : 'warning')}</td>
      <td>${badge(order.fulfilment_status, order.fulfilment_status === 'fulfilled' ? 'success' : 'neutral')}</td>
      <td>${order.invoice_number
        ? `<div class="invoice-actions">${badge(order.invoice_number, 'success')}<a class="button button-secondary button-small" href="/admin/invoice.html?order=${Number(order.id)}" target="_blank" rel="noopener">View</a><a class="button button-secondary button-small" href="/admin/invoice.html?order=${Number(order.id)}&print=1" target="_blank" rel="noopener">Download PDF</a><a class="button button-secondary button-small" href="/admin/invoice.html?order=${Number(order.id)}&print=1" target="_blank" rel="noopener">Print</a></div>`
        : `<button type="button" class="button button-secondary button-small" data-generate-invoice="${Number(order.id)}">Generate Invoice</button>`}</td>
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
      <td><div class="table-actions"><button type="button" class="button button-secondary button-small" data-product-id="${escapeHtml(product.id)}">Edit</button><button type="button" class="button button-secondary button-small" data-product-pictures="${escapeHtml(product.id)}">Pictures</button></div></td>
    </tr>`).join('')}</tbody></table>`;
}

function renderPicturesGrid() {
  const container = document.getElementById('pictures-grid');
  if (!state.pictureProducts.length) { container.innerHTML = empty('No products found.'); return; }
  container.innerHTML = state.pictureProducts.map(product => {
    const primary = product.pictures.find(picture => picture.isPrimary) || product.pictures[0];
    return `<article class="picture-product-card">
      <div class="picture-product-main">${primary ? `<img src="${escapeHtml(primary.url)}" alt="${escapeHtml(primary.altText)}">` : '<span>No image</span>'}</div>
      <div class="picture-product-copy"><h2>${escapeHtml(product.name)}</h2><p>${product.pictures.length} picture${product.pictures.length === 1 ? '' : 's'} &middot; ${product.pictures.some(picture => picture.storage === 'R2') ? 'R2 + fallback' : 'Static fallback'}</p></div>
      <button type="button" class="button button-secondary" data-manage-pictures="${escapeHtml(product.id)}">Manage Pictures</button>
    </article>`;
  }).join('');
}

async function loadPictures() {
  const container = document.getElementById('pictures-grid');
  container.innerHTML = empty('Loading pictures...');
  const result = await api('/pictures');
  state.pictureProducts = result.products;
  const status = document.getElementById('pictures-storage-status');
  if (result.storageReady) clearStatus(status);
  else setStatus(status, 'warning', 'Existing static pictures are safe. New uploads will become available after the PRODUCT_IMAGES R2 binding is enabled.');
  renderPicturesGrid();
}

function renderPictureManager() {
  const product = state.currentPictureProduct;
  const container = document.getElementById('picture-manager-list');
  if (!product || !product.pictures.length) { container.innerHTML = empty('No pictures are available.'); return; }
  container.innerHTML = product.pictures.map((picture, index) => `<article class="picture-row" data-picture-row="${Number(picture.id)}">
    <img src="${escapeHtml(picture.url)}" alt="${escapeHtml(picture.altText)}">
    <form class="picture-meta-form" data-picture-meta="${Number(picture.id)}">
      <label class="field"><span>Alt text</span><input name="altText" value="${escapeHtml(picture.altText)}" maxlength="200" required></label>
      <label class="field"><span>Gallery style</span><input name="variantStyle" value="${escapeHtml(picture.variantStyle)}" maxlength="80" placeholder="Optional"></label>
      <div class="picture-badges">${picture.isPrimary ? badge('Main image', 'success') : ''} ${badge(picture.storage, 'neutral')}</div>
      <div class="picture-actions">
        <button type="submit" class="button button-secondary button-small">Save details</button>
        ${picture.isPrimary ? '' : `<button type="button" class="button button-secondary button-small" data-set-primary="${Number(picture.id)}">Set as main</button>`}
        <button type="button" class="icon-button" data-move-picture="${Number(picture.id)}" data-direction="-1" aria-label="Move picture earlier" ${index === 0 ? 'disabled' : ''}>&uarr;</button>
        <button type="button" class="icon-button" data-move-picture="${Number(picture.id)}" data-direction="1" aria-label="Move picture later" ${index === product.pictures.length - 1 ? 'disabled' : ''}>&darr;</button>
        ${picture.storage === 'R2' ? `<button type="button" class="button button-secondary button-small" data-replace-picture="${Number(picture.id)}">Replace</button>` : ''}
        <button type="button" class="button button-danger button-small" data-remove-picture="${Number(picture.id)}">Remove</button>
      </div>
    </form>
  </article>`).join('');
}

function openPicturesManager(productId) {
  const product = state.pictureProducts.find(item => item.id === productId);
  if (!product) return;
  state.currentPictureProduct = product;
  document.getElementById('pictures-modal-title').textContent = product.name;
  const form = document.getElementById('picture-upload-form');
  form.reset(); form.elements.replacePictureId.value = '';
  form.elements.altText.value = product.name;
  form.querySelector('[type="submit"]').textContent = 'Upload Picture';
  form.querySelector('[data-cancel-replace]').hidden = true;
  document.getElementById('picture-upload-preview').hidden = true;
  clearStatus(document.getElementById('pictures-modal-status'));
  renderPictureManager();
  modal('pictures', true);
}

function syncCurrentPictures(pictures) {
  state.currentPictureProduct.pictures = pictures;
  const index = state.pictureProducts.findIndex(product => product.id === state.currentPictureProduct.id);
  if (index >= 0) state.pictureProducts[index] = state.currentPictureProduct;
  renderPictureManager();
  renderPicturesGrid();
}

function uploadPicture(form) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const progress = form.querySelector('.upload-progress');
    const bar = progress.querySelector('span');
    const button = form.querySelector('[type="submit"]');
    progress.hidden = false; bar.style.width = '0%'; button.disabled = true;
    xhr.open('POST', `/api/admin/products/${encodeURIComponent(state.currentPictureProduct.id)}/pictures`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-PTG-Admin-Request', '1');
    xhr.upload.addEventListener('progress', event => { if (event.lengthComputable) bar.style.width = `${Math.round(event.loaded / event.total * 100)}%`; });
    xhr.addEventListener('load', () => {
      button.disabled = false;
      const result = (() => { try { return JSON.parse(xhr.responseText); } catch { return {}; } })();
      if (xhr.status >= 200 && xhr.status < 300 && result.ok) resolve(result);
      else reject(new Error(result.error || 'The picture could not be uploaded.'));
    });
    xhr.addEventListener('error', () => { button.disabled = false; reject(new Error('The picture upload was interrupted.')); });
    xhr.send(new FormData(form));
  });
}

async function savePictureMeta(form) {
  const result = await api(`/pictures/${Number(form.dataset.pictureMeta)}`, { method: 'PUT', body: JSON.stringify({ altText: form.elements.altText.value, variantStyle: form.elements.variantStyle.value }) });
  syncCurrentPictures(result.pictures);
  setStatus(document.getElementById('pictures-modal-status'), 'success', 'Picture details saved.');
}

async function reorderPicture(pictureId, direction) {
  const pictures = [...state.currentPictureProduct.pictures];
  const index = pictures.findIndex(picture => picture.id === pictureId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= pictures.length) return;
  [pictures[index], pictures[target]] = [pictures[target], pictures[index]];
  const result = await api(`/products/${encodeURIComponent(state.currentPictureProduct.id)}/pictures/reorder`, { method: 'POST', body: JSON.stringify({ pictureIds: pictures.map(picture => picture.id) }) });
  syncCurrentPictures(result.pictures);
}

async function generateInvoice(orderId) {
  await api(`/orders/${orderId}/invoice`, { method: 'POST', body: '{}' });
  await loadOrders();
  if (state.activeView === 'dashboard') await loadDashboard();
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
  const loaders = { dashboard: loadDashboard, products: loadProducts, pictures: loadPictures, orders: loadOrders, movements: loadMovements };
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
        <label class="field"><span>Player name</span><select name="allowPlayerName"><option value="" ${variant.allowPlayerName === null ? 'selected' : ''}>Inherit product</option><option value="true" ${variant.allowPlayerName === true ? 'selected' : ''}>Allow</option><option value="false" ${variant.allowPlayerName === false ? 'selected' : ''}>Disallow</option></select></label>
        <label class="field"><span>Player number</span><select name="allowPlayerNumber"><option value="" ${variant.allowPlayerNumber === null ? 'selected' : ''}>Inherit product</option><option value="true" ${variant.allowPlayerNumber === true ? 'selected' : ''}>Allow</option><option value="false" ${variant.allowPlayerNumber === false ? 'selected' : ''}>Disallow</option></select></label>
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
  document.getElementById('product-modal-title').textContent = product.name;
  document.querySelector('[data-product-submit]').textContent = 'Save Product';
  document.querySelector('[data-manage-current-pictures]').hidden = false;
  document.getElementById('product-variants-section').hidden = false;
  const preview = document.getElementById('product-image-preview');
  preview.innerHTML = product.images[0] ? `<img src="${escapeHtml(product.images[0].path)}" alt="${escapeHtml(product.name)} preview">` : '';
  renderVariantList(product);
}

function newProduct() {
  state.currentProduct = null;
  clearStatus(document.getElementById('product-modal-status'));
  const form = document.getElementById('product-form');
  form.reset();
  form.elements.id.value = '';
  form.elements.version.value = '';
  form.elements.price.value = '0.00';
  form.elements.playerNamePrice.value = '0.00';
  form.elements.playerNumberPrice.value = '0.00';
  form.elements.active.checked = false;
  form.elements.availableForSale.checked = false;
  form.elements.featured.checked = false;
  document.getElementById('product-modal-title').textContent = 'New Product';
  document.getElementById('product-image-preview').innerHTML = '';
  document.getElementById('variant-list').innerHTML = empty('Create the draft product before adding variants and stock.');
  document.getElementById('product-variants-section').hidden = true;
  document.querySelector('[data-manage-current-pictures]').hidden = true;
  document.querySelector('[data-product-submit]').textContent = 'Create Draft Product';
  modal('product', true);
  form.elements.name.focus();
}

async function manageProductPictures(productId) {
  if (!state.pictureProducts.length || !state.pictureProducts.find(product => product.id === productId)) {
    const result = await api('/pictures');
    state.pictureProducts = result.products;
  }
  modal('product', false);
  openPicturesManager(productId);
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
  const body = {
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
    playerNumberPriceCents: Math.round(Number(form.elements.playerNumberPrice.value || 0) * 100)
  };
  if (state.currentProduct) body.version = Number(form.elements.version.value);
  try {
    const isCreating = !state.currentProduct;
    const result = await api(isCreating ? '/products' : `/products/${encodeURIComponent(state.currentProduct.id)}`, { method: isCreating ? 'POST' : 'PUT', body: JSON.stringify(body) });
    state.currentProduct = result.product;
    fillProductForm(result.product);
    setStatus(document.getElementById('product-modal-status'), 'success', isCreating ? 'Draft product created. Add variants, stock and pictures before making it visible.' : 'Product saved successfully.');
    await loadProducts();
  } catch (error) { setStatus(document.getElementById('product-modal-status'), 'error', error.message); }
}

async function saveVariant(form) {
  const variantId = Number(form.dataset.variantForm);
  const body = {
    version: Number(form.elements.version.value), sku: form.elements.sku.value,
    size: form.elements.size.value, colour: form.elements.colour.value,
    style: form.elements.style.value, active: form.elements.active.checked,
    allowPlayerName: form.elements.allowPlayerName.value === '' ? null : form.elements.allowPlayerName.value === 'true',
    allowPlayerNumber: form.elements.allowPlayerNumber.value === '' ? null : form.elements.allowPlayerNumber.value === 'true'
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
  const body = { sku: form.elements.sku.value, size: form.elements.size.value, colour: form.elements.colour.value, style: form.elements.style.value, active: form.elements.active.checked, allowPlayerName: form.elements.allowPlayerName.value === '' ? null : form.elements.allowPlayerName.value === 'true', allowPlayerNumber: form.elements.allowPlayerNumber.value === '' ? null : form.elements.allowPlayerNumber.value === 'true' };
  await api(`/products/${encodeURIComponent(state.currentProduct.id)}/variants`, { method: 'POST', body: JSON.stringify(body) });
  form.reset(); form.elements.active.checked = true;
  await refreshCurrentProduct('Variant added successfully.');
}

function technicalReference(label, value, stripeType) {
  if (!value) return '';
  const text = String(value);
  const masked = `${text.slice(0, Math.min(text.indexOf('_') + 1 || 4, 8))}${'\u2022'.repeat(12)}${text.slice(-4)}`;
  const mode = text.includes('_test_') ? 'test/' : '';
  const stripeUrl = stripeType === 'payment'
    ? `https://dashboard.stripe.com/${mode}payments/${encodeURIComponent(text)}`
    : stripeType === 'event'
      ? `https://dashboard.stripe.com/${mode}events/${encodeURIComponent(text)}`
      : `https://dashboard.stripe.com/${mode}checkout/sessions/${encodeURIComponent(text)}`;
  return `<div class="technical-reference"><span>${escapeHtml(label)}</span><code data-masked="${escapeHtml(masked)}" data-full="${escapeHtml(text)}">${escapeHtml(masked)}</code><div><button type="button" class="button button-secondary button-small" data-show-reference>Show</button><button type="button" class="button button-secondary button-small" data-copy-reference="${escapeHtml(text)}">Copy</button><a class="button button-secondary button-small" href="${stripeUrl}" target="_blank" rel="noopener">Open in Stripe</a></div></div>`;
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
      <div class="order-actions">${order.invoice_number
        ? `<a class="button button-secondary" href="/admin/invoice.html?order=${Number(order.id)}" target="_blank" rel="noopener">View Invoice</a><a class="button button-secondary" href="/admin/invoice.html?order=${Number(order.id)}&print=1" target="_blank" rel="noopener">Download PDF</a><a class="button button-secondary" href="/admin/invoice.html?order=${Number(order.id)}&print=1" target="_blank" rel="noopener">Print</a>`
        : `<button type="button" class="button button-primary" data-generate-invoice="${Number(order.id)}">Generate Invoice</button>`}</div>
      <div class="order-summary">
        <div><span>Order number</span><strong>${escapeHtml(order.order_number || 'Pending')}</strong></div>
        <div><span>Invoice</span><strong>${escapeHtml(order.invoice_number || 'Created when viewed')}</strong></div>
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
      <details class="technical-details"><summary>Payment Technical Details</summary><div class="technical-details-content">
        ${technicalReference('Checkout Session', order.stripe_checkout_session_id, 'session')}
        ${technicalReference('Payment Intent', order.stripe_payment_intent_id, 'payment')}
        ${technicalReference('Stripe Event', order.stripe_event_id, 'event')}
        <div class="technical-reference"><span>Payment status</span><strong>${escapeHtml(order.payment_status)}</strong></div>
        <div class="technical-reference"><span>Payment date</span><strong>${escapeHtml(dateTime(order.payment_date))}</strong></div>
      </div></details>
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
  const newProductButton = event.target.closest('[data-new-product]');
  if (newProductButton) newProduct();
  const productPictures = event.target.closest('[data-product-pictures]');
  if (productPictures) manageProductPictures(productPictures.dataset.productPictures).catch(error => setStatus(document.getElementById('global-status'), 'error', error.message));
  const currentPictures = event.target.closest('[data-manage-current-pictures]');
  if (currentPictures && state.currentProduct) manageProductPictures(state.currentProduct.id).catch(error => setStatus(document.getElementById('product-modal-status'), 'error', error.message));
  const orderButton = event.target.closest('[data-order-id]');
  if (orderButton) openOrder(Number(orderButton.dataset.orderId));
  const invoiceButton = event.target.closest('[data-generate-invoice]');
  if (invoiceButton) generateInvoice(Number(invoiceButton.dataset.generateInvoice)).catch(error => setStatus(document.getElementById('global-status'), 'error', error.message));
  const managePictures = event.target.closest('[data-manage-pictures]');
  if (managePictures) openPicturesManager(managePictures.dataset.managePictures);
  const setPrimary = event.target.closest('[data-set-primary]');
  if (setPrimary) api(`/pictures/${Number(setPrimary.dataset.setPrimary)}/set-primary`, { method: 'POST', body: '{}' }).then(result => { syncCurrentPictures(result.pictures); setStatus(document.getElementById('pictures-modal-status'), 'success', 'Main picture updated.'); }).catch(error => setStatus(document.getElementById('pictures-modal-status'), 'error', error.message));
  const movePicture = event.target.closest('[data-move-picture]');
  if (movePicture) reorderPicture(Number(movePicture.dataset.movePicture), Number(movePicture.dataset.direction)).catch(error => setStatus(document.getElementById('pictures-modal-status'), 'error', error.message));
  const replacePicture = event.target.closest('[data-replace-picture]');
  if (replacePicture) {
    const form = document.getElementById('picture-upload-form');
    form.elements.replacePictureId.value = replacePicture.dataset.replacePicture;
    form.querySelector('[type="submit"]').textContent = 'Replace Picture';
    form.querySelector('[data-cancel-replace]').hidden = false;
    form.elements.file.focus();
  }
  const cancelReplace = event.target.closest('[data-cancel-replace]');
  if (cancelReplace) { const form = document.getElementById('picture-upload-form'); form.elements.replacePictureId.value = ''; form.querySelector('[type="submit"]').textContent = 'Upload Picture'; cancelReplace.hidden = true; }
  const removePicture = event.target.closest('[data-remove-picture]');
  if (removePicture && window.confirm('Remove this picture from the product gallery?')) api(`/pictures/${Number(removePicture.dataset.removePicture)}`, { method: 'DELETE', body: '{}' }).then(result => { syncCurrentPictures(result.pictures); setStatus(document.getElementById('pictures-modal-status'), 'success', 'Picture removed.'); }).catch(error => setStatus(document.getElementById('pictures-modal-status'), 'error', error.message));
  const showReference = event.target.closest('[data-show-reference]');
  if (showReference) { const code = showReference.closest('.technical-reference').querySelector('code'); const showing = showReference.textContent === 'Hide'; code.textContent = showing ? code.dataset.masked : code.dataset.full; showReference.textContent = showing ? 'Show' : 'Hide'; }
  const copyReference = event.target.closest('[data-copy-reference]');
  if (copyReference) navigator.clipboard.writeText(copyReference.dataset.copyReference).then(() => { copyReference.textContent = 'Copied'; setTimeout(() => { copyReference.textContent = 'Copy'; }, 1400); });
  const closeButton = event.target.closest('[data-close-modal]');
  if (closeButton) modal(closeButton.dataset.closeModal, false);
});

document.addEventListener('submit', async event => {
  try {
    if (event.target.id === 'product-form') return await saveProduct(event);
    if (event.target.id === 'picture-upload-form') { event.preventDefault(); const result = await uploadPicture(event.target); syncCurrentPictures(result.pictures); event.target.reset(); event.target.elements.altText.value = state.currentPictureProduct.name; event.target.elements.replacePictureId.value = ''; event.target.querySelector('[type="submit"]').textContent = 'Upload Picture'; event.target.querySelector('[data-cancel-replace]').hidden = true; event.target.querySelector('.upload-progress').hidden = true; document.getElementById('picture-upload-preview').hidden = true; return setStatus(document.getElementById('pictures-modal-status'), 'success', 'Picture saved successfully.'); }
    if (event.target.matches('[data-picture-meta]')) { event.preventDefault(); return await savePictureMeta(event.target); }
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
document.getElementById('picture-upload-form').elements.file.addEventListener('change', event => {
  const preview = document.getElementById('picture-upload-preview');
  const file = event.target.files[0];
  if (!file) { preview.hidden = true; return; }
  const url = URL.createObjectURL(file);
  preview.innerHTML = `<img src="${url}" alt="Selected picture preview">`;
  preview.hidden = false;
  preview.querySelector('img').addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
});

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
