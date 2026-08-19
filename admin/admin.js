const state = {
  csrfToken: '',
  products: [],
  orders: [],
  promotions: [],
  currentOrder: null,
  reportPage: 1,
  reportTotal: 0,
  currentProduct: null,
  pictures: [],
  pictureProductId: '',
  submitting: false,
  uploadRequestId: '',
  previewUrls: []
};

const TRAINING_KIT_ID = 'patagonia-fc-training-kit';
const RESTRICTED_SHIRT_NUMBERS = new Set(['1', '7', '9', '10']);

const views = [...document.querySelectorAll('[data-view]')];
const notice = document.querySelector('[data-notice]');
const productList = document.querySelector('[data-product-list]');
const orderList = document.querySelector('[data-order-list]');
const orderDetail = document.querySelector('[data-order-detail]');
const reportFilters = document.querySelector('[data-report-filters]');
const reportSales = document.querySelector('[data-report-sales]');
const reportInvoices = document.querySelector('[data-report-invoices]');
const promotionList = document.querySelector('[data-promotion-list]');
const productForm = document.querySelector('[data-product-form]');
const createVariants = document.querySelector('[data-create-variants]');
const createVariantTemplate = document.querySelector('[data-create-variant-template]');
const existingVariants = document.querySelector('[data-existing-variants]');
const pictureProduct = document.querySelector('[data-picture-product]');
const pictureProductSearch = document.querySelector('[data-picture-product-search]');
const pictureProductStatus = document.querySelector('[data-picture-product-status]');
const pictureSelectedProduct = document.querySelector('[data-picture-selected-product]');
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

function restrictedNumberWasVerified(order, number) {
  const marker = String(order.internal_notes || '').match(/\[system:training-kit-restricted-number-verified=([0-9,]+)\]/);
  return Boolean(marker && marker[1].split(',').includes(String(number)));
}

