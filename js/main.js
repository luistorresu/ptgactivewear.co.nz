// ── Cart state (persisted to localStorage) ──────────────────────────────────
let cart = [];
try {
  const savedCart = JSON.parse(localStorage.getItem('ptg-cart') || '[]');
  cart = Array.isArray(savedCart) ? savedCart : [];
} catch (error) {
  cart = [];
}
const PERSONALISATION_ADDON_PRICE = 20;
let checkoutSummaryTimer = 0;
let checkoutSummaryRequest = 0;
let fulfilmentType = ['pickup', 'delivery'].includes(localStorage.getItem('ptg-fulfilment'))
  ? localStorage.getItem('ptg-fulfilment')
  : '';

function saveCart() {
  localStorage.setItem('ptg-cart', JSON.stringify(cart));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function escapeJsString(value) {
  return JSON.stringify(String(value ?? ''))
    .replace(/&/g, '\\u0026')
    .replace(/'/g, '\\u0027')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function getProducts() {
  return window.PTG_PRODUCTS || globalThis.PTG_PRODUCTS || [];
}

function findProductForCartItem(item) {
  const products = getProducts();
  return products.find(product => product.id === item.id) || products.find(product => product.name === item.name);
}

function samePersonalisation(a = {}, b = {}) {
  return (a.name || '') === (b.name || '') && (a.number || '') === (b.number || '');
}

function sameVariant(a = '', b = '') {
  return (a || '') === (b || '');
}

function sameVariantId(a, b) {
  return Number(a || 0) === Number(b || 0);
}

function sameSize(a = '', b = '') {
  return (a || '') === (b || '');
}

function renderPersonalisationDetails(item) {
  const details = [];
  const personalisation = item.personalisation || {};

  if (item.variant) details.push(`Colour: ${escapeHtml(item.variant)}`);
  if (item.size) details.push(`Size: ${escapeHtml(item.size)}`);
  const namePrice = Number(item.personalisationPrices?.name ?? PERSONALISATION_ADDON_PRICE);
  const numberPrice = Number(item.personalisationPrices?.number ?? PERSONALISATION_ADDON_PRICE);
  if (personalisation.name) details.push(`Name: ${escapeHtml(personalisation.name)} (+${formatMoney(namePrice)})`);
  if (personalisation.number) details.push(`Number: ${escapeHtml(personalisation.number)} (+${formatMoney(numberPrice)})`);

  return details.length
    ? `<ul class="mt-2 space-y-0.5 text-[11px] text-gray-500">${details.map(detail => `<li>${detail}</li>`).join('')}</ul>`
    : '';
}

// ── UI updates ───────────────────────────────────────────────────────────────
function updateCartUI() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  const total = cart.reduce((s, i) => s + Number(i.price || i.basePrice || 0) * i.qty, 0);

  const countEl  = document.getElementById('cart-count');
  const totalEl  = document.getElementById('cart-total');
  const itemsEl  = document.getElementById('cart-items');

  if (countEl) {
    countEl.textContent = count;
    countEl.classList.toggle('hidden', count === 0);
  }

  if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;

  if (itemsEl) {
    if (cart.length === 0) {
      itemsEl.innerHTML = '<p class="text-gray-400 text-center mt-16 text-sm">Your cart is empty</p>';
    } else {
      itemsEl.innerHTML = cart.map((item, i) => {
        const itemPrice = Number(item.price || item.basePrice || 0);
        return `
        <div class="flex items-center gap-4 py-5 border-b last:border-0">
          <div class="flex-1 min-w-0">
            <p class="font-medium text-gray-900 text-sm truncate">${escapeHtml(item.name)}</p>
            <p class="text-gray-500 text-xs mt-0.5">${formatMoney(itemPrice)} each</p>
            ${renderPersonalisationDetails(item)}
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button onclick="changeQty(${i},-1)" class="w-7 h-7 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:border-brand hover:text-brand text-base leading-none transition-colors">−</button>
            <span class="text-sm font-semibold w-5 text-center">${item.qty}</span>
            <button onclick="changeQty(${i},1)"  class="w-7 h-7 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:border-brand hover:text-brand text-base leading-none transition-colors">+</button>
            <button onclick="removeItem(${i})" class="ml-1 text-gray-300 hover:text-red-400 transition-colors">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
      `;
      }).join('');
    }
  }
  scheduleCheckoutSummary();
}

// ── Cart actions ─────────────────────────────────────────────────────────────
function getPersonalisation(trigger) {
  const card = trigger ? trigger.closest('.product-card') : null;
  const nameInput = card ? card.querySelector('[data-personalisation="name"]') : null;
  const numberInput = card ? card.querySelector('[data-personalisation="number"]') : null;
  const playerName = (nameInput?.value || '').trim().replace(/\s+/g, ' ');
  const jerseyNumber = (numberInput?.value || '').trim();

  if (jerseyNumber && !/^(?:0|00|[1-9][0-9]?)$/.test(jerseyNumber)) {
    showToast('Enter a jersey number from 0 to 99');
    numberInput.focus();
    return null;
  }

  return {
    name: playerName.slice(0, 20),
    number: jerseyNumber
  };
}

function getSelectedVariant(trigger) {
  const card = trigger ? trigger.closest('.product-card') : null;
  const variantSelect = card ? card.querySelector('[data-product-variant]') : null;
  return variantSelect ? variantSelect.value : '';
}

function getSelectedSize(trigger) {
  const card = trigger ? trigger.closest('.product-card') : null;
  const sizeSelect = card ? card.querySelector('[data-product-size]') : null;
  return sizeSelect ? sizeSelect.value : '';
}

function getSelectedInventoryVariant(trigger) {
  const card = trigger ? trigger.closest('.product-card') : null;
  const select = card ? card.querySelector('[data-inventory-variant]') : null;
  if (!select) return null;
  const option = select.options[select.selectedIndex];
  return {
    id: Number(option?.value || 0),
    size: option?.dataset.size || '',
    variant: [option?.dataset.colour, option?.dataset.style].filter(Boolean).join(' / ')
  };
}

function addToCart(productId, name, price, trigger) {
  const personalisation = getPersonalisation(trigger);
  if (!personalisation) return;

  const product = getProducts().find(item => item.id === productId);
  const inventoryVariant = getSelectedInventoryVariant(trigger);
  if (Array.isArray(product?.inventoryVariants) && !inventoryVariant?.id) {
    showToast('Choose an available product option');
    return;
  }
  const variant = inventoryVariant?.variant ?? getSelectedVariant(trigger);
  const size = inventoryVariant?.size ?? getSelectedSize(trigger);
  const variantId = inventoryVariant?.id || null;
  const basePrice = Number(price);
  const namePrice = Number(product?.playerNamePrice ?? PERSONALISATION_ADDON_PRICE);
  const numberPrice = Number(product?.playerNumberPrice ?? PERSONALISATION_ADDON_PRICE);
  const addOnTotal =
    (personalisation.name ? namePrice : 0) +
    (personalisation.number ? numberPrice : 0);
  const finalPrice = basePrice + addOnTotal;
  const existing = cart.find(i => (i.id === productId || i.name === name) && sameVariantId(i.variantId, variantId) && sameVariant(i.variant, variant) && sameSize(i.size, size) && samePersonalisation(i.personalisation, personalisation));

  if (existing) {
    if (existing.qty >= 20) { showToast('Maximum quantity is 20 per option'); return; }
    existing.qty++;
  } else {
    cart.push({ id: productId, name, basePrice, price: finalPrice, qty: 1, variantId, variant, size, personalisation, personalisationPrices: { name: namePrice, number: numberPrice } });
  }
  saveCart();
  updateCartUI();
  showToast(`✓  ${name} added to cart`);
}

function changeQty(index, delta) {
  cart[index].qty = Math.min(20, cart[index].qty + delta);
  if (cart[index].qty <= 0) cart.splice(index, 1);
  saveCart();
  updateCartUI();
}

function removeItem(index) {
  cart.splice(index, 1);
  saveCart();
  updateCartUI();
}

// ── Cart sidebar ─────────────────────────────────────────────────────────────
function toggleCart() {
  const sidebar  = document.getElementById('cart-sidebar');
  const overlay  = document.getElementById('cart-overlay');
  if (!sidebar) return;
  const isOpen = sidebar.classList.toggle('open');
  overlay.classList.toggle('hidden', !isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
}

function buildCheckoutPayload() {
  return {
    fulfilmentType,
    items: cart.map(item => {
      const product = findProductForCartItem(item);
      return {
        productId: product?.id || item.id,
        variantId: Number(item.variantId || 0) || null,
        quantity: item.qty,
        size: item.size || '',
        variant: item.variant || '',
        personalisation: {
          name: item.personalisation?.name || '',
          number: item.personalisation?.number || ''
        }
      };
    })
  };
}

function formatCents(cents) {
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(Number(cents || 0) / 100);
}

function getCartSummaryElements() {
  const totalEl = document.getElementById('cart-total');
  if (!totalEl) return {};
  const checkoutButton = document.querySelector('[data-checkout-button]');
  if (checkoutButton?.nextElementSibling?.tagName === 'P') {
    checkoutButton.nextElementSibling.textContent = 'Secure payment options are shown on the next step, powered by Stripe.';
  }
  const totalRow = totalEl.parentElement;
  let fulfilment = document.querySelector('[data-fulfilment-selector]');
  if (!fulfilment) {
    fulfilment = document.createElement('section');
    fulfilment.dataset.fulfilmentSelector = '';
    fulfilment.className = 'fulfilment-selector';
    fulfilment.innerHTML = `
      <p class="cart-review-note"><strong>Check your item selections</strong><span>Please review sizes, styles and personalisation before continuing. Customised items will be prepared using the selections shown in your cart.</span></p>
      <fieldset>
        <legend>Delivery method</legend>
        <label class="fulfilment-option">
          <input type="radio" name="ptg-fulfilment" value="pickup">
          <span><strong>Pick up from Training Centre</strong><small>Free</small></span>
        </label>
        <label class="fulfilment-option">
          <input type="radio" name="ptg-fulfilment" value="delivery">
          <span><strong>New Zealand Delivery</strong><small>$5.00 NZD</small></span>
        </label>
      </fieldset>
      <p class="fulfilment-note" data-fulfilment-note>Please choose how you would like to receive your order.</p>`;
    totalRow.before(fulfilment);
    fulfilment.querySelectorAll('input[name="ptg-fulfilment"]').forEach(input => {
      input.checked = input.value === fulfilmentType;
      input.addEventListener('change', () => {
        fulfilmentType = input.value;
        localStorage.setItem('ptg-fulfilment', fulfilmentType);
        fulfilment.querySelectorAll('.fulfilment-option').forEach(option => option.classList.toggle('is-selected', option.contains(input)));
        scheduleCheckoutSummary();
      });
    });
    fulfilment.querySelectorAll('.fulfilment-option').forEach(option => {
      option.classList.toggle('is-selected', option.querySelector('input').checked);
    });
  }
  let breakdown = document.querySelector('[data-cart-breakdown]');
  if (!breakdown) {
    breakdown = document.createElement('div');
    breakdown.dataset.cartBreakdown = '';
    breakdown.className = 'cart-breakdown';
    breakdown.innerHTML = `
      <div><span>Merchandise subtotal</span><strong data-summary-merchandise>$0.00</strong></div>
      <div data-summary-personalisation-row><span>Personalisation</span><strong data-summary-personalisation>$0.00</strong></div>
      <div><span data-summary-shipping-label>Shipping</span><strong data-summary-shipping>$0.00</strong></div>
      <div data-summary-surcharge-row hidden><span data-summary-surcharge-label>Card processing surcharge</span><strong data-summary-surcharge>$0.00</strong></div>
      <p data-summary-surcharge-note hidden></p>`;
    totalRow.before(breakdown);
  }
  return { totalEl, totalRow, breakdown, fulfilment };
}

function renderCheckoutSummary(summary) {
  const { totalEl, totalRow, breakdown } = getCartSummaryElements();
  if (!totalEl || !breakdown) return;
  const personalisationRow = breakdown.querySelector('[data-summary-personalisation-row]');
  const surchargeRow = breakdown.querySelector('[data-summary-surcharge-row]');
  const surchargeNote = breakdown.querySelector('[data-summary-surcharge-note]');
  const fulfilmentNote = document.querySelector('[data-fulfilment-note]');
  breakdown.querySelector('[data-summary-merchandise]').textContent = formatCents(summary.merchandiseSubtotalCents);
  breakdown.querySelector('[data-summary-personalisation]').textContent = formatCents(summary.personalisationCents);
  breakdown.querySelector('[data-summary-shipping]').textContent = summary.shippingCents ? formatCents(summary.shippingCents) : 'Free';
  breakdown.querySelector('[data-summary-shipping-label]').textContent = summary.fulfilment.label;
  if (fulfilmentNote) {
    fulfilmentNote.textContent = summary.fulfilment.type === 'pickup'
      ? `${summary.fulfilment.instructions}${summary.fulfilment.pickupAddress ? ` Collection: ${summary.fulfilment.pickupAddress}.` : ''}`
      : 'Delivery is available throughout New Zealand only. Enter and confirm your NZ delivery address securely in Stripe Checkout.';
  }
  personalisationRow.hidden = summary.personalisationCents === 0;
  surchargeRow.hidden = !summary.surcharge.enabled;
  surchargeNote.hidden = !summary.surcharge.enabled;
  if (summary.surcharge.enabled) {
    breakdown.querySelector('[data-summary-surcharge-label]').textContent = summary.surcharge.label;
    breakdown.querySelector('[data-summary-surcharge]').textContent = formatCents(summary.paymentSurchargeCents);
    surchargeNote.textContent = 'Card payments include a processing surcharge to help cover payment-processing costs.';
  }
  totalRow.querySelector('span').textContent = 'Total';
  totalEl.textContent = formatCents(summary.totalCents);
}

async function fetchCheckoutSummary(payload = buildCheckoutPayload(), shouldRender = true) {
  const response = await fetch('/api/checkout-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok || !result.summary) throw new Error(result.error || 'Checkout totals could not be calculated.');
  if (shouldRender) renderCheckoutSummary(result.summary);
  return result.summary;
}

function scheduleCheckoutSummary() {
  clearTimeout(checkoutSummaryTimer);
  const requestNumber = ++checkoutSummaryRequest;
  const { totalRow, breakdown, fulfilment } = getCartSummaryElements();
  if (!cart.length) {
    if (breakdown) breakdown.hidden = true;
    if (totalRow) totalRow.querySelector('span').textContent = 'Subtotal';
    return;
  }
  if (!fulfilmentType) {
    if (breakdown) breakdown.hidden = true;
    if (totalRow) totalRow.querySelector('span').textContent = 'Subtotal';
    if (fulfilment) fulfilment.querySelector('[data-fulfilment-note]').textContent = 'Please choose how you would like to receive your order.';
    return;
  }
  if (breakdown) breakdown.hidden = false;
  checkoutSummaryTimer = setTimeout(async () => {
    try {
      const summary = await fetchCheckoutSummary(buildCheckoutPayload(), false);
      if (requestNumber !== checkoutSummaryRequest) return;
      renderCheckoutSummary(summary);
    } catch {
      if (breakdown) breakdown.hidden = true;
      if (totalRow) totalRow.querySelector('span').textContent = 'Subtotal';
    }
  }, 180);
}

function setCheckoutLoading(isLoading) {
  document.querySelectorAll('[data-checkout-button]').forEach(button => {
    button.disabled = isLoading;
    button.textContent = isLoading ? 'Starting secure checkout...' : 'Proceed to Checkout';
    button.classList.toggle('opacity-70', isLoading);
    button.classList.toggle('cursor-not-allowed', isLoading);
  });
}

function setupCheckout() {
  const checkoutButtons = document.querySelectorAll('[data-checkout-button]');
  if (!checkoutButtons.length) return;

  let isCheckingOut = false;
  const statusEl = document.querySelector('[data-checkout-status]');

  checkoutButtons.forEach(button => {
    button.addEventListener('click', async () => {
      if (isCheckingOut) return;

      if (!cart.length) {
        setInlineStatus(statusEl, 'error', 'Your cart is empty.');
        return;
      }

      if (!fulfilmentType) {
        setInlineStatus(statusEl, 'error', 'Please choose free pickup or New Zealand delivery.');
        document.querySelector('[data-fulfilment-selector]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const payload = buildCheckoutPayload();
      if (payload.items.some(item => !item.productId)) {
        setInlineStatus(statusEl, 'error', 'One of the products in your cart is no longer available. Please remove it and try again.');
        return;
      }

      clearInlineStatus(statusEl);
      isCheckingOut = true;
      setCheckoutLoading(true);

      try {
        await fetchCheckoutSummary(payload);
        payload.checkoutRequestId = crypto.randomUUID();
        const response = await fetch('/api/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.ok || !result.url) {
          throw new Error(result.error || 'Checkout could not be started.');
        }

        window.location.assign(result.url);
      } catch (error) {
        setInlineStatus(statusEl, 'error', error.message || 'Checkout could not be started. Please try again.');
        isCheckingOut = false;
        setCheckoutLoading(false);
      }
    });
  });
}

// ── Mobile menu ──────────────────────────────────────────────────────────────
function toggleMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  if (menu) menu.classList.toggle('hidden');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ── Newsletter ────────────────────────────────────────────────────────────────
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function setInlineStatus(statusEl, type, message) {
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.classList.remove('hidden', 'bg-green-50', 'text-green-700', 'border', 'border-green-100', 'bg-red-50', 'text-red-700', 'border-red-100');
  statusEl.classList.add('border');

  if (type === 'success') {
    statusEl.classList.add('bg-green-50', 'text-green-700', 'border-green-100');
  } else {
    statusEl.classList.add('bg-red-50', 'text-red-700', 'border-red-100');
  }
}

function clearInlineStatus(statusEl) {
  if (!statusEl) return;
  statusEl.textContent = '';
  statusEl.classList.add('hidden');
}

function setupNewsletterForm() {
  const form = document.querySelector('[data-newsletter-form]');
  if (!form) return;

  const submitButton = form.querySelector('[data-newsletter-submit]');
  const statusEl = form.querySelector('[data-newsletter-status]');
  let isSending = false;

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (isSending) return;

    const email = (form.elements.email?.value || '').trim();
    const website = (form.elements.website?.value || '').trim();
    if (!isValidEmail(email)) {
      setInlineStatus(statusEl, 'error', 'Please enter a valid email address.');
      return;
    }

    clearInlineStatus(statusEl);
    isSending = true;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Subscribing...';
      submitButton.classList.add('opacity-70', 'cursor-not-allowed');
    }

    try {
      const response = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, website })
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(result.error || 'Subscription could not be sent.');
      }

      form.reset();
      setInlineStatus(statusEl, 'success', 'Thanks for joining the PTG squad. We have received your subscription.');
    } catch (error) {
      setInlineStatus(statusEl, 'error', 'Sorry, your subscription could not be sent. Please try again.');
    } finally {
      isSending = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Subscribe';
        submitButton.classList.remove('opacity-70', 'cursor-not-allowed');
      }
    }
  });
}

