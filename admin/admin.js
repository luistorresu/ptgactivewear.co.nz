const state = {
  csrfToken: '',
  products: [],
  currentProduct: null,
  pictures: [],
  pictureProductId: '',
  submitting: false,
  uploadRequestId: '',
  previewUrls: []
};

const views = [...document.querySelectorAll('[data-view]')];
const notice = document.querySelector('[data-notice]');
const productList = document.querySelector('[data-product-list]');
const productForm = document.querySelector('[data-product-form]');
const createVariants = document.querySelector('[data-create-variants]');
const createVariantTemplate = document.querySelector('[data-create-variant-template]');
const existingVariants = document.querySelector('[data-existing-variants]');
const pictureProduct = document.querySelector('[data-picture-product]');
const pictureGallery = document.querySelector('[data-picture-gallery]');
const pictureUploadForm = document.querySelector('[data-picture-upload-form]');
const picturePreview = document.querySelector('[data-picture-preview]');
const uploadProgress = document.querySelector('[data-upload-progress]');
let pendingPicturePromise = null;
let slugEdited = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function formatMoney(cents) {
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(Number(cents || 0) / 100);
}

function moneyToCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '');
}

function productStatus(product) {
  if (product.archived) return { key: 'archived', label: 'Archived' };
  if (product.active && product.availableForSale) return { key: 'active', label: 'Active' };
  return { key: 'draft', label: 'Draft' };
}

function showNotice(message, type = 'info', shouldFocus = false) {
  notice.textContent = message;
  notice.className = `notice${type === 'info' ? '' : ` notice-${type}`}`;
  notice.hidden = false;
  if (shouldFocus) notice.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
}

function clearNotice() {
  notice.hidden = true;
  notice.textContent = '';
}

function errorMessage(error) {
  const message = error?.message || 'The request could not be completed.';
  return error?.requestId ? `${message} Reference: ${error.requestId}` : message;
}