function renderOrderItemDetails(item, order) {
  const details = [[item.size, item.colour, item.style].filter(Boolean).join(' / ')];
  const trainingKit = item.product_id === TRAINING_KIT_ID;
  const selectedOptions = Number(Boolean(item.player_name)) + Number(Boolean(item.player_number));
  const optionChargeCents = selectedOptions && Number(item.customisation_total_cents || 0) > 0
    ? Math.round(Number(item.customisation_total_cents) / Math.max(1, Number(item.quantity || 1)) / selectedOptions)
    : 0;
  const charge = optionChargeCents > 0 ? ` (+${formatMoney(optionChargeCents)})` : '';
  if (item.player_name) details.push(`Player Name: ${item.player_name}${charge}`);
  if (item.player_number) details.push(`${trainingKit ? 'Requested Shirt Number' : 'Player Number'}: ${item.player_number}${charge}`);
  if (trainingKit && (Number(item.restricted_number) === 1 || RESTRICTED_SHIRT_NUMBERS.has(item.player_number))) {
    const verified = Number(item.restricted_number_verified) === 1 || restrictedNumberWasVerified(order, item.player_number);
    details.push('Restricted number: Yes');
    details.push(`Restricted-number eligibility: ${verified ? 'Server verified' : 'Not recorded'}`);
  }
  if (trainingKit && (Number(item.number_subject_to_availability) === 1 || item.player_number)) details.push('Availability: Subject to final confirmation');
  return details.filter(Boolean).map(escapeHtml).join(' · ');
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

function restartAdminAuthentication() {
  window.location.replace(`${window.location.pathname}${window.location.search}`);
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
  const response = await fetch(path, { ...options, method, headers, credentials: 'same-origin', redirect: 'manual' });
  const contentType = response.headers.get('content-type') || '';
  if (response.type === 'opaqueredirect' || response.redirected || (response.ok && !contentType.includes('application/json'))) {
    restartAdminAuthentication();
    throw new Error('Your secure access session has expired.');
  }
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
  if (viewName === 'orders') return '/admin/orders';
  if (viewName === 'reports') return '/admin/reports';
  if (viewName === 'promotions') return '/admin/promotions';
  if (viewName === 'editor') return state.currentProduct ? `/admin?edit=${encodeURIComponent(state.currentProduct.id)}` : '/admin?new=1';
  return '/admin';
}

function reportQuery({ includePage = true } = {}) {
  const params = new URLSearchParams();
  const data = new FormData(reportFilters);
  for (const [key, value] of data.entries()) if (String(value).trim()) params.set(key, String(value).trim());
  if (includePage) {
    params.set('page', String(state.reportPage));
    params.set('limit', '50');
  }
  return params.toString();
}

function formatReportDate(value) {
  const parsed = new Date(String(value || '').replace(' ', 'T') + (String(value || '').includes('T') ? '' : 'Z'));
  return Number.isNaN(parsed.getTime()) ? String(value || '') : parsed.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderReportSummary(summary) {
  const values = [
    ['Total paid sales', summary.totalPaidCents], ['Paid orders', summary.paidOrders, true],
    ['Average order', summary.averageOrderCents], ['Shipping collected', summary.shippingCents],
    ['Processing surcharges', summary.surchargeCents], ['Refunded', summary.refundedCents],
    ['Net collected', summary.netCollectedCents]
  ];
  document.querySelector('[data-report-summary]').innerHTML = values.map(([label, value, count]) => `<article class="summary-card"><span>${escapeHtml(label)}</span><strong>${count ? Number(value || 0).toLocaleString('en-NZ') : formatMoney(value)}</strong></article>`).join('');
}

function renderReportSales(rows, total, page, limit) {
  document.querySelector('[data-sales-count]').textContent = `${total} matching order${total === 1 ? '' : 's'}`;
  document.querySelector('[data-sales-page]').textContent = `Page ${page} of ${Math.max(1, Math.ceil(total / limit))}`;
  document.querySelector('[data-sales-prev]').disabled = page <= 1;
  document.querySelector('[data-sales-next]').disabled = page * limit >= total;
  reportSales.innerHTML = rows.length ? rows.map(order => `<tr>
    <td>${escapeHtml(formatReportDate(order.created_at))}</td><td><strong>${escapeHtml(order.order_number || `Order ${order.id}`)}</strong></td>
    <td>${escapeHtml(order.customer_name || 'Not provided')}${order.child_name ? `<small>Child: ${escapeHtml(order.child_name)}</small>` : ''}<small>${escapeHtml(order.customer_email || '')}</small></td>
    <td>${escapeHtml(order.fulfilment_type || 'Not recorded')}</td><td><span class="status-pill status-${escapeHtml(order.payment_status)}">${escapeHtml(order.payment_status)}</span></td>
    <td>${escapeHtml(order.fulfilment_status)}${order.fulfilment_type === 'pickup' ? `<small>Prepared notice: ${escapeHtml(order.prepared_email_status || 'not sent')}</small><small>Ready email: ${escapeHtml(order.ready_for_collection_email_status || 'not sent')}</small>` : order.fulfilment_type === 'delivery' ? `<small>Delivery email: ${escapeHtml(order.out_for_delivery_email_status || 'not sent')}</small>` : ''}</td><td>${escapeHtml(order.invoice_number || 'Not issued')}</td><td class="amount"><strong>${formatMoney(order.total_cents)}</strong>${Number(order.refunded_cents) ? `<small>Refunded ${formatMoney(order.refunded_cents)}</small>` : ''}</td>
    <td><button class="button button-secondary button-compact" type="button" data-report-order-id="${Number(order.id)}">View</button></td></tr>`).join('') : '<tr><td colspan="9" class="empty-cell">No sales match these filters.</td></tr>';
}

function renderReportInvoices(rows, total) {
  document.querySelector('[data-invoice-count]').textContent = `${total} generated invoice${total === 1 ? '' : 's'}`;
  reportInvoices.innerHTML = rows.length ? rows.map(invoice => `<tr>
    <td>${escapeHtml(formatReportDate(invoice.issue_date))}</td><td><strong>${escapeHtml(invoice.invoice_number)}</strong></td><td>${escapeHtml(invoice.order_number)}</td>
    <td>${escapeHtml(invoice.customer_name || invoice.customer_email)}${invoice.child_name ? `<small>Child: ${escapeHtml(invoice.child_name)}</small>` : ''}</td><td>${escapeHtml(invoice.status)}</td><td class="amount"><strong>${formatMoney(invoice.total_cents)}</strong></td>
    <td><a class="button button-secondary button-compact" href="/admin/invoice.html?order=${Number(invoice.order_id)}" target="_blank" rel="noopener">View / PDF</a></td></tr>`).join('') : '<tr><td colspan="7" class="empty-cell">No generated invoices match these filters.</td></tr>';
}

async function loadReports() {
  const query = reportQuery();
  document.querySelector('[data-report-summary]').innerHTML = '<div class="empty-state"><p>Loading sales summary...</p></div>';
  const [summaryData, salesData, invoiceData] = await Promise.all([
    api(`/api/admin/reports/summary?${query}`), api(`/api/admin/reports/sales?${query}`), api(`/api/admin/reports/invoices?${query}`)
  ]);
  state.reportTotal = salesData.total;
  renderReportSummary(summaryData.summary);
  renderReportSales(salesData.rows || [], salesData.total, salesData.page, salesData.limit);
  renderReportInvoices(invoiceData.rows || [], invoiceData.total);
  const exportQuery = reportQuery({ includePage: false });
  document.querySelector('[data-sales-csv]').href = `/api/admin/reports/sales.csv${exportQuery ? `?${exportQuery}` : ''}`;
  document.querySelector('[data-invoices-csv]').href = `/api/admin/reports/invoices.csv${exportQuery ? `?${exportQuery}` : ''}`;
}

async function loadOrders() {
  const search = document.querySelector('[data-order-search]').value.trim();
  const fulfilmentType = document.querySelector('[data-order-fulfilment-type]').value;
  const collectionState = document.querySelector('[data-order-collection-state]').value;
  const data = await api(`/api/admin/orders?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}${fulfilmentType ? `&fulfilmentType=${encodeURIComponent(fulfilmentType)}` : ''}${collectionState ? `&collectionState=${encodeURIComponent(collectionState)}` : ''}`);
  state.orders = data.orders || [];
  renderOrders();
}

function formatPromotionDate(value) {
  return value ? formatReportDate(value) : 'Not configured';
}

function renderPromotions() {
  if (!state.promotions.length) {
    promotionList.innerHTML = '<div class="empty-state"><p>No promotions are configured.</p></div>';
    return;
  }
  promotionList.innerHTML = state.promotions.map(promotion => `<article class="promotion-card">
    <div class="promotion-heading"><div><span class="eyebrow">Discount code</span><h2>${escapeHtml(promotion.code)}</h2></div><span class="status-pill status-${promotion.active ? 'active' : 'draft'}">${promotion.active ? 'Active' : 'Inactive'}</span></div>
    <dl class="promotion-facts">
      <div><dt>Discount</dt><dd>${promotion.type === 'fixed' ? `${formatMoney(promotion.value)} fixed` : promotion.type === 'percentage' ? `${Number(promotion.value)}%` : escapeHtml(promotion.type)}</dd></div>
      <div><dt>Eligible products</dt><dd>${promotion.products.length ? promotion.products.map(product => escapeHtml(product.name)).join(', ') : 'None configured'}</dd></div>
      <div><dt>Starts</dt><dd>${escapeHtml(formatPromotionDate(promotion.startsAt))}</dd></div>
      <div><dt>Ends</dt><dd>${escapeHtml(formatPromotionDate(promotion.endsAt))}</dd></div>
      <div><dt>Global usage limit</dt><dd>${promotion.usageLimit ?? 'Unlimited'}</dd></div>
      <div><dt>Per-customer limit</dt><dd>${promotion.perCustomerLimit ?? 'Unlimited'}</dd></div>
    </dl>
  </article>`).join('');
}

async function loadPromotions() {
  promotionList.innerHTML = '<div class="empty-state"><p>Loading promotions...</p></div>';
  const data = await api('/api/admin/promotions');
  state.promotions = data.promotions || [];
  renderPromotions();
}

function renderOrders() {
  if (!state.orders.length) {
    orderList.innerHTML = '<div class="empty-state"><p>No orders match this search.</p></div>';
    return;
  }
  orderList.innerHTML = state.orders.map(order => `<button class="order-row${state.currentOrder?.id === order.id ? ' is-active' : ''}" type="button" data-order-id="${Number(order.id)}">
    <span><strong>${escapeHtml(order.order_number || `Order ${order.id}`)}</strong><small>${escapeHtml(order.customer_name || order.customer_email || 'Customer')}</small>${order.child_name ? `<small>Child: ${escapeHtml(order.child_name)}</small>` : ''}</span>
    <span><strong>${formatMoney(order.total_cents)}</strong><small>${escapeHtml(order.payment_status)} · ${escapeHtml(order.refund_status || 'not_refunded')}</small></span>
  </button>`).join('');
}

function orderAddress(address = {}) {
  return [address.line1, address.line2, address.city, address.state, address.postal_code, address.country].filter(Boolean).map(escapeHtml).join(', ') || 'Not provided';
}

function orderDateTime(value) {
  if (!value) return 'Not yet';
  const parsed = new Date(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? escapeHtml(value) : escapeHtml(parsed.toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' }));
}

function collectionWorkflow(order, fulfilmentType) {
  if (fulfilmentType !== 'pickup') return '';
  const preparedEmailStatus = order.prepared_email_status || 'not_sent';
  const emailStatus = order.ready_for_collection_email_status || 'not_sent';
  const closed = ['cancelled', 'refunded', 'collected'].includes(order.fulfilment_status)
    || ['fully_refunded', 'refunded'].includes(order.refund_status)
    || Number(order.refunded_cents || 0) >= Number(order.total_cents || 0);
  const eligible = order.payment_status === 'paid' && Boolean(order.customer_email) && !closed;
  const canPrepare = order.payment_status === 'paid' && !closed;
  const prepared = Boolean(order.prepared_at);
  const preparedEmailSent = Boolean(order.prepared_email_sent_at) && preparedEmailStatus === 'sent';
  const sent = Boolean(order.ready_for_collection_email_sent_at) && emailStatus === 'sent';
  const ready = order.fulfilment_status === 'ready_for_collection';
  const collected = order.fulfilment_status === 'collected';
  const preparedAction = collected || ready
    ? ''
    : !prepared && canPrepare
      ? '<button class="button button-secondary" type="button" data-order-action="prepared">Mark Order as Prepared</button>'
      : prepared
        ? `<button class="button button-secondary" type="button" disabled>Order Prepared</button>
           <button class="button button-secondary button-compact" type="button" data-order-action="resend-prepared">${preparedEmailSent ? 'Resend Internal Prepared Notification' : 'Retry Internal Prepared Notification'}</button>`
        : '';
  const emailAction = collected
    ? ''
    : sent
    ? `<button class="button button-secondary" type="button" disabled>Ready to Collect Email Sent</button>
       <button class="button button-secondary button-compact" type="button" data-order-action="resend-ready">Resend Ready to Collect Email</button>`
    : eligible && prepared
      ? `<button class="button button-primary" type="button" data-order-action="ready">${emailStatus === 'failed' ? 'Retry Ready to Collect Email' : 'Mark Ready to Collect & Email Customer'}</button>`
      : '';
  const collectedAction = ready && sent
    ? '<button class="button button-secondary" type="button" data-order-action="collected">Mark as Collected</button>'
    : '';
  const completedAction = prepared && !ready && !collected && canPrepare
    ? '<button class="button button-secondary" type="button" data-order-action="complete-pickup">Mark Completed</button>'
    : '';

  return `<section class="collection-workflow" aria-labelledby="collection-workflow-title">
    <div><p class="eyebrow">Pickup fulfilment</p><h3 id="collection-workflow-title">${collected ? 'Collected' : ready ? 'Ready for collection' : prepared ? 'Prepared' : 'Preparing order'}</h3></div>
    <dl class="collection-facts">
      ${order.child_name ? `<div><dt>Child's Name</dt><dd>${escapeHtml(order.child_name)}</dd></div>` : ''}
      <div><dt>Prepared</dt><dd>${prepared ? 'Yes' : 'No'}</dd></div>
      <div><dt>Prepared at</dt><dd>${orderDateTime(order.prepared_at)}</dd></div>
      <div><dt>Prepared by</dt><dd class="preserve-case">${escapeHtml(order.prepared_by_admin || 'Not recorded')}</dd></div>
      <div><dt>Internal notification</dt><dd>${escapeHtml(preparedEmailStatus.replace(/_/g, ' '))}</dd></div>
      <div><dt>Internal email sent</dt><dd>${orderDateTime(order.prepared_email_sent_at)}</dd></div>
      <div><dt>Marked ready</dt><dd>${orderDateTime(order.ready_for_collection_at)}</dd></div>
      <div><dt>Customer email status</dt><dd>${escapeHtml(emailStatus.replace(/_/g, ' '))}</dd></div>
      <div><dt>Customer email sent</dt><dd>${orderDateTime(order.ready_for_collection_email_sent_at)}</dd></div>
      <div><dt>Collected</dt><dd>${orderDateTime(order.collected_at)}</dd></div>
      ${order.prepared_email_id ? `<div><dt>Internal Resend reference</dt><dd class="preserve-case">${escapeHtml(order.prepared_email_id)}</dd></div>` : ''}
      ${order.prepared_email_error ? `<div><dt>Last internal email error</dt><dd class="preserve-case">${escapeHtml(order.prepared_email_error)}</dd></div>` : ''}
      ${order.ready_for_collection_email_id ? `<div><dt>Resend reference</dt><dd>${escapeHtml(order.ready_for_collection_email_id)}</dd></div>` : ''}
      ${order.ready_for_collection_email_error ? `<div><dt>Last email error</dt><dd>${escapeHtml(order.ready_for_collection_email_error)}</dd></div>` : ''}
    </dl>
    ${preparedAction || emailAction || collectedAction || completedAction ? `<div class="collection-actions">${preparedAction}${emailAction}${completedAction}${collectedAction}</div>` : ''}
  </section>`;
}

function deliveryWorkflow(order, fulfilmentType) {
  if (fulfilmentType !== 'delivery') return '';
  const emailStatus = order.out_for_delivery_email_status || 'not_sent';
  const closed = ['cancelled', 'refunded', 'completed'].includes(order.fulfilment_status)
    || ['fully_refunded', 'refunded'].includes(order.refund_status)
    || Number(order.refunded_cents || 0) >= Number(order.total_cents || 0);
  const paid = order.payment_status === 'paid';
  const canEmail = paid && Boolean(order.customer_email) && !closed;
  const sent = Boolean(order.out_for_delivery_email_sent_at) && emailStatus === 'sent';
  const dispatched = order.fulfilment_status === 'out_for_delivery';
  const completed = order.fulfilment_status === 'completed';
  const emailAction = completed
    ? ''
    : sent
    ? `<button class="button button-secondary" type="button" disabled>Out for Delivery Email Sent</button>
       <button class="button button-secondary button-compact" type="button" data-order-action="resend-delivery">Resend Out for Delivery Email</button>`
    : canEmail
      ? `<button class="button button-primary" type="button" data-order-action="out-for-delivery">${emailStatus === 'failed' ? 'Retry Out for Delivery Email' : 'Mark Out for Delivery & Send Email'}</button>`
      : '';
  const completedAction = paid && !closed
    ? '<button class="button button-secondary" type="button" data-order-action="completed">Mark Completed</button>'
    : '';

  return `<section class="collection-workflow delivery-workflow" aria-labelledby="delivery-workflow-title">
    <div><p class="eyebrow">Delivery workflow</p><h3 id="delivery-workflow-title">${completed ? 'Completed' : dispatched ? 'Out for delivery' : 'Preparing order'}</h3></div>
    <dl class="collection-facts">
      <div><dt>Out for delivery</dt><dd>${orderDateTime(order.out_for_delivery_at)}</dd></div>
      <div><dt>Email status</dt><dd>${escapeHtml(emailStatus.replace(/_/g, ' '))}</dd></div>
      <div><dt>Email sent</dt><dd>${orderDateTime(order.out_for_delivery_email_sent_at)}</dd></div>
      <div><dt>Completed</dt><dd>${orderDateTime(order.completed_at)}</dd></div>
      ${order.out_for_delivery_email_id ? `<div><dt>Resend reference</dt><dd>${escapeHtml(order.out_for_delivery_email_id)}</dd></div>` : ''}
      ${order.out_for_delivery_email_error ? `<div><dt>Last email error</dt><dd>${escapeHtml(order.out_for_delivery_email_error)}</dd></div>` : ''}
    </dl>
    ${emailAction || completedAction ? `<div class="collection-actions">${emailAction}${completedAction}</div>` : ''}
  </section>`;
}

async function openOrder(orderId) {
  const data = await api(`/api/admin/orders/${Number(orderId)}`);
  const order = data.order;
  state.currentOrder = order;
  renderOrders();
  const hasSnapshot = Boolean(order.payment_surcharge_label);
  const surchargeApplied = Number(order.payment_surcharge_enabled) === 1;
  const fulfilmentType = order.fulfilment_type || (Object.keys(order.shipping_address || {}).length ? 'delivery' : '');
  const fulfilmentDetails = fulfilmentType === 'pickup'
    ? `<strong>${escapeHtml(order.shipping_method || 'Pick up from Training Centre')}</strong><br>${escapeHtml(order.pickup_location || 'Training Centre')}<br>${escapeHtml(order.pickup_instructions || 'Collection details not recorded')}`
    : `<strong>${escapeHtml(order.shipping_method || 'Delivery')}</strong><br>${orderAddress(order.shipping_address)}${order.shipping_rural ? '<br><strong>Rural address - review delivery</strong>' : ''}`;
  const shippingLabel = fulfilmentType === 'pickup' ? 'Pickup' : (order.shipping_method || 'Shipping');
  orderDetail.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow">Order details</p><h2>${escapeHtml(order.order_number || `Order ${order.id}`)}</h2></div>${order.invoice_number ? `<a class="button button-secondary" href="/admin/invoice.html?order=${Number(order.id)}" target="_blank" rel="noopener">Open Invoice</a>` : `<a class="button button-secondary" href="/admin/invoice.html?order=${Number(order.id)}" target="_blank" rel="noopener">Create Invoice</a>`}</div>
    <dl class="order-facts"><div><dt>Customer</dt><dd>${escapeHtml(order.customer_name || 'Not provided')}<br>${escapeHtml(order.customer_email || '')}<br>${escapeHtml(order.customer_phone || 'Phone not provided')}</dd></div><div><dt>Child's Name</dt><dd><strong>${escapeHtml(order.child_name || 'Not recorded')}</strong></dd></div><div><dt>Delivery method</dt><dd>${fulfilmentDetails}</dd></div><div><dt>Payment</dt><dd>${escapeHtml(order.payment_status)}<br>${escapeHtml(order.payment_method_label || 'Method not recorded')}</dd></div><div><dt>Order status</dt><dd>${escapeHtml(order.fulfilment_status)}</dd></div></dl>
    <div class="order-items"><h3>Items</h3>${order.items.map(item => `<div><span><strong>${Number(item.quantity)} × ${escapeHtml(item.product_name)}</strong><small>${renderOrderItemDetails(item, order)}</small></span><strong>${formatMoney(item.item_total_cents)}</strong></div>`).join('')}</div>
    <dl class="order-totals">
      <div><dt>${hasSnapshot ? 'Merchandise subtotal' : 'Subtotal'}</dt><dd>${formatMoney(order.subtotal_cents)}</dd></div>
      ${Number(order.discount_cents) ? `<div><dt>Promotion</dt><dd><strong>${escapeHtml(order.promotion_code)}</strong></dd></div><div><dt>Eligible tracksuit subtotal</dt><dd>${formatMoney(order.promotion_eligible_subtotal_cents)}</dd></div><div><dt>Discount</dt><dd>-${formatMoney(order.discount_cents)}</dd></div>` : ''}
      ${hasSnapshot ? `<div><dt>Personalisation</dt><dd>${formatMoney(order.personalisation_cents)}</dd></div>` : ''}
      <div><dt>${escapeHtml(shippingLabel)}</dt><dd>${order.shipping_cents ? formatMoney(order.shipping_cents) : 'Free'}</dd></div>
      ${surchargeApplied ? `<div><dt>${escapeHtml(order.payment_surcharge_label)}</dt><dd>${formatMoney(order.payment_surcharge_cents)}</dd></div><div class="order-config"><dt>Configuration used</dt><dd>${escapeHtml(order.payment_surcharge_percent)}% + ${formatMoney(order.payment_surcharge_fixed_cents)}</dd></div>` : hasSnapshot ? '<div class="order-config"><dt>Card surcharge</dt><dd>Disabled for this order</dd></div>' : ''}
      <div class="grand"><dt>Total paid</dt><dd>${formatMoney(order.total_cents)}</dd></div>
      ${order.refunded_cents ? `<div><dt>Refunded</dt><dd>-${formatMoney(order.refunded_cents)}</dd></div>${surchargeApplied ? `<div><dt>Surcharge refunded</dt><dd>${formatMoney(order.payment_surcharge_refunded_cents)}</dd></div>` : ''}` : ''}
    </dl>
    ${collectionWorkflow(order, fulfilmentType)}
    ${deliveryWorkflow(order, fulfilmentType)}`;
}

async function handleOrderAction(button) {
  const order = state.currentOrder;
  if (!order || button.disabled) return;
  const action = button.dataset.orderAction;
  const settings = {
    prepared: {
      path: 'mark-prepared',
      confirmation: `Mark ${order.order_number || 'this order'} as prepared? This sends an internal notification only to PTG Activewear. No email will be sent to the customer.`,
      success: 'The order was marked prepared and the internal notification was sent.'
    },
    'resend-prepared': {
      path: 'resend-prepared-email',
      confirmation: 'Send another internal Prepared notification to info@ptgactivewear.co.nz? The customer will NOT be emailed.',
      success: 'The internal Prepared notification was sent.'
    },
    'complete-pickup': {
      path: 'mark-pickup-completed',
      confirmation: `Mark ${order.order_number || 'this order'} as completed? This bypasses the Ready to Collect step and will NOT email the customer.`,
      success: 'The pickup order was marked completed without emailing the customer.'
    },
    ready: {
      path: 'ready-for-collection',
      confirmation: `Mark ${order.order_number || 'this order'}${order.child_name ? ` for ${order.child_name}` : ''} ready and email the customer now?`,
      success: 'The order is ready for collection and the customer email was sent.'
    },
    'resend-ready': {
      path: 'resend-ready-for-collection',
      confirmation: 'The customer has already received this message. Send another Ready to Collect email?',
      success: 'The Ready to Collect email was sent again.'
    },
    collected: {
      path: 'mark-collected',
      confirmation: `Confirm that ${order.order_number || 'this order'}${order.child_name ? ` for ${order.child_name}` : ''} has been collected?`,
      success: 'The order was marked as collected.'
    },
    'out-for-delivery': {
      path: 'out-for-delivery',
      confirmation: `Mark ${order.order_number || 'this order'} out for delivery and email the customer now?`,
      success: 'The order is out for delivery and the customer email was sent.'
    },
    'resend-delivery': {
      path: 'resend-out-for-delivery',
      confirmation: 'The customer has already received this message. Send another Out for Delivery email?',
      success: 'The Out for Delivery email was sent again.'
    },
    completed: {
      path: 'mark-completed',
      confirmation: `Confirm that ${order.order_number || 'this order'} has been delivered and completed?`,
      success: 'The order was marked as completed.'
    }
  }[action];
  if (!settings || !confirm(settings.confirmation)) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = ['collected', 'completed', 'complete-pickup'].includes(action) ? 'Updating...' : action === 'prepared' ? 'Preparing...' : 'Sending...';
  try {
    await api(`/api/admin/orders/${Number(order.id)}/${settings.path}`, {
      method: 'POST',
      body: JSON.stringify({ requestId: crypto.randomUUID() })
    });
    await loadOrders();
    await openOrder(order.id);
    showNotice(settings.success, 'success', true);
  } catch (error) {
    showNotice(errorMessage(error), 'error', true);
    await openOrder(order.id).catch(() => {});
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function switchView(viewName, updateHistory = true) {
  views.forEach(view => { view.hidden = view.dataset.view !== viewName; });
  document.querySelectorAll('[data-view-target]').forEach(button => button.classList.toggle('is-active', button.dataset.viewTarget === viewName));
  if (updateHistory) history.pushState({}, '', routeFor(viewName));
  window.scrollTo({ top: 0, behavior: 'auto' });
}

async function loadSession() {
  const response = await fetch('/api/admin/session', {
    credentials: 'same-origin',
    redirect: 'manual',
    headers: { Accept: 'application/json' }
  });
  const contentType = response.headers.get('content-type') || '';
  if (response.type === 'opaqueredirect' || response.redirected || (response.ok && !contentType.includes('application/json'))) {
    restartAdminAuthentication();
    return false;
  }
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
  const requestedProductId = state.pictureProductId || pictureProduct.value;
  const search = pictureProductSearch.value.trim().toLowerCase();
  const visibleProducts = state.products.filter(product => {
    if (product.id === requestedProductId) return true;
    return !search || [product.name, product.id, product.slug].some(value => String(value || '').toLowerCase().includes(search));
  });
  const placeholder = new Option('Select a product', '');
  const groups = [
    ['Current products', visibleProducts.filter(product => !product.archived)],
    ['Archived products', visibleProducts.filter(product => product.archived)]
  ];
  const nodes = [placeholder];
  for (const [label, products] of groups) {
    if (!products.length) continue;
    const group = document.createElement('optgroup');
    group.label = label;
    for (const product of products) {
      group.append(new Option(`${product.name} (${productStatus(product).label})`, product.id));
    }
    nodes.push(group);
  }
  if (search && !visibleProducts.length) {
    const noResults = new Option('No matching products', '');
    noResults.disabled = true;
    nodes.push(noResults);
  }
  pictureProduct.replaceChildren(...nodes);
  const selectedProduct = state.products.find(product => product.id === requestedProductId);
  pictureProduct.value = selectedProduct?.id || '';
  state.pictureProductId = pictureProduct.value;
  pictureProduct.disabled = !state.products.length;
  updatePictureWorkspace();
}

function updatePictureWorkspace({ loading = false } = {}) {
  const product = state.products.find(item => item.id === state.pictureProductId);
  const enabled = Boolean(product) && !loading;
  for (const control of pictureUploadForm.elements) control.disabled = !enabled;
  pictureProductStatus.textContent = product
    ? `${loading ? 'Loading' : 'Managing'} pictures for ${product.name}.`
    : state.products.length
      ? 'Select a product to view or update its pictures.'
      : 'Create a product before uploading pictures.';
  pictureSelectedProduct.hidden = !product;
  pictureSelectedProduct.innerHTML = product ? `
    ${product.primaryImage ? `<img src="${escapeHtml(product.primaryImage)}" alt="" loading="lazy">` : '<span class="picture-selected-placeholder" aria-hidden="true">No image</span>'}
    <span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.id)} | ${escapeHtml(productStatus(product).label)}</small></span>
  ` : '';
  document.querySelector('[data-gallery-title]').textContent = product?.name || 'Product pictures';
  pictureGallery.setAttribute('aria-busy', loading ? 'true' : 'false');
  if (!product) {
    state.pictures = [];
    pictureGallery.innerHTML = '<div class="empty-state"><p>Select a product to view, replace or upload pictures.</p></div>';
  }
}

async function openPictures(productId = '', updateHistory = true) {
  clearNotice();
  if (productId && state.products.some(product => product.id === productId)) state.pictureProductId = productId;
  renderPictureProductOptions();
  switchView('pictures', updateHistory);
  if (state.pictureProductId) await loadPictures();
}

async function loadPictures() {
  if (!state.pictureProductId) {
    updatePictureWorkspace();
    return;
  }
  const productId = state.pictureProductId;
  updatePictureWorkspace({ loading: true });
  const data = await api(`/api/admin/products/${encodeURIComponent(productId)}/pictures`);
  if (state.pictureProductId !== productId) return;
  state.pictures = data.pictures || [];
  document.querySelector('[data-gallery-title]').textContent = data.product?.name || 'Product pictures';
  pictureUploadForm.elements.altText.value ||= data.product?.name || '';
  updatePictureWorkspace();
  renderPictureGallery();
  history.replaceState({}, '', routeFor('pictures'));
}

function renderPictureGallery() {
  if (!state.pictures.length) {
    pictureGallery.innerHTML = '<div class="empty-state"><p>No pictures yet. Upload the first picture using the form.</p></div>';
    return;
  }
  pictureGallery.innerHTML = state.pictures.map((picture, index) => {
    const dimensions = picture.width && picture.height ? `${picture.width} x ${picture.height}px` : 'Dimensions unavailable';
    const size = picture.fileSize ? `${(picture.fileSize / 1024 / 1024).toFixed(2)} MB` : 'Static asset';
    return `<article class="gallery-card" data-picture-id="${picture.id}">
    <div class="gallery-image">
      <img src="${escapeHtml(picture.thumbnailUrl || picture.url)}" alt="${escapeHtml(picture.altText)}" loading="lazy">
      ${picture.isPrimary ? '<span class="status-pill status-active">Main picture</span>' : ''}
    </div>
    <div class="gallery-details">
      <small>${escapeHtml(dimensions)} | ${escapeHtml(size)} | ${escapeHtml(picture.storage)}</small>
      <div class="gallery-metadata">
        <label><span>Alt text</span><input data-picture-alt maxlength="200" value="${escapeHtml(picture.altText)}" required></label>
        <label><span>Style or angle</span><input data-picture-style maxlength="80" value="${escapeHtml(picture.variantStyle)}" placeholder="Front, back, Style 1"></label>
      </div>
      <div class="gallery-actions">
        <button class="button button-primary" type="button" data-picture-action="save-details">Save Details</button>
        ${picture.isPrimary ? '' : '<button class="button button-secondary" type="button" data-picture-action="primary">Set Main</button>'}
        <button class="button button-secondary" type="button" data-picture-action="up" ${index === 0 ? 'disabled' : ''}>Move Up</button>
        <button class="button button-secondary" type="button" data-picture-action="down" ${index === state.pictures.length - 1 ? 'disabled' : ''}>Move Down</button>
        <button class="button button-secondary" type="button" data-picture-action="replace">Replace Picture</button>
        <button class="button button-danger" type="button" data-picture-action="delete">Delete</button>
      </div>
    </div>
  </article>`;
  }).join('');
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
      const contentType = xhr.getResponseHeader('content-type') || '';
      if (xhr.status >= 200 && xhr.status < 300 && !contentType.includes('application/json')) {
        restartAdminAuthentication();
        reject(new Error('Your secure access session has expired.'));
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
  if (!state.products.some(product => product.id === state.pictureProductId)) {
    showNotice('Select a product before uploading a picture.', 'error');
    pictureProduct.focus();
    return;
  }
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

async function handlePictureAction(pictureId, action, trigger) {
  const picture = state.pictures.find(item => item.id === pictureId);
  if (!picture || trigger?.disabled) return;
  if (trigger) trigger.disabled = true;
  try {
    if (action === 'save-details') {
      const card = pictureGallery.querySelector(`[data-picture-id="${pictureId}"]`);
      const altText = card?.querySelector('[data-picture-alt]')?.value.trim() || '';
      const variantStyle = card?.querySelector('[data-picture-style]')?.value.trim() || '';
      if (!altText) {
        card?.querySelector('[data-picture-alt]')?.focus();
        throw new Error('Alt text is required.');
      }
      await api(`/api/admin/pictures/${pictureId}`, {
        method: 'PUT', body: JSON.stringify({ altText, variantStyle })
      });
    }
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
    const messages = {
      delete: 'Picture deleted successfully.',
      primary: 'Main picture updated.',
      'save-details': 'Picture details saved.',
      up: 'Picture order updated.',
      down: 'Picture order updated.'
    };
    showNotice(messages[action] || 'Picture updated.', 'success');
  } catch (error) {
    showNotice(errorMessage(error), 'error', true);
  } finally {
    if (trigger?.isConnected) trigger.disabled = false;
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
document.querySelector('[data-order-search]').addEventListener('change', () => loadOrders().catch(error => showNotice(errorMessage(error), 'error')));
document.querySelector('[data-order-search]').addEventListener('search', () => loadOrders().catch(error => showNotice(errorMessage(error), 'error')));
document.querySelector('[data-order-fulfilment-type]').addEventListener('change', () => loadOrders().catch(error => showNotice(errorMessage(error), 'error')));
document.querySelector('[data-order-collection-state]').addEventListener('change', () => loadOrders().catch(error => showNotice(errorMessage(error), 'error')));
document.querySelector('[data-refresh-orders]').addEventListener('click', () => loadOrders().catch(error => showNotice(errorMessage(error), 'error')));
document.querySelector('[data-refresh-reports]').addEventListener('click', () => loadReports().catch(error => showNotice(errorMessage(error), 'error')));
document.querySelector('[data-refresh-promotions]').addEventListener('click', () => loadPromotions().catch(error => showNotice(errorMessage(error), 'error')));
reportFilters.addEventListener('submit', event => {
  event.preventDefault();
  state.reportPage = 1;
  loadReports().catch(error => showNotice(errorMessage(error), 'error', true));
});
reportFilters.addEventListener('reset', () => {
  state.reportPage = 1;
  setTimeout(() => loadReports().catch(error => showNotice(errorMessage(error), 'error')), 0);
});
document.querySelector('[data-sales-prev]').addEventListener('click', () => { state.reportPage = Math.max(1, state.reportPage - 1); loadReports().catch(error => showNotice(errorMessage(error), 'error')); });
document.querySelector('[data-sales-next]').addEventListener('click', () => { state.reportPage += 1; loadReports().catch(error => showNotice(errorMessage(error), 'error')); });
reportSales.addEventListener('click', event => {
  const button = event.target.closest('[data-report-order-id]');
  if (!button) return;
  loadOrders().then(() => { switchView('orders'); return openOrder(Number(button.dataset.reportOrderId)); }).catch(error => showNotice(errorMessage(error), 'error', true));
});
orderList.addEventListener('click', event => {
  const row = event.target.closest('[data-order-id]');
  if (row) openOrder(Number(row.dataset.orderId)).catch(error => showNotice(errorMessage(error), 'error', true));
});
orderDetail.addEventListener('click', event => {
  const button = event.target.closest('[data-order-action]');
  if (button) handleOrderAction(button);
});

document.querySelectorAll('[data-view-target]').forEach(button => button.addEventListener('click', () => {
  const target = button.dataset.viewTarget;
  if (target === 'editor') showNewProduct();
  else if (target === 'pictures') openPictures();
  else if (target === 'orders') loadOrders().then(() => switchView('orders')).catch(error => showNotice(errorMessage(error), 'error'));
  else if (target === 'reports') loadReports().then(() => switchView('reports')).catch(error => showNotice(errorMessage(error), 'error'));
  else if (target === 'promotions') loadPromotions().then(() => switchView('promotions')).catch(error => showNotice(errorMessage(error), 'error'));
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
  state.pictureProductId = state.products.some(product => product.id === pictureProduct.value) ? pictureProduct.value : '';
  resetPictureUpload();
  updatePictureWorkspace();
  if (!state.pictureProductId) {
    history.replaceState({}, '', routeFor('pictures'));
    return;
  }
  await loadPictures().catch(error => {
    updatePictureWorkspace();
    showNotice(errorMessage(error), 'error', true);
  });
});
pictureProductSearch.addEventListener('input', renderPictureProductOptions);
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
  if (button && card) handlePictureAction(Number(card.dataset.pictureId), button.dataset.pictureAction, button);
});

document.querySelector('[data-logout]').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  let logoutUrl = '/admin/login';
  try {
    const result = await api('/api/admin/logout', { method: 'POST', body: '{}' });
    logoutUrl = result.logoutUrl || logoutUrl;
  } finally {
    window.location.replace(logoutUrl);
  }
});

window.addEventListener('popstate', () => initialiseRoute(false));

async function initialiseRoute(updateHistory = false) {
  const url = new URL(window.location.href);
  if (url.pathname === '/admin/pictures') {
    await openPictures(url.searchParams.get('product') || '', updateHistory);
  } else if (url.pathname === '/admin/orders') {
    await loadOrders();
    switchView('orders', updateHistory);
  } else if (url.pathname === '/admin/reports') {
    await loadReports();
    switchView('reports', updateHistory);
  } else if (url.pathname === '/admin/promotions') {
    await loadPromotions();
    switchView('promotions', updateHistory);
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