function setupContactForm() {
  const form = document.querySelector('[data-contact-form]');
  if (!form) return;

  const submitButton = form.querySelector('[data-contact-submit]');
  const statusEl = form.querySelector('[data-contact-status]');
  let isSending = false;

  const setStatus = (type, message) => {
    setInlineStatus(statusEl, type, message);
  };

  const clearStatus = () => {
    clearInlineStatus(statusEl);
  };

  const getFormData = () => ({
    name: (form.elements.name?.value || '').trim().replace(/\s+/g, ' '),
    email: (form.elements.email?.value || '').trim(),
    message: (form.elements.message?.value || '').trim(),
    website: (form.elements.website?.value || '').trim()
  });

  const validateContactData = data => {
    if (!data.name) return 'Please enter your name.';
    if (!isValidEmail(data.email)) return 'Please enter a valid email address.';
    if (!data.message) return 'Please enter your message.';
    return '';
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (isSending) return;

    const data = getFormData();
    const validationError = validateContactData(data);

    if (validationError) {
      setStatus('error', validationError);
      return;
    }

    clearStatus();
    isSending = true;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Sending...';
      submitButton.classList.add('opacity-70', 'cursor-not-allowed');
    }

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(result.error || 'Message could not be sent.');
      }

      form.reset();
      setStatus('success', "Thank you! Your message has been sent successfully. We'll get back to you as soon as possible.");
    } catch (error) {
      setStatus('error', "Sorry, your message couldn't be sent. Please try again in a moment.");
    } finally {
      isSending = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Send Message';
        submitButton.classList.remove('opacity-70', 'cursor-not-allowed');
      }
    }
  });
}