async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-PTG-Admin-Request', '1');
    headers.set('X-CSRF-Token', state.csrfToken);
    if (options.body !== undefined && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(path, { ...options, method, headers, credentials: 'same-origin' });
  if (response.status === 401) {
    window.location.replace('/admin/login');
    throw new Error('Your admin session has expired.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'The request could not be completed.');
    error.code = data.code || '';
    error.requestId = data.requestId || response.headers.get('x-request-id') || '';
    throw error;
  }
  return data;
}

function routeFor(viewName) {
  if (viewName === 'pictures') return `/admin/pictures${state.pictureProductId ? `?product=${encodeURIComponent(state.pictureProductId)}` : ''}`;
  if (viewName === 'editor') return state.currentProduct ? `/admin?edit=${encodeURIComponent(state.currentProduct.id)}` : '/admin?new=1';
  return '/admin';
}

function switchView(viewName, updateHistory = true) {
  views.forEach(view => { view.hidden = view.dataset.view !== viewName; });
  document.querySelectorAll('[data-view-target]').forEach(button => button.classList.toggle('is-active', button.dataset.viewTarget === viewName));
  if (updateHistory) history.pushState({}, '', routeFor(viewName));
  window.scrollTo({ top: 0, behavior: 'auto' });
}

async function loadSession() {
  const response = await fetch('/api/admin/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.ok) {
    window.location.replace('/admin/login');
    return false;
  }
  const data = await response.json();
  state.csrfToken = data.csrfToken;
  document.querySelector('[data-admin-username]').textContent = data.identity?.username || '';
  return Boolean(state.csrfToken);
}

async function loadProducts() {
  const data = await api('/api/admin/products');
  state.products = data.products || [];
  renderProducts();
  renderPictureProductOptions();
}

function renderProducts() {
  const search = document.querySelector('[data-product-search]').value.trim().toLowerCase();
  const filter = document.querySelector('[data-product-filter]').value;
  const products = state.products.filter(product => {
    const status = productStatus(product).key;
    return (!search || product.name.toLowerCase().includes(search)) && (filter === 'all' || status === filter);
  });
  if (!products.length) {
    productList.innerHTML = '<div class="empty-state"><p>No products match this search and status filter.</p></div>';
    return;
  }
  productList.innerHTML = products.map(product => {
    const status = productStatus(product);
    const lifecycleAction = status.key === 'active' ? 'unpublish' : status.key === 'archived' ? 'restore' : 'publish';
    const lifecycleLabel = status.key === 'active' ? 'Unpublish' : status.key === 'archived' ? 'Restore' : 'Publish';
    return `<article class="product-row" data-product-id="${escapeHtml(product.id)}">
      <div class="product-thumb">${product.primaryImage ? `<img src="${escapeHtml(product.primaryImage)}" alt="" loading="lazy">` : '<span>No picture</span>'}</div>
      <div class="product-name"><strong>${escapeHtml(product.name)}</strong><small>/${escapeHtml(product.slug)}</small></div>
      <div class="product-meta"><span>Price</span><strong>${formatMoney(product.priceCents)}</strong></div>
      <div class="product-meta"><span>Status</span><span class="status-pill status-${status.key}">${status.label}</span></div>
      <div class="product-meta"><span>Stock</span><strong>${Number(product.totalStock || 0)} across ${Number(product.variantCount || 0)} variant${Number(product.variantCount || 0) === 1 ? '' : 's'}</strong></div>
      <div class="row-actions">
        <button class="button button-secondary" type="button" data-product-action="edit">Edit</button>
        <button class="button button-secondary" type="button" data-product-action="pictures">Pictures</button>
        <button class="button button-secondary" type="button" data-product-action="${lifecycleAction}">${lifecycleLabel}</button>
        ${status.key !== 'archived' ? '<button class="button button-danger" type="button" data-product-action="archive">Archive</button>' : ''}
      </div>
    </article>`;
  }).join('');
}

function clearPreviewUrls() {
  state.previewUrls.forEach(url => URL.revokeObjectURL(url));
  state.previewUrls = [];
}

function addCreateVariant(values = {}) {
  const row = createVariantTemplate.content.firstElementChild.cloneNode(true);
  for (const [field, value] of Object.entries(values)) {
    const input = row.querySelector(`[data-variant-field="${field}"]`);
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = value;
  }
  row.querySelector('[data-remove-variant]').addEventListener('click', () => row.remove());
  createVariants.append(row);
}

function setField(name, value) {
  const field = productForm.elements.namedItem(name);
  if (!field) return;
  if (field.type === 'checkbox') field.checked = Boolean(value);
  else field.value = value ?? '';
}

function resetProductForm() {
  productForm.reset();
  state.currentProduct = null;
  slugEdited = false;
  setField('version', 1);
  setField('playerNamePrice', '20.00');
  setField('playerNumberPrice', '20.00');
  setField('trackInventory', true);
  createVariants.replaceChildren();
  addCreateVariant({ active: true, stockQuantity: 0 });
  existingVariants.replaceChildren();
  clearPreviewUrls();
  document.querySelector('[data-initial-previews]').replaceChildren();
  document.querySelector('[data-editor-title]').textContent = 'Add Product';
  document.querySelector('[data-editor-subtitle]').textContent = 'Create a draft first or publish after adding a valid picture and variant.';
  document.querySelector('[data-editor-status]').hidden = true;
  document.querySelector('[data-create-variants-section]').hidden = false;
  document.querySelector('[data-existing-variants-section]').hidden = true;
  document.querySelector('[data-initial-pictures-section]').hidden = false;
  document.querySelector('[data-create-actions]').hidden = false;
  document.querySelector('[data-edit-actions]').hidden = true;
}

function showNewProduct(updateHistory = true) {
  clearNotice();
  resetProductForm();
  switchView('editor', updateHistory);
  productForm.elements.name.focus();
}

function createVariantPayloads() {
  return [...createVariants.querySelectorAll('.variant-row')].map(row => ({
    sku: row.querySelector('[data-variant-field="sku"]').value.trim(),
    size: row.querySelector('[data-variant-field="size"]').value.trim(),
    colour: row.querySelector('[data-variant-field="colour"]').value.trim(),
    style: row.querySelector('[data-variant-field="style"]').value.trim(),
    stockQuantity: Number(row.querySelector('[data-variant-field="stockQuantity"]').value || 0),
    active: row.querySelector('[data-variant-field="active"]').checked,
    allowPlayerName: null,
    allowPlayerNumber: null
  }));
}

function productPayload(publishRequested = false) {
  const product = state.currentProduct;
  return {
    name: productForm.elements.name.value.trim(),
    slug: productForm.elements.slug.value.trim(),
    description: productForm.elements.description.value.trim(),
    category: productForm.elements.category.value.trim(),
    productType: productForm.elements.productType.value.trim(),
    badge: productForm.elements.badge.value.trim(),
    priceCents: moneyToCents(productForm.elements.price.value),
    currency: 'NZD',
    seoTitle: product?.seoTitle || '',
    metaDescription: product?.metaDescription || '',
    active: product ? product.active : publishRequested,
    availableForSale: product ? product.availableForSale : publishRequested,
    featured: productForm.elements.featured.checked,
    trackInventory: productForm.elements.trackInventory.checked,
    allowPlayerName: productForm.elements.allowPlayerName.checked,
    allowPlayerNumber: productForm.elements.allowPlayerNumber.checked,
    playerNamePriceCents: moneyToCents(productForm.elements.playerNamePrice.value || 0),
    playerNumberPriceCents: moneyToCents(productForm.elements.playerNumberPrice.value || 0),
    version: Number(productForm.elements.version.value || 1)
  };
}

function validateNewProduct(publishRequested, files, variants) {
  if (!productForm.reportValidity()) return 'Complete the required product fields.';
  if (publishRequested && !files.length) return 'Choose at least one product image before publishing.';
  if (publishRequested && !variants.length) return 'Add at least one variant before publishing.';
  for (const [index, variant] of variants.entries()) {
    if (!variant.sku) return `Variant ${index + 1} needs a SKU.`;
    if (!variant.size && !variant.colour && !variant.style) return `Variant ${index + 1} needs a size, colour or style.`;
    if (!Number.isInteger(variant.stockQuantity) || variant.stockQuantity < 0) return `Variant ${index + 1} stock must be a non-negative whole number.`;
  }
  for (const file of files) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return `${file.name} is not a supported JPEG, PNG or WebP image.`;
    if (file.size > 8 * 1024 * 1024) return `${file.name} is larger than 8 MB.`;
  }
  return '';
}

