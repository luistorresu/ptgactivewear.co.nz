function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}

function money(cents, currency = 'NZD') {
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: String(currency || 'NZD').toUpperCase() }).format(Number(cents || 0) / 100);
}

function date(value) {
  if (!value) return 'Not provided';
  const parsed = new Date(String(value).includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

function address(value = {}) {
  return [value.line1, value.line2, value.city, value.state, value.postal_code, value.country].filter(Boolean).map(escapeHtml).join('<br>') || 'Not provided';
}

async function loadInvoice() {
  const root = document.getElementById('invoice');
  const orderId = Number(new URLSearchParams(location.search).get('order'));
  if (!Number.isInteger(orderId) || orderId < 1) { root.innerHTML = '<p class="invoice-loading invoice-error">Invalid order.</p>'; return; }
  try {
    const sessionResponse = await fetch('/api/admin/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (sessionResponse.status === 401) { window.location.replace('/admin/login'); return; }
    const session = await sessionResponse.json();
    const response = await fetch(`/api/admin/orders/${orderId}/invoice`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-PTG-Admin-Request': '1', 'X-CSRF-Token': session.csrfToken }, body: '{}' });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Invoice could not be prepared.');
    const order = result.order;
    const hasSurchargeSnapshot = Boolean(order.payment_surcharge_label);
    const surchargeApplied = Number(order.payment_surcharge_enabled) === 1;
    const pricingRows = hasSurchargeSnapshot
      ? `<div class="total-row"><span>Merchandise subtotal</span><strong>${money(order.subtotal_cents, order.currency)}</strong></div><div class="total-row"><span>Personalisation</span><strong>${money(order.personalisation_cents, order.currency)}</strong></div>`
      : `<div class="total-row"><span>Subtotal</span><strong>${money(order.subtotal_cents, order.currency)}</strong></div>`;
    const hasFulfilmentSnapshot = ['pickup', 'delivery'].includes(order.fulfilment_type);
    const fulfilmentParty = order.fulfilment_type === 'pickup'
      ? `<div><h2>Pickup</h2><p><strong>${escapeHtml(order.shipping_method || 'Pick up from Training Centre')}</strong></p><p>${escapeHtml(order.pickup_location || 'Training Centre')}</p><p>${escapeHtml(order.pickup_instructions || 'We will contact you when your order is ready to collect.')}</p></div>`
      : `<div><h2>Ship to</h2><p><strong>${escapeHtml(order.shipping_name || order.customer_name)}</strong></p><p>${address(order.shipping_address)}</p>${order.shipping_rural ? '<p><strong>Rural delivery</strong></p>' : ''}</div>`;
    const shippingLabel = order.fulfilment_type === 'pickup' ? (order.shipping_method || 'Pickup') : (hasFulfilmentSnapshot ? (order.shipping_method || 'New Zealand Delivery') : 'Shipping');
    const shippingValue = order.shipping_cents ? money(order.shipping_cents, order.currency) : (hasFulfilmentSnapshot ? 'Free' : money(0, order.currency));
    document.title = `${order.invoice_number} | PTG Activewear`;
    root.innerHTML = `
      <header class="invoice-header">
        <div class="invoice-brand"><img src="/photos/ptg-logo-dark-transparent.webp" alt="PTG Activewear"><p>PTG Activewear<br>info@ptgactivewear.co.nz<br>ptgactivewear.co.nz</p></div>
        <div class="invoice-meta"><h1>Invoice</h1><p><strong>${escapeHtml(order.invoice_number)}</strong></p><p>Order: ${escapeHtml(order.order_number)}</p><p>Invoice date: ${escapeHtml(date(order.invoice_created_at))}</p><p>Payment date: ${escapeHtml(date(order.payment_date))}</p></div>
      </header>
      <section class="invoice-parties"><div><h2>Bill to</h2><p><strong>${escapeHtml(order.customer_name)}</strong></p><p>${address(order.billing_address)}</p><p>${escapeHtml(order.customer_email)}</p></div>${fulfilmentParty}</section>
      <table class="invoice-table"><thead><tr><th>Item</th><th>SKU</th><th>Qty</th><th class="amount">Unit</th><th class="amount">Personalisation</th><th class="amount">Total</th></tr></thead><tbody>${order.items.map(item => `<tr><td><strong>${escapeHtml(item.product_name)}</strong><div class="item-options">${escapeHtml([item.size, item.colour, item.style].filter(Boolean).join(' / '))}${item.player_name ? `<br>Player Name: ${escapeHtml(item.player_name)}` : ''}${item.player_number ? `<br>Player Number: ${escapeHtml(item.player_number)}` : ''}</div></td><td>${escapeHtml(item.sku)}</td><td>${Number(item.quantity)}</td><td class="amount">${money(item.unit_price_cents, order.currency)}</td><td class="amount">${money(item.customisation_total_cents, order.currency)}</td><td class="amount">${money(item.item_total_cents, order.currency)}</td></tr>`).join('')}</tbody></table>
      <div class="invoice-totals">${pricingRows}${order.discount_cents ? `<div class="total-row"><span>Discount</span><strong>-${money(order.discount_cents, order.currency)}</strong></div>` : ''}<div class="total-row"><span>${escapeHtml(shippingLabel)}</span><strong>${shippingValue}</strong></div>${surchargeApplied ? `<div class="total-row"><span>${escapeHtml(order.payment_surcharge_label)}</span><strong>${money(order.payment_surcharge_cents, order.currency)}</strong></div>` : ''}${order.tax_cents ? `<div class="total-row"><span>Tax</span><strong>${money(order.tax_cents, order.currency)}</strong></div>` : ''}<div class="total-row grand"><span>Total paid</span><strong>${money(order.total_cents, order.currency)} ${escapeHtml(order.currency)}</strong></div>${order.refunded_cents ? `<div class="total-row"><span>Refunded</span><strong>-${money(order.refunded_cents, order.currency)}</strong></div>${surchargeApplied ? `<div class="total-row"><span>Surcharge refunded</span><strong>${money(order.payment_surcharge_refunded_cents, order.currency)}</strong></div>` : ''}` : ''}</div>
      <div class="invoice-status">Payment status: ${escapeHtml(order.payment_status)}${order.payment_method_label ? ` &middot; ${escapeHtml(order.payment_method_label)}` : ''}</div>
      <footer class="invoice-footer">Thank you for your order.<br>This document is an operational receipt/invoice and is not labelled as a GST tax invoice.</footer>`;
    if (new URLSearchParams(location.search).get('print') === '1') setTimeout(() => window.print(), 300);
  } catch (error) { root.innerHTML = `<p class="invoice-loading invoice-error">${escapeHtml(error.message)}</p>`; }
}

document.querySelector('[data-print]').addEventListener('click', () => window.print());
loadInvoice();