function renderProductCards() {
  if (!Array.isArray(window.PTG_PRODUCTS || globalThis.PTG_PRODUCTS)) return;

  const products = window.PTG_PRODUCTS || globalThis.PTG_PRODUCTS;

  document.querySelectorAll('[data-product-grid]').forEach(grid => {
    const scope = grid.dataset.productGrid;
    const isShop = scope === 'shop';
    const requestedSlug = grid.dataset.productSlug || '';
    const cardProducts = requestedSlug
      ? products.filter(product => product.slug === requestedSlug || product.id === requestedSlug)
      : scope === 'featured'
      ? products.filter(product => product.featured)
      : products;

    grid.innerHTML = cardProducts.length
      ? cardProducts.map(product => renderProductCard(product, isShop, Boolean(requestedSlug))).join('')
      : '<p class="product-load-error">This product is not currently available.</p>';
  });
}

function renderHomeProductCarousel() {
  const carousel = document.querySelector('[data-home-product-carousel]');
  if (!carousel || window.PTG_PRODUCTS_SOURCE !== 'd1') return;
  const products = getProducts().filter(product => product.available === true && product.active !== false);
  const track = carousel.querySelector('[data-home-carousel-track]');
  const dots = carousel.querySelector('[data-home-carousel-dots]');
  const status = carousel.querySelector('[data-home-carousel-status]');
  const previous = carousel.querySelector('[data-home-carousel-prev]');
  const next = carousel.querySelector('[data-home-carousel-next]');
  if (!products.length) {
    track.innerHTML = '<p class="home-carousel-loading">No products are currently available.</p>';
    previous.hidden = true;
    next.hidden = true;
    return;
  }

  track.innerHTML = products.map((product, index) => `
    <article class="home-carousel-slide" aria-hidden="${index ? 'true' : 'false'}">
      <a class="home-carousel-image" href="/products/${encodeURIComponent(product.slug || product.id)}">
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" ${index ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">
      </a>
      <div class="home-carousel-copy">
        <p class="home-carousel-kicker">${escapeHtml(product.productType || product.type || 'Sportswear')}</p>
        <h3>${escapeHtml(product.name)}</h3>
        <p class="home-carousel-price">${formatMoney(product.price).replace('.00', '')}</p>
        ${renderStockStatus(product)}
        <a class="btn-primary home-carousel-action" href="/products/${encodeURIComponent(product.slug || product.id)}">View Product</a>
      </div>
    </article>`).join('');
  dots.innerHTML = products.map((product, index) => `<button type="button" class="${index ? '' : 'is-active'}" aria-label="View ${escapeHtml(product.name)}" aria-current="${index ? 'false' : 'true'}"></button>`).join('');
  previous.hidden = products.length < 2;
  next.hidden = products.length < 2;

  let current = 0;
  let timer = 0;
  let pointerStart = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const slides = [...track.children];
  const dotButtons = [...dots.children];
  const show = (index, manual = false) => {
    current = (index + products.length) % products.length;
    track.style.transform = `translateX(-${current * 100}%)`;
    slides.forEach((slide, slideIndex) => slide.setAttribute('aria-hidden', slideIndex === current ? 'false' : 'true'));
    dotButtons.forEach((dot, dotIndex) => {
      dot.classList.toggle('is-active', dotIndex === current);
      dot.setAttribute('aria-current', dotIndex === current ? 'true' : 'false');
    });
    if (manual) status.textContent = `${products[current].name}, product ${current + 1} of ${products.length}`;
  };
  const stop = () => { if (timer) window.clearInterval(timer); timer = 0; };
  const start = () => {
    stop();
    if (products.length < 2 || reducedMotion.matches || document.hidden) return;
    timer = window.setInterval(() => show(current + 1), 5500);
  };
  const interact = index => { stop(); show(index, true); };
  previous.addEventListener('click', () => interact(current - 1));
  next.addEventListener('click', () => interact(current + 1));
  dotButtons.forEach((dot, index) => dot.addEventListener('click', () => interact(index)));
  carousel.addEventListener('mouseenter', stop);
  carousel.addEventListener('mouseleave', start);
  carousel.addEventListener('focusin', stop);
  carousel.addEventListener('focusout', event => { if (!carousel.contains(event.relatedTarget)) start(); });
  carousel.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      interact(current + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  carousel.addEventListener('pointerdown', event => { pointerStart = event.clientX; stop(); });
  carousel.addEventListener('pointerup', event => {
    if (pointerStart !== null && Math.abs(event.clientX - pointerStart) > 45) interact(current + (event.clientX < pointerStart ? 1 : -1));
    pointerStart = null;
  });
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
  reducedMotion.addEventListener?.('change', start);
  show(0);
  start();
}

function renderProductCard(product, isShop, isProductPage = false) {
  const cardClasses = isShop
    ? 'product-card product-card-shop product-item group bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl border border-gray-100'
    : 'product-card group bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl border border-gray-100';
  const imageHeight = isShop ? 'h-80' : 'h-72';
  const bodyPadding = isShop ? 'p-5 sm:p-6' : 'p-5';
  const titleClass = isShop ? 'font-semibold text-gray-900 text-base leading-snug' : 'font-semibold text-gray-900';
  const copyClass = isShop
    ? `text-gray-400 text-sm mt-2 leading-relaxed${isProductPage ? '' : ' product-card-description'}`
    : 'text-gray-400 text-sm mt-1';
  const priceClass = isShop ? 'text-lg font-bold text-gray-900' : 'text-xl font-bold';
  const buttonClass = isShop ? 'btn-primary px-5 py-2.5 text-sm' : 'btn-primary px-5 py-2 text-sm';
  const actionMargin = isShop ? 'mt-5' : 'mt-4';
  const badgeTextSize = isShop ? 'text-[10px] px-2.5' : 'text-[11px] px-3';
  const hasInventoryVariants = Array.isArray(product.inventoryVariants);
  const variantMarkup = hasInventoryVariants ? renderInventoryVariantSelect(product, isShop) : renderVariantSelect(product, isShop);
  const sizeMarkup = hasInventoryVariants ? '' : renderSizeSelect(product, isShop);
  const initialStyle = product.inventoryVariants?.find(variant => variant.available)?.style || '';
  const gallery = getProductGallery(product, initialStyle);
  const galleryCount = gallery.length;

  return `
      <div class="${cardClasses}" data-product-name="${escapeHtml(product.name)}" data-category="${escapeHtml(product.category)}" data-personalisable="${product.personalisable ? 'true' : 'false'}" data-allow-player-name="${product.allowPlayerName ?? product.personalisable ? 'true' : 'false'}" data-allow-player-number="${product.allowPlayerNumber ?? product.personalisable ? 'true' : 'false'}" data-name-price="${Number(product.playerNamePrice ?? PERSONALISATION_ADDON_PRICE)}" data-number-price="${Number(product.playerNumberPrice ?? PERSONALISATION_ADDON_PRICE)}">
        <div class="product-image-wrap relative overflow-hidden ${imageHeight}">
          <button type="button" class="product-image-button" onclick='openProductLightbox(${escapeJsString(product.name)}, 0, this)' aria-label="View ${escapeHtml(product.name)} image gallery">
            <img data-product-image src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" class="product-image w-full h-full group-hover:scale-105 transition-transform duration-500">
            ${galleryCount > 1 ? `<span class="product-gallery-count">${galleryCount} angles</span>` : ''}
          </button>
          ${product.badge ? `<span class="absolute top-3 left-3 bg-brand text-white ${badgeTextSize} py-1 rounded-full font-semibold">${escapeHtml(product.badge)}</span>` : ''}
        </div>
        <div class="${bodyPadding} product-card-content">
          <p class="text-xs text-gray-400 uppercase tracking-wider mb-1">${escapeHtml(product.type)}</p>
          <h3 class="${titleClass}"><a href="/products/${encodeURIComponent(product.slug || product.id)}" class="hover:text-brand transition-colors">${escapeHtml(product.name)}</a></h3>
          <p class="${copyClass}">${escapeHtml(product.description)}</p>
          ${renderStockStatus(product)}
          ${variantMarkup}
          ${sizeMarkup}
          <div class="product-actions flex items-center justify-between ${actionMargin}">
            <span class="${priceClass}">${formatMoney(product.price).replace('.00', '')}</span>
            <button onclick='addToCart(${escapeJsString(product.id)}, ${escapeJsString(product.name)}, ${Number(product.price)}, this)' class="${buttonClass}" ${product.available === false ? 'disabled aria-disabled="true"' : ''}>${product.available === false ? 'Out of Stock' : 'Add to Cart'}</button>
          </div>
        </div>
      </div>
  `;
}

function renderStockStatus(product) {
  if (!product.stockStatus) return '';
  const labels = { in_stock: 'In Stock', low_stock: 'Only a few left', out_of_stock: 'Out of Stock' };
  return `<p class="stock-status stock-${escapeHtml(product.stockStatus)}">${labels[product.stockStatus] || 'Availability unavailable'}</p>`;
}

function renderInventoryVariantSelect(product, isShop) {
  const variants = product.inventoryVariants || [];
  if (!variants.length) return '';
  const id = `${isShop ? 'shop' : 'home'}-${slugify(product.name)}-inventory-option`;
  const hasMoreThanSize = variants.some(variant => variant.colour || variant.style);
  return `
          <div class="product-option">
            <label for="${id}">${hasMoreThanSize ? 'Size / Option' : 'Size'}</label>
            <select id="${id}" data-inventory-variant>
              ${variants.map(variant => `<option value="${Number(variant.id)}" data-size="${escapeHtml(variant.size)}" data-colour="${escapeHtml(variant.colour)}" data-style="${escapeHtml(variant.style)}" data-allow-player-name="${variant.allowPlayerName ? 'true' : 'false'}" data-allow-player-number="${variant.allowPlayerNumber ? 'true' : 'false'}" ${variant.available ? '' : 'disabled'}>${escapeHtml(variant.label)}${variant.available ? variant.stockStatus === 'low_stock' ? ' - Only a few left' : '' : ' - Out of Stock'}</option>`).join('')}
            </select>
          </div>`;
}

function renderVariantSelect(product, isShop) {
  if (!Array.isArray(product.variants) || product.variants.length === 0) return '';

  const id = `${isShop ? 'shop' : 'home'}-${slugify(product.name)}-colour`;
  return `
          <div class="product-option">
            <label for="${id}">Colour</label>
            <select id="${id}" data-product-variant>
              ${product.variants.map(variant => `
              <option value="${escapeHtml(variant.value)}" data-image="${escapeHtml(variant.image)}" data-alt="${escapeHtml(variant.alt)}">${escapeHtml(variant.label)}</option>`).join('')}
            </select>
          </div>
  `;
}

function renderSizeSelect(product, isShop) {
  if (!Array.isArray(product.sizes) || product.sizes.length === 0) return '';

  const id = `${isShop ? 'shop' : 'home'}-${slugify(product.name)}-size`;
  return `
          <div class="product-option">
            <label for="${id}">Size</label>
            <select id="${id}" data-product-size>
              ${product.sizes.map(size => `<option value="${escapeHtml(size)}">${escapeHtml(size)}</option>`).join('')}
            </select>
          </div>
  `;
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

let activeLightboxProduct = null;
let activeLightboxImages = [];
let activeLightboxIndex = 0;
let activeLightboxTrigger = null;

function getProductGallery(product, style = '') {
  if (style && Array.isArray(product.galleryImages)) {
    const styled = product.galleryImages.filter(image => !image.style || image.style === style).map(image => image.src).filter(Boolean);
    if (styled.length) return styled;
  }
  const gallery = Array.isArray(product.gallery) && product.gallery.length ? product.gallery : [product.image];
  return gallery.filter(Boolean);
}

function setupProductCardCarousels() {
  const products = window.PTG_PRODUCTS || globalThis.PTG_PRODUCTS || [];

  document.querySelectorAll('.product-card').forEach(card => {
    const product = products.find(item => item.name === card.dataset.productName);
    const image = card.querySelector('[data-product-image]');
    let gallery = product ? getProductGallery(product, card.querySelector('[data-inventory-variant] option:checked')?.dataset.style || '') : [];

    if (!product || !image || gallery.length < 2) return;

    let activeIndex = gallery.findIndex(src => src === image.getAttribute('src'));
    if (activeIndex < 0) activeIndex = 0;

    let timer = null;
    let isSwapping = false;

    const swapImage = nextIndex => {
      if (isSwapping) return;

      activeIndex = (nextIndex + gallery.length) % gallery.length;
      isSwapping = true;
      image.classList.add('is-transitioning');

      window.setTimeout(() => {
        image.src = gallery[activeIndex];
        image.alt = `${product.name} image ${activeIndex + 1}`;
        image.classList.remove('is-transitioning');
        isSwapping = false;
      }, 180);
    };

    const startCarousel = () => {
      if (timer || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      timer = window.setInterval(() => swapImage(activeIndex + 1), 1800);
    };

    const stopCarousel = () => {
      if (!timer) return;
      window.clearInterval(timer);
      timer = null;
    };

    card.addEventListener('mouseenter', startCarousel);
    card.addEventListener('mouseleave', stopCarousel);
    card.addEventListener('focusin', startCarousel);
    card.addEventListener('focusout', stopCarousel);
    card.addEventListener('pointerdown', stopCarousel);
    card.querySelector('[data-inventory-variant]')?.addEventListener('change', event => {
      gallery = getProductGallery(product, event.target.options[event.target.selectedIndex]?.dataset.style || '');
      activeIndex = 0;
      if (gallery[0]) image.src = gallery[0];
    });
  });
}

function setupProductLightbox() {
  if (document.getElementById('product-lightbox')) return;

  document.body.insertAdjacentHTML('beforeend', `
    <div id="product-lightbox" class="product-lightbox is-hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="product-lightbox-title">
      <button type="button" class="product-lightbox-backdrop" onclick="closeProductLightbox()" aria-label="Close image gallery"></button>
      <div class="product-lightbox-panel">
        <div class="product-lightbox-header">
          <div>
            <p id="product-lightbox-title" class="product-lightbox-title"></p>
            <p id="product-lightbox-counter" class="product-lightbox-counter"></p>
          </div>
          <button type="button" class="product-lightbox-close" onclick="closeProductLightbox()" aria-label="Close image gallery">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="product-lightbox-stage">
          <button type="button" class="product-lightbox-nav product-lightbox-prev" onclick="changeLightboxImage(-1)" aria-label="Previous image">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <img id="product-lightbox-image" class="product-lightbox-image" src="" alt="">
          <button type="button" class="product-lightbox-nav product-lightbox-next" onclick="changeLightboxImage(1)" aria-label="Next image">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
        <div id="product-lightbox-thumbnails" class="product-lightbox-thumbnails"></div>
      </div>
    </div>
  `);

  document.addEventListener('keydown', event => {
    const lightbox = document.getElementById('product-lightbox');
    if (!lightbox || lightbox.classList.contains('is-hidden')) return;

    if (event.key === 'Escape') closeProductLightbox();
    if (event.key === 'ArrowLeft') changeLightboxImage(-1);
    if (event.key === 'ArrowRight') changeLightboxImage(1);
    if (event.key === 'Tab') {
      const focusable = [...lightbox.querySelectorAll('button:not([hidden]), a[href], [tabindex]:not([tabindex="-1"])')].filter(item => !item.disabled);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
}

function openProductLightbox(productName, index = 0, trigger = null) {
  const products = window.PTG_PRODUCTS || globalThis.PTG_PRODUCTS || [];
  const product = products.find(item => item.name === productName);
  if (!product) return;

  setupProductLightbox();
  activeLightboxTrigger = trigger || document.activeElement;
  activeLightboxProduct = product;
  const style = trigger?.closest('.product-card')?.querySelector('[data-inventory-variant] option:checked')?.dataset.style || '';
  activeLightboxImages = getProductGallery(product, style);
  activeLightboxIndex = Math.min(Math.max(Number(index) || 0, 0), activeLightboxImages.length - 1);
  renderProductLightbox();

  const lightbox = document.getElementById('product-lightbox');
  lightbox.classList.remove('is-hidden');
  lightbox.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  lightbox.querySelector('.product-lightbox-close')?.focus();
}

function closeProductLightbox() {
  const lightbox = document.getElementById('product-lightbox');
  if (!lightbox) return;

  lightbox.classList.add('is-hidden');
  lightbox.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  activeLightboxTrigger?.focus?.();
  activeLightboxTrigger = null;
}

function changeLightboxImage(delta) {
  if (!activeLightboxImages.length) return;
  activeLightboxIndex = (activeLightboxIndex + delta + activeLightboxImages.length) % activeLightboxImages.length;
  renderProductLightbox();
}

function setLightboxImage(index) {
  activeLightboxIndex = Number(index) || 0;
  renderProductLightbox();
}

function renderProductLightbox() {
  if (!activeLightboxProduct || !activeLightboxImages.length) return;

  const image = document.getElementById('product-lightbox-image');
  const title = document.getElementById('product-lightbox-title');
  const counter = document.getElementById('product-lightbox-counter');
  const thumbnails = document.getElementById('product-lightbox-thumbnails');
  const currentImage = activeLightboxImages[activeLightboxIndex];

  if (image) {
    image.classList.remove('is-loaded');
    image.src = currentImage;
    image.alt = `${activeLightboxProduct.name} image ${activeLightboxIndex + 1}`;
    requestAnimationFrame(() => image.classList.add('is-loaded'));
  }

  if (title) title.textContent = activeLightboxProduct.name;
  if (counter) counter.textContent = `${activeLightboxIndex + 1} of ${activeLightboxImages.length}`;

  if (thumbnails) {
    thumbnails.innerHTML = activeLightboxImages.map((src, index) => `
      <button type="button" class="product-lightbox-thumb ${index === activeLightboxIndex ? 'is-active' : ''}" onclick="setLightboxImage(${index})" aria-label="View image ${index + 1}">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(activeLightboxProduct.name)} thumbnail ${index + 1}">
      </button>
    `).join('');
  }
  document.querySelectorAll('.product-lightbox-nav').forEach(button => { button.hidden = activeLightboxImages.length < 2; });
}

function setupPersonalisationOptions() {
  document.querySelectorAll('.product-card').forEach((card, index) => {
    const button = card.querySelector('button[onclick^="addToCart"]');
    if (card.dataset.personalisable !== 'true') return;
    if (!button || card.querySelector('.personalisation-options')) return;

    const actionRow = button.closest('.flex.items-center.justify-between');
    if (!actionRow) return;

    const idBase = `personalisation-${index}`;
    const namePrice = Number(card.dataset.namePrice || PERSONALISATION_ADDON_PRICE);
    const numberPrice = Number(card.dataset.numberPrice || PERSONALISATION_ADDON_PRICE);
    const allowName = card.dataset.allowPlayerName === 'true';
    const allowNumber = card.dataset.allowPlayerNumber === 'true';
    const options = document.createElement('div');
    options.className = 'personalisation-options';
    options.innerHTML = `
      ${allowName ? `<label class="personalisation-field" data-player-field="name" for="${idBase}-name">
        <span>Player Name <strong>${namePrice > 0 ? `(+${formatMoney(namePrice)})` : '(Optional)'}</strong></span>
        <input id="${idBase}-name" data-personalisation="name" type="text" maxlength="20" autocomplete="off" placeholder="Optional player name">
      </label>` : ''}
      ${allowNumber ? `<label class="personalisation-field" data-player-field="number" for="${idBase}-number">
        <span>Player Number <strong>${numberPrice > 0 ? `(+${formatMoney(numberPrice)})` : '(Optional)'}</strong></span>
        <input id="${idBase}-number" data-personalisation="number" type="text" inputmode="numeric" maxlength="2" pattern="(?:0|00|[1-9][0-9]?)" title="Enter a jersey number from 0 to 99" placeholder="Optional number">
      </label>` : ''}
    `;

    actionRow.before(options);

    const numberInput = options.querySelector('[data-personalisation="number"]');
    if (numberInput) {
      numberInput.addEventListener('input', () => {
        numberInput.value = numberInput.value.replace(/[^\d]/g, '').slice(0, 2);
        numberInput.setCustomValidity('');
      });
    }
    updatePersonalisationForVariant(card);
  });
}

function updatePersonalisationForVariant(card) {
  const select = card?.querySelector('[data-inventory-variant]');
  if (!select) return;
  const selected = select.options[select.selectedIndex];
  for (const type of ['name', 'number']) {
    const field = card.querySelector(`[data-player-field="${type}"]`);
    const input = card.querySelector(`[data-personalisation="${type}"]`);
    if (!field || !input) continue;
    const allowed = selected?.dataset[type === 'name' ? 'allowPlayerName' : 'allowPlayerNumber'] === 'true';
    field.hidden = !allowed;
    input.disabled = !allowed;
    if (!allowed) input.value = '';
  }
}

// ── Shop page filter ──────────────────────────────────────────────────────────
function setupProductVariants() {
  document.querySelectorAll('[data-inventory-variant]').forEach(select => {
    const card = select.closest('.product-card');
    const product = getProducts().find(item => item.name === card?.dataset.productName);
    const image = card?.querySelector('[data-product-image]');
    select.addEventListener('change', () => {
      const selected = select.options[select.selectedIndex];
      const gallery = product ? getProductGallery(product, selected?.dataset.style || '') : [];
      if (image && gallery[0]) { image.src = gallery[0]; image.alt = `${product.name} ${selected?.dataset.style || ''}`.trim(); }
      updatePersonalisationForVariant(card);
    });
    updatePersonalisationForVariant(card);
  });
  document.querySelectorAll('[data-product-variant]').forEach(select => {
    const card = select.closest('.product-card');
    const image = card ? card.querySelector('[data-product-image]') : null;
    if (!image) return;

    select.addEventListener('change', () => {
      const selected = select.options[select.selectedIndex];
      const imageSrc = selected.dataset.image;
      if (!imageSrc) return;

      image.src = imageSrc;
      image.alt = selected.dataset.alt || image.alt;
    });
  });
}

function filterProducts(category) {
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  const activeFilter = document.querySelector(`[data-filter="${category}"]`);
  if (activeFilter) activeFilter.classList.add('active');

  document.querySelectorAll('.product-item').forEach(card => {
    const cat = card.dataset.category;
    card.style.display = (category === 'all' || cat === category) ? '' : 'none';
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
function initialiseProductExperience() {
  renderProductCards();
  renderHomeProductCarousel();
  setupProductLightbox();
  setupPersonalisationOptions();
  setupProductVariants();
  setupProductCardCarousels();
}

function refreshCartFromDatabaseProducts() {
  let changed = false;
  cart.forEach(item => {
    const product = getProducts().find(candidate => candidate.id === item.id);
    if (!product) return;

    const namePrice = Number(product.playerNamePrice ?? PERSONALISATION_ADDON_PRICE);
    const numberPrice = Number(product.playerNumberPrice ?? PERSONALISATION_ADDON_PRICE);
    const addOnTotal = (item.personalisation?.name ? namePrice : 0) + (item.personalisation?.number ? numberPrice : 0);
    item.basePrice = Number(product.price);
    item.price = item.basePrice + addOnTotal;
    item.personalisationPrices = { name: namePrice, number: numberPrice };

    if (!item.variantId && Array.isArray(product.inventoryVariants)) {
      const match = product.inventoryVariants.find(variant => {
        const option = [variant.colour, variant.style].filter(Boolean).join(' / ');
        return variant.size === (item.size || '') && option === (item.variant || '');
      });
      if (match) item.variantId = match.id;
    }
    changed = true;
  });
  if (changed) saveCart();
}

async function loadDatabaseProducts() {
  try {
    const response = await fetch('/api/products', { headers: { Accept: 'application/json' } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok || !Array.isArray(result.products)) return;
    window.PTG_PRODUCTS = result.products;
    window.PTG_PRODUCTS_SOURCE = 'd1';
    refreshCartFromDatabaseProducts();
    initialiseProductExperience();
    updateCartUI();
  } catch (error) {
    // The checked-in catalogue remains available during migration or an API outage.
  }
}

initialiseProductExperience();
setupNewsletterForm();
setupContactForm();
setupCheckout();
updateCartUI();
loadDatabaseProducts();