function renderInitialPreviews(files) {
  clearPreviewUrls();
  const container = document.querySelector('[data-initial-previews]');
  container.replaceChildren();
  for (const file of files) {
    const url = URL.createObjectURL(file);
    state.previewUrls.push(url);
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.innerHTML = `<img src="${url}" alt="Preview of ${escapeHtml(file.name)}">`;
    container.append(item);
  }
}

function renderExistingVariants(product) {
  if (!product.variants.length) {
    existingVariants.innerHTML = '<div class="empty-state"><p>No variants yet. Add one below.</p></div>';
  } else {
    existingVariants.innerHTML = product.variants.map(variant => `<div class="variant-row" data-existing-variant-id="${variant.id}">
      <label><span>SKU</span><input data-field="sku" value="${escapeHtml(variant.sku)}"></label>
      <label><span>Size</span><input data-field="size" value="${escapeHtml(variant.size)}"></label>
      <label><span>Colour</span><input data-field="colour" value="${escapeHtml(variant.colour)}"></label>
      <label><span>Style</span><input data-field="style" value="${escapeHtml(variant.style)}"></label>
      <label><span>Stock</span><input data-field="stock" type="number" min="0" step="1" value="${Number(variant.stockQuantity)}"></label>
      <label class="check-field"><input data-field="active" type="checkbox" ${variant.active ? 'checked' : ''}><span>Active</span></label>
      <button class="button button-secondary" type="button" data-save-variant>Save</button>
    </div>`).join('');
  }
  const addRow = document.querySelector('[data-add-variant-row]');
  addRow.innerHTML = `<label><span>SKU</span><input data-field="sku" maxlength="80"></label>
    <label><span>Size</span><input data-field="size" maxlength="50"></label>
    <label><span>Colour</span><input data-field="colour" maxlength="80"></label>
    <label><span>Style</span><input data-field="style" maxlength="80"></label>
    <label><span>Starting stock</span><input data-field="stock" type="number" min="0" step="1" value="0"></label>
    <label class="check-field"><input data-field="active" type="checkbox" checked><span>Active</span></label>`;
}

function populateProductForm(product) {
  state.currentProduct = product;
  setField('productId', product.id);
  setField('version', product.version);
  setField('name', product.name);
  setField('slug', product.slug);
  setField('description', product.description);
  setField('category', product.category);
  setField('productType', product.productType);
  setField('badge', product.badge);
  setField('price', (product.priceCents / 100).toFixed(2));
  setField('featured', product.featured);
  setField('trackInventory', product.trackInventory);
  setField('allowPlayerName', product.allowPlayerName);
  setField('allowPlayerNumber', product.allowPlayerNumber);
  setField('playerNamePrice', (product.playerNamePriceCents / 100).toFixed(2));
  setField('playerNumberPrice', (product.playerNumberPriceCents / 100).toFixed(2));
  document.querySelector('[data-editor-title]').textContent = product.name;
  document.querySelector('[data-editor-subtitle]').textContent = 'Update product information, variants, stock and availability.';
  const status = productStatus(product);
  const statusElement = document.querySelector('[data-editor-status]');
  statusElement.textContent = status.label;
  statusElement.className = `status-pill status-${status.key}`;
  statusElement.hidden = false;
  document.querySelector('[data-create-variants-section]').hidden = true;
  document.querySelector('[data-existing-variants-section]').hidden = false;
  document.querySelector('[data-initial-pictures-section]').hidden = true;
  document.querySelector('[data-create-actions]').hidden = true;
  document.querySelector('[data-edit-actions]').hidden = false;
  const publicLink = document.querySelector('[data-view-public]');
  publicLink.href = `/products/${encodeURIComponent(product.slug)}`;
  publicLink.hidden = status.key !== 'active';
  const lifecycleButton = document.querySelector('[data-editor-lifecycle]');
  lifecycleButton.dataset.action = status.key === 'active' ? 'unpublish' : 'publish';
  lifecycleButton.textContent = status.key === 'active' ? 'Unpublish' : 'Publish';
  lifecycleButton.hidden = status.key === 'archived';
  const archiveButton = document.querySelector('[data-editor-archive]');
  archiveButton.dataset.action = status.key === 'archived' ? 'restore' : 'archive';
  archiveButton.textContent = status.key === 'archived' ? 'Restore Product' : 'Archive Product';
  document.querySelector('[data-permanent-delete]').hidden = status.key !== 'archived';
  renderExistingVariants(product);
}

async function openEditor(productId, updateHistory = true) {
  clearNotice();
  const data = await api(`/api/admin/products/${encodeURIComponent(productId)}`);
  populateProductForm(data.product);
  switchView('editor', updateHistory);
}

async function productLifecycle(productId, action) {
  const labels = { publish: 'publish', unpublish: 'unpublish', archive: 'archive', restore: 'restore' };
  if (action === 'archive' && !confirm('Archive this product? It will be removed from the public shop but its history will be kept.')) return;
  const data = await api(`/api/admin/products/${encodeURIComponent(productId)}/${action}`, { method: 'POST', body: '{}' });
  await loadProducts();
  if (state.currentProduct?.id === productId) populateProductForm(data.product);
  showNotice(data.message || `Product ${labels[action]}d.`, 'success');
}

async function saveNewProduct(publishRequested, submitter) {
  const files = [...productForm.elements.initialPictures.files];
  const variants = createVariantPayloads();
  const clientError = validateNewProduct(publishRequested, files, variants);
  if (clientError) {
    showNotice(clientError, 'error', true);
    return;
  }
  const originalText = submitter.textContent;
  submitter.disabled = true;
  submitter.textContent = publishRequested ? 'Publishing...' : 'Saving Draft...';
  state.submitting = true;
  let createdProduct;
  try {
    const payload = { ...productPayload(publishRequested), variants };
    const result = await api('/api/admin/products', { method: 'POST', body: JSON.stringify(payload) });
    createdProduct = result.product;
    for (const [index, file] of files.entries()) {
      submitter.textContent = `Uploading picture ${index + 1} of ${files.length}...`;
      await uploadPicture(createdProduct.id, file, createdProduct.name, '', '', () => {});
      state.uploadRequestId = '';
    }
    if (publishRequested) {
      submitter.textContent = 'Publishing...';
      const published = await api(`/api/admin/products/${encodeURIComponent(createdProduct.id)}/publish`, { method: 'POST', body: '{}' });
      createdProduct = published.product;
    }
    await loadProducts();
    await openEditor(createdProduct.id);
    showNotice(publishRequested ? 'Product published successfully.' : 'Draft product saved successfully.', 'success');
  } catch (error) {
    if (createdProduct) {
      await loadProducts().catch(() => {});
      await openEditor(createdProduct.id).catch(() => {});
      showNotice(`The product was saved safely as a draft, but the remaining step failed. ${errorMessage(error)}`, 'error', true);
    } else {
      showNotice(errorMessage(error), 'error', true);
    }
  } finally {
    state.submitting = false;
    submitter.disabled = false;
    submitter.textContent = originalText;
  }
}

async function saveExistingProduct(submitter) {
  if (!productForm.reportValidity()) return;
  const originalText = submitter.textContent;
  submitter.disabled = true;
  submitter.textContent = 'Saving...';
  state.submitting = true;
  try {
    const result = await api(`/api/admin/products/${encodeURIComponent(state.currentProduct.id)}`, {
      method: 'PUT', body: JSON.stringify(productPayload())
    });
    populateProductForm(result.product);
    await loadProducts();
    history.replaceState({}, '', routeFor('editor'));
    showNotice('Product details saved successfully.', 'success');
  } catch (error) {
    showNotice(errorMessage(error), 'error', true);
  } finally {
    state.submitting = false;
    submitter.disabled = false;
    submitter.textContent = originalText;
  }
}

async function saveExistingVariant(row, button) {
  const variantId = Number(row.dataset.existingVariantId);
  const current = state.currentProduct.variants.find(variant => variant.id === variantId);
  const desiredStock = Number(row.querySelector('[data-field="stock"]').value);
  if (!Number.isInteger(desiredStock) || desiredStock < 0) {
    showNotice('Stock must be a non-negative whole number.', 'error');
    return;
  }
  button.disabled = true;
  button.textContent = 'Saving...';
  try {
    const result = await api(`/api/admin/variants/${variantId}`, { method: 'PUT', body: JSON.stringify({
      sku: row.querySelector('[data-field="sku"]').value.trim(),
      size: row.querySelector('[data-field="size"]').value.trim(),
      colour: row.querySelector('[data-field="colour"]').value.trim(),
      style: row.querySelector('[data-field="style"]').value.trim(),
      active: row.querySelector('[data-field="active"]').checked,
      allowPlayerName: current.allowPlayerName,
      allowPlayerNumber: current.allowPlayerNumber,
      version: current.version
    }) });
    if (desiredStock !== current.stockQuantity) {
      await api(`/api/admin/variants/${variantId}/adjust-stock`, { method: 'POST', body: JSON.stringify({
        type: 'set', quantity: desiredStock, reason: 'Admin product editor update', version: result.variant.version
      }) });
    }
    await openEditor(state.currentProduct.id, false);
    await loadProducts();
    showNotice('Variant and stock saved successfully.', 'success');
  } catch (error) {
    showNotice(errorMessage(error), 'error', true);
    button.disabled = false;
    button.textContent = 'Save';
  }
}

async function addExistingVariant(button) {
  const row = document.querySelector('[data-add-variant-row]');
  const stock = Number(row.querySelector('[data-field="stock"]').value || 0);
  if (!Number.isInteger(stock) || stock < 0) {
    showNotice('Starting stock must be a non-negative whole number.', 'error');
    return;
  }
  button.disabled = true;
  try {
    const result = await api(`/api/admin/products/${encodeURIComponent(state.currentProduct.id)}/variants`, { method: 'POST', body: JSON.stringify({
      sku: row.querySelector('[data-field="sku"]').value.trim(),
      size: row.querySelector('[data-field="size"]').value.trim(),
      colour: row.querySelector('[data-field="colour"]').value.trim(),
      style: row.querySelector('[data-field="style"]').value.trim(),
      active: row.querySelector('[data-field="active"]').checked,
      allowPlayerName: null,
      allowPlayerNumber: null
    }) });
    const created = result.product.variants.find(variant => variant.sku === row.querySelector('[data-field="sku"]').value.trim().toUpperCase());
    if (stock && created) {
      await api(`/api/admin/variants/${created.id}/adjust-stock`, { method: 'POST', body: JSON.stringify({
        type: 'set', quantity: stock, reason: 'Initial stock from admin product editor', version: created.version
      }) });
    }
    await openEditor(state.currentProduct.id, false);
    await loadProducts();
    showNotice('Variant added successfully.', 'success');
  } catch (error) {
    showNotice(errorMessage(error), 'error', true);
    button.disabled = false;
  }
}

function renderPictureProductOptions() {
  const current = state.pictureProductId || pictureProduct.value;
  pictureProduct.innerHTML = state.products.map(product => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} (${productStatus(product).label})</option>`).join('');
  if (state.products.some(product => product.id === current)) pictureProduct.value = current;
  else if (state.products.length) pictureProduct.value = state.products[0].id;
}

async function openPictures(productId = '', updateHistory = true) {
  clearNotice();
  renderPictureProductOptions();
  state.pictureProductId = productId && state.products.some(product => product.id === productId) ? productId : pictureProduct.value;
  pictureProduct.value = state.pictureProductId;
  switchView('pictures', updateHistory);
  await loadPictures();
}

async function loadPictures() {
  if (!state.pictureProductId) {
    pictureGallery.innerHTML = '<div class="empty-state"><p>Create a product before uploading pictures.</p></div>';
    return;
  }
  const data = await api(`/api/admin/products/${encodeURIComponent(state.pictureProductId)}/pictures`);
  state.pictures = data.pictures || [];
  document.querySelector('[data-gallery-title]').textContent = data.product?.name || 'Product pictures';
  pictureUploadForm.elements.altText.value ||= data.product?.name || '';
  renderPictureGallery();
  history.replaceState({}, '', routeFor('pictures'));
}

function renderPictureGallery() {
  if (!state.pictures.length) {
    pictureGallery.innerHTML = '<div class="empty-state"><p>No pictures yet. Upload the first picture using the form.</p></div>';
    return;
  }
  pictureGallery.innerHTML = state.pictures.map((picture, index) => `<article class="gallery-card" data-picture-id="${picture.id}">
    <div class="gallery-image">
      <img src="${escapeHtml(picture.thumbnailUrl || picture.url)}" alt="${escapeHtml(picture.altText)}" loading="lazy">
      ${picture.isPrimary ? '<span class="status-pill status-active">Main picture</span>' : ''}
    </div>
    <div class="gallery-details">
      <strong>${escapeHtml(picture.altText || 'Product picture')}</strong>
      <small>${escapeHtml(picture.variantStyle || 'Gallery image')} | ${picture.storage}</small>
      <div class="gallery-actions">
        ${picture.isPrimary ? '' : '<button class="button button-secondary" type="button" data-picture-action="primary">Set Main</button>'}
        <button class="button button-secondary" type="button" data-picture-action="up" ${index === 0 ? 'disabled' : ''}>Move Up</button>
        <button class="button button-secondary" type="button" data-picture-action="down" ${index === state.pictures.length - 1 ? 'disabled' : ''}>Move Down</button>
        <button class="button button-secondary" type="button" data-picture-action="replace">Replace</button>
        <button class="button button-danger" type="button" data-picture-action="delete">Delete</button>
      </div>
    </div>
  </article>`).join('');
}

function resetPictureUpload() {
  pictureUploadForm.reset();
  pictureUploadForm.elements.replacePictureId.value = '';
  document.querySelector('[data-picture-file-label]').textContent = 'Choose a new picture';
  document.querySelector('[data-upload-button]').textContent = 'Upload Picture';
  document.querySelector('[data-cancel-replace]').hidden = true;
  picturePreview.innerHTML = '<span>No picture selected</span>';
  state.uploadRequestId = '';
  uploadProgress.hidden = true;
  uploadProgress.firstElementChild.style.width = '0%';
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The selected image could not be read.')); };
    image.src = url;
  });
}

async function optimisePicture(file) {
  const image = await loadImage(file);
  const scale = Math.min(1, 480 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
  return blob ? new File([blob], 'thumbnail.webp', { type: 'image/webp' }) : null;
}

async function uploadPicture(productId, file, altText, variantStyle, replacePictureId, onProgress) {
  if (!state.uploadRequestId) state.uploadRequestId = crypto.randomUUID();
  const requestId = state.uploadRequestId;
  const thumbnail = await optimisePicture(file);
  const form = new FormData();
  form.append('file', file);
  if (thumbnail) form.append('thumbnail', thumbnail);
  form.append('requestId', requestId);
  form.append('altText', altText);
  form.append('variantStyle', variantStyle);
  if (replacePictureId) form.append('replacePictureId', replacePictureId);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/admin/products/${encodeURIComponent(productId)}/pictures`);
    xhr.timeout = 90000;
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-PTG-Admin-Request', '1');
    xhr.setRequestHeader('X-CSRF-Token', state.csrfToken);
    xhr.setRequestHeader('X-Upload-Request-ID', requestId);
    xhr.setRequestHeader('X-Request-ID', requestId);
    xhr.upload.addEventListener('progress', event => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status === 401) {
        window.location.replace('/admin/login');
        reject(new Error('Your admin session has expired.'));
        return;
      }
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status < 200 || xhr.status >= 300) {
        const error = new Error(data.error || 'The picture upload could not be completed.');
        error.code = data.code || '';
        error.requestId = data.requestId || requestId;
        reject(error);
        return;
      }
      resolve(data);
    });
    xhr.addEventListener('timeout', () => {
      const error = new Error('The upload timed out. Check your connection and retry; the same upload reference will be reused safely.');
      error.requestId = requestId;
      reject(error);
    });
    xhr.addEventListener('error', () => {
      const error = new Error('A network error interrupted the upload. Please retry.');
      error.requestId = requestId;
      reject(error);
    });
    xhr.send(form);
  });
}

async function submitPictureUpload() {
  if (pendingPicturePromise) return pendingPicturePromise;
  const file = pictureUploadForm.elements.picture.files[0];
  if (!file) {
    showNotice('Choose a picture to upload.', 'error');
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    showNotice('Only JPEG, PNG and WebP pictures are supported.', 'error');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showNotice('The selected picture is larger than 8 MB.', 'error');
    return;
  }
  const button = document.querySelector('[data-upload-button]');
  const originalText = button.textContent;
  const replacing = Boolean(pictureUploadForm.elements.replacePictureId.value);
  button.disabled = true;
  button.textContent = 'Uploading...';
  uploadProgress.hidden = false;
  const promise = uploadPicture(
    state.pictureProductId,
    file,
    pictureUploadForm.elements.altText.value.trim(),
    pictureUploadForm.elements.variantStyle.value.trim(),
    pictureUploadForm.elements.replacePictureId.value,
    percentage => { uploadProgress.firstElementChild.style.width = `${percentage}%`; }
  );
  pendingPicturePromise = promise;
  try {
    await promise;
    state.uploadRequestId = '';
    resetPictureUpload();
    await loadPictures();
    await loadProducts();
    showNotice(replacing ? 'Picture replaced successfully.' : 'Picture uploaded successfully.', 'success');
  } catch (error) {
    showNotice(errorMessage(error), 'error', true);
  } finally {
    pendingPicturePromise = null;
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function handlePictureAction(pictureId, action) {
  const picture = state.pictures.find(item => item.id === pictureId);
  if (!picture) return;
  try {
    if (action === 'primary') await api(`/api/admin/pictures/${pictureId}/set-primary`, { method: 'POST', body: '{}' });
    if (action === 'delete') {
      if (!confirm('Delete this picture? This cannot be undone.')) return;
      await api(`/api/admin/pictures/${pictureId}`, { method: 'DELETE' });
    }
    if (action === 'replace') {
      pictureUploadForm.elements.replacePictureId.value = String(pictureId);
      pictureUploadForm.elements.altText.value = picture.altText;
      pictureUploadForm.elements.variantStyle.value = picture.variantStyle;
      document.querySelector('[data-picture-file-label]').textContent = 'Choose the replacement picture';
      document.querySelector('[data-upload-button]').textContent = 'Replace Picture';
      document.querySelector('[data-cancel-replace]').hidden = false;
      pictureUploadForm.elements.picture.focus();
      return;
    }
    if (action === 'up' || action === 'down') {
      const ids = state.pictures.map(item => item.id);
      const index = ids.indexOf(pictureId);
      const other = action === 'up' ? index - 1 : index + 1;
      if (other < 0 || other >= ids.length) return;
      [ids[index], ids[other]] = [ids[other], ids[index]];
      await api(`/api/admin/products/${encodeURIComponent(state.pictureProductId)}/pictures/reorder`, {
        method: 'POST', body: JSON.stringify({ pictureIds: ids })
      });
    }
    await loadPictures();
    await loadProducts();
    showNotice(action === 'delete' ? 'Picture deleted successfully.' : action === 'primary' ? 'Main picture updated.' : 'Picture order updated.', 'success');
  } catch (error) {
    showNotice(errorMessage(error), 'error', true);
  }
}

async function permanentlyDeleteCurrentProduct() {
  const product = state.currentProduct;
  if (!product?.archived) return;
  const confirmation = prompt(`Type DELETE to permanently remove ${product.name}. This is only allowed when it has no order or stock history and no active pictures.`);
  if (confirmation !== 'DELETE') return;
  try {
    const result = await api(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: 'DELETE' });
    state.currentProduct = null;
    await loadProducts();
    switchView('products');
    showNotice(result.message || 'Product permanently deleted.', 'success');
  } catch (error) {
    showNotice(errorMessage(error), 'error', true);
  }
}

document.querySelectorAll('[data-new-product]').forEach(button => button.addEventListener('click', () => showNewProduct()));
document.querySelector('[data-back-products]').addEventListener('click', () => switchView('products'));
document.querySelector('[data-add-create-variant]').addEventListener('click', () => addCreateVariant({ active: true, stockQuantity: 0 }));
document.querySelector('[data-product-search]').addEventListener('input', renderProducts);
document.querySelector('[data-product-filter]').addEventListener('change', renderProducts);

document.querySelectorAll('[data-view-target]').forEach(button => button.addEventListener('click', () => {
  const target = button.dataset.viewTarget;
  if (target === 'editor') showNewProduct();
  else if (target === 'pictures') openPictures();
  else switchView(target);
}));

productList.addEventListener('click', async event => {
  const button = event.target.closest('[data-product-action]');
  const row = event.target.closest('[data-product-id]');
  if (!button || !row) return;
  button.disabled = true;
  try {
    if (button.dataset.productAction === 'edit') await openEditor(row.dataset.productId);
    else if (button.dataset.productAction === 'pictures') await openPictures(row.dataset.productId);
    else await productLifecycle(row.dataset.productId, button.dataset.productAction);
  } catch (error) {
    showNotice(errorMessage(error), 'error', true);
  } finally {
    button.disabled = false;
  }
});

productForm.elements.name.addEventListener('input', () => {
  if (!state.currentProduct && !slugEdited) productForm.elements.slug.value = slugify(productForm.elements.name.value);
});
productForm.elements.slug.addEventListener('input', () => { slugEdited = true; });
productForm.elements.initialPictures.addEventListener('change', event => renderInitialPreviews([...event.target.files]));

productForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (state.submitting) return;
  clearNotice();
  if (state.currentProduct) await saveExistingProduct(event.submitter);
  else await saveNewProduct(event.submitter?.dataset.submitMode === 'publish', event.submitter);
});

existingVariants.addEventListener('click', event => {
  const button = event.target.closest('[data-save-variant]');
  const row = event.target.closest('[data-existing-variant-id]');
  if (button && row) saveExistingVariant(row, button);
});
document.querySelector('[data-create-variant]').addEventListener('click', event => addExistingVariant(event.currentTarget));
document.querySelector('[data-edit-pictures]').addEventListener('click', () => openPictures(state.currentProduct.id));
document.querySelector('[data-editor-lifecycle]').addEventListener('click', event => productLifecycle(state.currentProduct.id, event.currentTarget.dataset.action));
document.querySelector('[data-editor-archive]').addEventListener('click', event => productLifecycle(state.currentProduct.id, event.currentTarget.dataset.action));
document.querySelector('[data-permanent-delete]').addEventListener('click', permanentlyDeleteCurrentProduct);

pictureProduct.addEventListener('change', async () => {
  state.pictureProductId = pictureProduct.value;
  resetPictureUpload();
  await loadPictures().catch(error => showNotice(errorMessage(error), 'error'));
});
pictureUploadForm.elements.picture.addEventListener('change', event => {
  const file = event.target.files[0];
  state.uploadRequestId = crypto.randomUUID();
  if (!file) {
    picturePreview.innerHTML = '<span>No picture selected</span>';
    return;
  }
  const url = URL.createObjectURL(file);
  picturePreview.innerHTML = `<img src="${url}" alt="Selected picture preview">`;
  picturePreview.querySelector('img').addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
});
pictureUploadForm.addEventListener('submit', event => {
  event.preventDefault();
  submitPictureUpload();
});
document.querySelector('[data-cancel-replace]').addEventListener('click', resetPictureUpload);
pictureGallery.addEventListener('click', event => {
  const button = event.target.closest('[data-picture-action]');
  const card = event.target.closest('[data-picture-id]');
  if (button && card) handlePictureAction(Number(card.dataset.pictureId), button.dataset.pictureAction);
});

document.querySelector('[data-logout]').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); }
  finally { window.location.replace('/admin/login'); }
});

window.addEventListener('popstate', () => initialiseRoute(false));

async function initialiseRoute(updateHistory = false) {
  const url = new URL(window.location.href);
  if (url.pathname === '/admin/pictures') {
    await openPictures(url.searchParams.get('product') || '', updateHistory);
  } else if (url.searchParams.get('edit')) {
    await openEditor(url.searchParams.get('edit'), updateHistory);
  } else if (url.searchParams.has('new')) {
    showNewProduct(updateHistory);
  } else {
    switchView('products', updateHistory);
  }
}

async function initialise() {
  try {
    if (!await loadSession()) return;
    await loadProducts();
    await initialiseRoute(false);
  } catch (error) {
    showNotice(errorMessage(error), 'error', true);
  }
}

initialise();
