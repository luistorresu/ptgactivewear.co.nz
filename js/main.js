// ── Cart state (persisted to localStorage) ──────────────────────────────────
let cart = [];
try {
  const savedCart = JSON.parse(localStorage.getItem('ptg-cart') || '[]');
  cart = Array.isArray(savedCart) ? savedCart : [];
} catch (error) {
  cart = [];
}
const PERSONALISATION_ADDON_PRICE = 20;
const TRAINING_KIT_ID = 'patagonia-fc-training-kit';
const RESTRICTED_SHIRT_NUMBERS = new Set(['1', '7', '9', '10']);
const CHECKOUT_ATTEMPT_KEY = 'ptg-checkout-attempt';
const CHECKOUT_CUSTOMER_KEY = 'ptg-checkout-customer';
const CHECKOUT_PROMOTION_KEY = 'ptg-checkout-promotion';
const CUSTOMER_NAME_MAX_LENGTH = 100;
const CHILD_NAME_MAX_LENGTH = 60;
let checkoutSummaryTimer = 0;
let checkoutSummaryRequest = 0;
let fulfilmentType = ['pickup', 'delivery'].includes(localStorage.getItem('ptg-fulfilment'))
  ? localStorage.getItem('ptg-fulfilment')
  : '';
let checkoutCustomerDetails = { customerName: '', childName: '' };
let appliedPromotionCode = '';
try {
  const savedCustomer = JSON.parse(sessionStorage.getItem(CHECKOUT_CUSTOMER_KEY) || '{}');
  if (savedCustomer && typeof savedCustomer === 'object' && !Array.isArray(savedCustomer)) {
    checkoutCustomerDetails.customerName = typeof savedCustomer.customerName === 'string' ? savedCustomer.customerName.slice(0, CUSTOMER_NAME_MAX_LENGTH) : '';
    checkoutCustomerDetails.childName = typeof savedCustomer.childName === 'string' ? savedCustomer.childName.slice(0, CHILD_NAME_MAX_LENGTH) : '';
  }
} catch {}
try { appliedPromotionCode = String(sessionStorage.getItem(CHECKOUT_PROMOTION_KEY) || '').slice(0, 64); } catch {}

function saveCart({ invalidateCheckout = true } = {}) {
  localStorage.setItem('ptg-cart', JSON.stringify(cart, (key, value) =>
    ['birthDay', 'birthdayDay', 'dayOfBirth'].includes(key) ? undefined : value));
  if (invalidateCheckout) clearCheckoutAttempt();
}

function clearCheckoutAttempt() {
  try { sessionStorage.removeItem(CHECKOUT_ATTEMPT_KEY); } catch {}
}

function checkoutRequestId(payload) {
  const signature = JSON.stringify({ fulfilmentType: payload.fulfilmentType, customerDetails: payload.customerDetails, promotionCode: payload.promotionCode, items: payload.items });
  try {
    const stored = JSON.parse(sessionStorage.getItem(CHECKOUT_ATTEMPT_KEY) || 'null');
    if (stored?.signature === signature && /^[A-Za-z0-9_-]{8,64}$/.test(stored.requestId || '')) return stored.requestId;
    const requestId = crypto.randomUUID();
    sessionStorage.setItem(CHECKOUT_ATTEMPT_KEY, JSON.stringify({ signature, requestId }));
    return requestId;
  } catch {
    return crypto.randomUUID();
  }
}

function normaliseCheckoutName(value) {
  return String(value || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function checkoutNameError(value, label, maxLength) {
  const normalised = normaliseCheckoutName(value);
  if (!normalised) return `${label} is required.`;
  if ([...normalised].length > maxLength) return `${label} must be ${maxLength} characters or fewer.`;
  if (!/^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u.test(normalised)) {
    return `${label} may contain letters, spaces, hyphens, and apostrophes only.`;
  }
  return '';
}

function saveCheckoutCustomerDetails() {
  try { sessionStorage.setItem(CHECKOUT_CUSTOMER_KEY, JSON.stringify(checkoutCustomerDetails)); } catch {}
}

function validateCheckoutCustomerForm({ focus = false } = {}) {
  const section = document.querySelector('[data-checkout-customer-details]');
  const fields = [
    { key: 'customerName', selector: '[data-checkout-customer-name]', label: 'Customer Name', maxLength: CUSTOMER_NAME_MAX_LENGTH },
    { key: 'childName', selector: '[data-checkout-child-name]', label: "Child's Name", maxLength: CHILD_NAME_MAX_LENGTH }
  ];
  let firstInvalid = null;
  for (const field of fields) {
    const input = section?.querySelector(field.selector);
    const value = input ? input.value : checkoutCustomerDetails[field.key];
    const error = checkoutNameError(value, field.label, field.maxLength);
    const errorElement = section?.querySelector(`[data-checkout-customer-error="${field.key}"]`);
    if (input) input.toggleAttribute('aria-invalid', Boolean(error));
    if (errorElement) errorElement.textContent = error;
    if (error && !firstInvalid) firstInvalid = input;
    if (!error) checkoutCustomerDetails[field.key] = normaliseCheckoutName(value);
  }
  saveCheckoutCustomerDetails();
  if (focus && firstInvalid) {
    firstInvalid.focus();
    firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return firstInvalid ? null : { ...checkoutCustomerDetails };
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

function personalisationOptionPrice(product, field) {
  return Number(product?.[field] ?? PERSONALISATION_ADDON_PRICE);
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
  const isTrainingKit = item.id === TRAINING_KIT_ID;
  const priceSuffix = price => price > 0 ? ` (+${formatMoney(price)})` : '';
  if (personalisation.name) details.push(`${isTrainingKit ? 'Player Name' : 'Name'}: ${escapeHtml(personalisation.name)}${priceSuffix(namePrice)}`);
  if (personalisation.number) {
    details.push(`${isTrainingKit ? 'Shirt Number' : 'Number'}: ${escapeHtml(personalisation.number)}${priceSuffix(numberPrice)}`);
    if (isTrainingKit) details.push('Requested shirt number — subject to final availability.');
    if (isTrainingKit && RESTRICTED_SHIRT_NUMBERS.has(personalisation.number)) {
      details.push(`Restricted number eligibility: ${item.restrictedNumberEligibilityVerified ? 'verified' : 'verification required'}.`);
    }
  }

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
        <div class="cart-line-item">
          <div class="min-w-0">
            <p class="font-medium text-gray-900 text-sm truncate">${escapeHtml(item.name)}</p>
            <p class="text-gray-500 text-xs mt-0.5">${formatMoney(itemPrice)} each</p>
            ${renderPersonalisationDetails(item)}
          </div>
          <div class="cart-line-item-actions">
            <div class="cart-quantity-control" role="group" aria-label="Quantity for ${escapeHtml(item.name)}">
              <button type="button" onclick="changeQty(${i},-1)" aria-label="Decrease quantity for ${escapeHtml(item.name)}" class="cart-quantity-button">−</button>
              <span class="cart-quantity-value" aria-label="Quantity ${item.qty}">${item.qty}</span>
              <button type="button" onclick="changeQty(${i},1)" aria-label="Increase quantity for ${escapeHtml(item.name)}" class="cart-quantity-button">+</button>
            </div>
            <button type="button" onclick="removeItem(${i})" data-remove-cart-item="${i}" aria-label="Remove ${escapeHtml(item.name)} from cart" class="cart-remove-button">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/>
              </svg>
              <span>Remove</span>
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
  const birthDayInput = card ? card.querySelector('[data-shirt-number-birth-day]') : null;
  const playerName = (nameInput?.value || '').trim().replace(/\s+/g, ' ');
  const jerseyNumber = (numberInput?.value || '').trim();
  const birthDay = (birthDayInput?.value || '').trim();
  const isTrainingKit = card?.dataset.productId === TRAINING_KIT_ID;

  const setError = (field, message = '') => {
    const error = card?.querySelector(`[data-personalisation-error="${field}"]`);
    if (error) error.textContent = message;
    const input = field === 'name' ? nameInput : field === 'number' ? numberInput : birthDayInput;
    if (input) input.toggleAttribute('aria-invalid', Boolean(message));
  };
  setError('name');
  setError('number');
  setError('birth-day');

  if (isTrainingKit && playerName && !/^[\p{L} '’-]{1,20}$/u.test(playerName)) {
    setError('name', 'Use letters, spaces, hyphens, and apostrophes only.');
    nameInput?.focus();
    return null;
  }

  if (isTrainingKit && jerseyNumber && !/^(?:[1-9]|[1-9][0-9])$/.test(jerseyNumber)) {
    setError('number', 'Enter a whole Shirt Number from 1 to 99.');
    numberInput?.focus();
    return null;
  }

  if (isTrainingKit && RESTRICTED_SHIRT_NUMBERS.has(jerseyNumber) && birthDay !== jerseyNumber) {
    setError('birth-day', `Shirt number ${jerseyNumber} is only available to players born on the ${jerseyNumber}${jerseyNumber === '1' ? 'st' : 'th'} day of the month. Please enter the correct day or choose another number.`);
    birthDayInput?.focus();
    return null;
  }

  if (!isTrainingKit && jerseyNumber && !/^(?:0|00|[1-9][0-9]?)$/.test(jerseyNumber)) {
    showToast('Enter a jersey number from 0 to 99');
    numberInput.focus();
    return null;
  }

  return {
    name: playerName.slice(0, 20),
    number: jerseyNumber,
    birthDay
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

async function addToCart(productId, name, price, trigger) {
  if (trigger?.dataset.adding === 'true') return;
  const personalisation = getPersonalisation(trigger);
  if (!personalisation) return;

  let shirtNumberEligibilityToken = '';
  const restrictedTrainingNumber = productId === TRAINING_KIT_ID && RESTRICTED_SHIRT_NUMBERS.has(personalisation.number);
  if (restrictedTrainingNumber) {
    trigger.dataset.adding = 'true';
    trigger.disabled = true;
    trigger.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/training-kit-number-eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shirtNumber: personalisation.number, birthDay: personalisation.birthDay })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok || !result.eligibilityToken) {
        throw new Error(result.error || 'Shirt-number validation could not be completed.');
      }
      shirtNumberEligibilityToken = result.eligibilityToken;
    } catch (error) {
      const card = trigger.closest('.product-card');
      const fieldError = card?.querySelector('[data-personalisation-error="birth-day"]');
      if (fieldError) fieldError.textContent = error.message;
      card?.querySelector('[data-shirt-number-birth-day]')?.focus();
      showToast(error.message);
      return;
    } finally {
      trigger.dataset.adding = 'false';
      trigger.disabled = false;
      trigger.removeAttribute('aria-busy');
    }
  }

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
  const namePrice = personalisationOptionPrice(product, 'playerNamePrice');
  const numberPrice = personalisationOptionPrice(product, 'playerNumberPrice');
  const addOnTotal =
    (personalisation.name ? namePrice : 0) +
    (personalisation.number ? numberPrice : 0);
  const finalPrice = basePrice + addOnTotal;
  const existing = cart.find(i => (i.id === productId || i.name === name) && sameVariantId(i.variantId, variantId) && sameVariant(i.variant, variant) && sameSize(i.size, size) && samePersonalisation(i.personalisation, personalisation));

  if (existing) {
    if (existing.qty >= 20) { showToast('Maximum quantity is 20 per option'); return; }
    existing.qty++;
    if (shirtNumberEligibilityToken) {
      existing.shirtNumberEligibilityToken = shirtNumberEligibilityToken;
      existing.restrictedNumberEligibilityVerified = true;
    }
  } else {
    cart.push({
      id: productId,
      name,
      basePrice,
      price: finalPrice,
      qty: 1,
      variantId,
      variant,
      size,
      personalisation: { name: personalisation.name, number: personalisation.number },
      personalisationPrices: { name: namePrice, number: numberPrice },
      shirtNumberEligibilityToken,
      restrictedNumberEligibilityVerified: Boolean(shirtNumberEligibilityToken)
    });
  }
  const birthDayInput = trigger.closest('.product-card')?.querySelector('[data-shirt-number-birth-day]');
  if (birthDayInput) birthDayInput.value = '';
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
  const removedItem = cart[index];
  if (!removedItem) return;
  cart.splice(index, 1);
  saveCart();
  updateCartUI();
  showToast(`${removedItem.name} removed from cart`);
  requestAnimationFrame(() => {
    const nextIndex = Math.min(index, cart.length - 1);
    const nextRemoveButton = nextIndex >= 0
      ? document.querySelector(`[data-remove-cart-item="${nextIndex}"]`)
      : null;
    (nextRemoveButton || document.querySelector('#cart-sidebar button[aria-label="Close cart"]'))?.focus();
  });
}

// ── Cart sidebar ─────────────────────────────────────────────────────────────
let lastCartTrigger = null;

function toggleCart(forceOpen) {
  const sidebar  = document.getElementById('cart-sidebar');
  const overlay  = document.getElementById('cart-overlay');
  if (!sidebar) return;
  const wasOpen = sidebar.classList.contains('open');
  const isOpen = typeof forceOpen === 'boolean' ? forceOpen : !wasOpen;
  sidebar.classList.toggle('open', isOpen);
  overlay.classList.toggle('hidden', !isOpen);
  sidebar.setAttribute('role', 'dialog');
  sidebar.setAttribute('aria-modal', 'true');
  sidebar.setAttribute('aria-hidden', String(!isOpen));
  document.querySelectorAll('[onclick="toggleCart()"]:not(#cart-overlay)')
    .forEach(button => button.setAttribute('aria-expanded', String(isOpen)));
  document.querySelectorAll('body > header, body > main, body > footer, body > section').forEach(element => {
    if (element !== sidebar) element.toggleAttribute('inert', isOpen);
  });
  document.body.style.overflow = isOpen ? 'hidden' : '';
  if (isOpen) {
    lastCartTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestAnimationFrame(() => sidebar.querySelector('button[aria-label="Close cart"]')?.focus());
  } else if (wasOpen) {
    lastCartTrigger?.focus();
    lastCartTrigger = null;
  }
}

function buildCheckoutPayload() {
  return {
    fulfilmentType,
    customerDetails: { ...checkoutCustomerDetails },
    promotionCode: appliedPromotionCode,
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
        },
        shirtNumberEligibilityToken: item.shirtNumberEligibilityToken || ''
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
  let customerDetails = document.querySelector('[data-checkout-customer-details]');
  if (!customerDetails) {
    customerDetails = document.createElement('section');
    customerDetails.dataset.checkoutCustomerDetails = '';
    customerDetails.className = 'checkout-customer-details';
    customerDetails.setAttribute('aria-labelledby', 'checkout-customer-details-title');
    customerDetails.innerHTML = `
      <fieldset>
        <legend id="checkout-customer-details-title">Order details</legend>
        <label class="checkout-customer-field">
          <span>Customer Name</span>
          <input type="text" data-checkout-customer-name name="customer-name" autocomplete="name" maxlength="${CUSTOMER_NAME_MAX_LENGTH}" required aria-describedby="checkout-customer-name-error">
          <small id="checkout-customer-name-error" data-checkout-customer-error="customerName" role="alert"></small>
        </label>
        <label class="checkout-customer-field">
          <span>Child&rsquo;s Name</span>
          <input type="text" data-checkout-child-name name="child-name" autocomplete="off" maxlength="${CHILD_NAME_MAX_LENGTH}" placeholder="Enter the child&rsquo;s name" required aria-describedby="checkout-child-name-help checkout-child-name-error">
          <small id="checkout-child-name-help">Enter the name of the child who will receive this order.</small>
          <small id="checkout-child-name-error" data-checkout-customer-error="childName" role="alert"></small>
        </label>
      </fieldset>`;
    totalRow.before(customerDetails);
    const customerNameInput = customerDetails.querySelector('[data-checkout-customer-name]');
    const childNameInput = customerDetails.querySelector('[data-checkout-child-name]');
    customerNameInput.value = checkoutCustomerDetails.customerName;
    childNameInput.value = checkoutCustomerDetails.childName;
    [customerNameInput, childNameInput].forEach(input => {
      input.addEventListener('input', () => {
        checkoutCustomerDetails = {
          customerName: customerNameInput.value.slice(0, CUSTOMER_NAME_MAX_LENGTH),
          childName: childNameInput.value.slice(0, CHILD_NAME_MAX_LENGTH)
        };
        saveCheckoutCustomerDetails();
        clearCheckoutAttempt();
        clearInlineStatus(document.querySelector('[data-checkout-status]'));
        const key = input === customerNameInput ? 'customerName' : 'childName';
        const errorElement = customerDetails.querySelector(`[data-checkout-customer-error="${key}"]`);
        input.removeAttribute('aria-invalid');
        if (errorElement) errorElement.textContent = '';
      });
      input.addEventListener('blur', () => validateCheckoutCustomerForm());
    });
  }
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
        clearCheckoutAttempt();
        fulfilment.querySelectorAll('.fulfilment-option').forEach(option => option.classList.toggle('is-selected', option.contains(input)));
        scheduleCheckoutSummary();
      });
    });
    fulfilment.querySelectorAll('.fulfilment-option').forEach(option => {
      option.classList.toggle('is-selected', option.querySelector('input').checked);
    });
  }
  let promotion = document.querySelector('[data-checkout-promotion]');
  if (!promotion) {
    promotion = document.createElement('div');
    promotion.dataset.checkoutPromotion = '';
    promotion.className = 'checkout-promotion';
    promotion.innerHTML = `
      <label for="discount-code">Discount code</label>
      <div class="checkout-promotion-controls">
        <input id="discount-code" type="text" inputmode="text" autocomplete="off" maxlength="64" placeholder="Enter discount code" aria-describedby="discount-code-status">
        <button type="button" class="button-promotion-apply" data-promotion-apply>Apply</button>
        <button type="button" class="button-promotion-remove" data-promotion-remove hidden>Remove code</button>
      </div>
      <p id="discount-code-status" data-promotion-status role="status" aria-live="polite"></p>`;
    totalRow.before(promotion);
    const input = promotion.querySelector('input');
    input.value = appliedPromotionCode;
    promotion.querySelector('[data-promotion-apply]').addEventListener('click', async () => {
      const code = input.value.trim();
      const status = promotion.querySelector('[data-promotion-status]');
      if (!code) {
        status.className = 'promotion-status is-error';
        status.textContent = 'Please enter a discount code.';
        input.focus();
        return;
      }
      const button = promotion.querySelector('[data-promotion-apply]');
      button.disabled = true;
      button.textContent = 'Applying...';
      try {
        const summary = await fetchCheckoutSummary({ ...buildCheckoutPayload(), promotionCode: code }, false);
        appliedPromotionCode = summary.promotion?.code || '';
        sessionStorage.setItem(CHECKOUT_PROMOTION_KEY, appliedPromotionCode);
        clearCheckoutAttempt();
        input.value = appliedPromotionCode;
        renderCheckoutSummary(summary);
      } catch (error) {
        status.className = 'promotion-status is-error';
        status.textContent = error.message || 'This discount code is not valid.';
      } finally {
        button.disabled = false;
        button.textContent = 'Apply';
      }
    });
    promotion.querySelector('[data-promotion-remove]').addEventListener('click', () => {
      appliedPromotionCode = '';
      sessionStorage.removeItem(CHECKOUT_PROMOTION_KEY);
      clearCheckoutAttempt();
      input.value = '';
      const status = promotion.querySelector('[data-promotion-status]');
      status.className = 'promotion-status';
      status.textContent = '';
      scheduleCheckoutSummary();
      input.focus();
    });
  }
  let breakdown = document.querySelector('[data-cart-breakdown]');
  if (!breakdown) {
    breakdown = document.createElement('div');
    breakdown.dataset.cartBreakdown = '';
    breakdown.className = 'cart-breakdown';
    breakdown.innerHTML = `
      <div><span>Merchandise subtotal</span><strong data-summary-merchandise>$0.00</strong></div>
      <div data-summary-discount-row hidden><span data-summary-discount-label>Discount</span><strong data-summary-discount>-$0.00</strong></div>
      <div data-summary-personalisation-row><span>Personalisation</span><strong data-summary-personalisation>$0.00</strong></div>
      <div><span data-summary-shipping-label>Shipping</span><strong data-summary-shipping>$0.00</strong></div>
      <div data-summary-surcharge-row hidden><span data-summary-surcharge-label>Card processing surcharge</span><strong data-summary-surcharge>$0.00</strong></div>
      <p data-summary-surcharge-note hidden></p>`;
    totalRow.before(breakdown);
  }
  return { totalEl, totalRow, breakdown, fulfilment, customerDetails, promotion };
}

function renderCheckoutSummary(summary) {
  const { totalEl, totalRow, breakdown } = getCartSummaryElements();
  if (!totalEl || !breakdown) return;
  const personalisationRow = breakdown.querySelector('[data-summary-personalisation-row]');
  const surchargeRow = breakdown.querySelector('[data-summary-surcharge-row]');
  const surchargeNote = breakdown.querySelector('[data-summary-surcharge-note]');
  const fulfilmentNote = document.querySelector('[data-fulfilment-note]');
  breakdown.querySelector('[data-summary-merchandise]').textContent = formatCents(summary.merchandiseSubtotalCents);
  const discountRow = breakdown.querySelector('[data-summary-discount-row]');
  discountRow.hidden = !summary.discountCents;
  if (summary.discountCents) {
    breakdown.querySelector('[data-summary-discount-label]').textContent = `${summary.promotion.code} discount`;
    breakdown.querySelector('[data-summary-discount]').textContent = `-${formatCents(summary.discountCents)}`;
  }
  const promotion = document.querySelector('[data-checkout-promotion]');
  if (promotion) {
    const status = promotion.querySelector('[data-promotion-status]');
    const remove = promotion.querySelector('[data-promotion-remove]');
    remove.hidden = !summary.promotion;
    if (summary.promotion) {
      status.className = 'promotion-status is-success';
      status.textContent = `${summary.promotion.code} applied. You saved ${formatCents(summary.discountCents)}.`;
    } else if (!status.classList.contains('is-error')) {
      status.className = 'promotion-status';
      status.textContent = '';
    }
  }
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
    } catch (error) {
      if (appliedPromotionCode) {
        const promotion = document.querySelector('[data-checkout-promotion]');
        const status = promotion?.querySelector('[data-promotion-status]');
        appliedPromotionCode = '';
        sessionStorage.removeItem(CHECKOUT_PROMOTION_KEY);
        clearCheckoutAttempt();
        if (status) {
          status.className = 'promotion-status is-error';
          status.textContent = error.message || 'The discount code no longer applies to this cart.';
        }
        try {
          const summary = await fetchCheckoutSummary(buildCheckoutPayload(), false);
          if (requestNumber === checkoutSummaryRequest) renderCheckoutSummary(summary);
          return;
        } catch {}
      }
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

      const validatedCustomerDetails = validateCheckoutCustomerForm({ focus: true });
      if (!validatedCustomerDetails) {
        setInlineStatus(statusEl, 'error', "Please check the Customer Name and Child's Name fields.");
        return;
      }

      if (!fulfilmentType) {
        setInlineStatus(statusEl, 'error', 'Please choose free pickup or New Zealand delivery.');
        document.querySelector('[data-fulfilment-selector]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const payload = buildCheckoutPayload();
      payload.customerDetails = validatedCustomerDetails;
      if (payload.items.some(item => !item.productId)) {
        setInlineStatus(statusEl, 'error', 'One of the products in your cart is no longer available. Please remove it and try again.');
        return;
      }

      clearInlineStatus(statusEl);
      isCheckingOut = true;
      setCheckoutLoading(true);

      try {
        await fetchCheckoutSummary(payload);
        payload.checkoutRequestId = checkoutRequestId(payload);
        let response = await fetch('/api/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        let result = await response.json().catch(() => ({}));

        if (response.status === 409 && result.code === 'CHECKOUT_ATTEMPT_INACTIVE') {
          clearCheckoutAttempt();
          payload.checkoutRequestId = checkoutRequestId(payload);
          response = await fetch('/api/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          result = await response.json().catch(() => ({}));
        }

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
  if (!menu) return;
  const isOpen = menu.classList.toggle('hidden') === false;
  document.querySelectorAll('[onclick="toggleMobileMenu()"]')
    .forEach(button => button.setAttribute('aria-expanded', String(isOpen)));
  if (isOpen) menu.querySelector('a, button')?.focus();
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
      const requestId = crypto.randomUUID();
      const response = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId },
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
      const requestId = crypto.randomUUID();
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId },
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
        <img src="${escapeHtml(product.cardImage || product.image)}" alt="${escapeHtml(product.name)}" width="480" height="480" ${index ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">
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
  const useThumbnails = !isProductPage;
  const gallery = getProductGallery(product, initialStyle, useThumbnails);
  const galleryCount = gallery.length;
  const displayImage = isProductPage ? product.image : (product.cardImage || product.image);
  const namePrice = personalisationOptionPrice(product, 'playerNamePrice');
  const numberPrice = personalisationOptionPrice(product, 'playerNumberPrice');

  return `
      <div class="${cardClasses}" data-product-id="${escapeHtml(product.id)}" data-product-name="${escapeHtml(product.name)}" data-product-page="${isProductPage ? 'true' : 'false'}" data-category="${escapeHtml(product.category)}" data-personalisable="${product.personalisable ? 'true' : 'false'}" data-allow-player-name="${product.allowPlayerName ?? product.personalisable ? 'true' : 'false'}" data-allow-player-number="${product.allowPlayerNumber ?? product.personalisable ? 'true' : 'false'}" data-name-price="${namePrice}" data-number-price="${numberPrice}">
        <div class="product-image-wrap relative overflow-hidden ${imageHeight}">
          <button type="button" class="product-image-button" onclick='openProductLightbox(${escapeJsString(product.name)}, 0, this)' aria-label="View ${escapeHtml(product.name)} image gallery">
            <img data-product-image src="${escapeHtml(displayImage)}" alt="${escapeHtml(product.name)}" width="480" height="480" loading="lazy" decoding="async" class="product-image w-full h-full group-hover:scale-105 transition-transform duration-500">
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

function getProductGallery(product, style = '', thumbnails = false) {
  if (style && Array.isArray(product.galleryImages)) {
    const styled = product.galleryImages
      .filter(image => !image.style || image.style === style)
      .map(image => thumbnails ? (image.thumbnailSrc || image.src) : image.src)
      .filter(Boolean);
    if (styled.length) return styled;
  }
  const gallery = thumbnails && Array.isArray(product.galleryThumbnails) && product.galleryThumbnails.length
    ? product.galleryThumbnails
    : Array.isArray(product.gallery) && product.gallery.length ? product.gallery : [product.image];
  return gallery.filter(Boolean);
}

function setupProductCardCarousels() {
  const products = window.PTG_PRODUCTS || globalThis.PTG_PRODUCTS || [];

  document.querySelectorAll('.product-card').forEach(card => {
    const product = products.find(item => item.name === card.dataset.productName);
    const image = card.querySelector('[data-product-image]');
    const thumbnails = card.dataset.productPage !== 'true';
    let gallery = product ? getProductGallery(product, card.querySelector('[data-inventory-variant] option:checked')?.dataset.style || '', thumbnails) : [];

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
      gallery = getProductGallery(product, event.target.options[event.target.selectedIndex]?.dataset.style || '', thumbnails);
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
          <img id="product-lightbox-image" class="product-lightbox-image" alt="">
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
    const isTrainingKit = card.dataset.productId === TRAINING_KIT_ID;
    const optionalPrice = price => price > 0 ? `(Optional · +${formatMoney(price)})` : '(Optional)';
    const options = document.createElement('div');
    options.className = 'personalisation-options';
    options.innerHTML = `
      ${allowName ? `<label class="personalisation-field" data-player-field="name" for="${idBase}-name">
        <span>Player Name <strong>${optionalPrice(namePrice)}</strong></span>
        <input id="${idBase}-name" data-personalisation="name" type="text" maxlength="20" autocomplete="off" placeholder="Optional player name">
        <small class="personalisation-error" data-personalisation-error="name" role="alert"></small>
      </label>` : ''}
      ${allowNumber ? `<label class="personalisation-field" data-player-field="number" for="${idBase}-number">
        <span>${isTrainingKit ? 'Shirt Number' : 'Player Number'} <strong>${optionalPrice(numberPrice)}</strong></span>
        <input id="${idBase}-number" data-personalisation="number" type="text" inputmode="numeric" maxlength="2" pattern="${isTrainingKit ? '(?:[1-9]|[1-9][0-9])' : '(?:0|00|[1-9][0-9]?)'}" title="${isTrainingKit ? 'Enter a whole shirt number from 1 to 99' : 'Enter a jersey number from 0 to 99'}" placeholder="Optional number" ${isTrainingKit ? `aria-describedby="${idBase}-shirt-number-help ${idBase}-number-error"` : ''}>
        <small id="${idBase}-number-error" class="personalisation-error" data-personalisation-error="number" role="alert"></small>
      </label>` : ''}
      ${isTrainingKit && allowNumber ? `<section id="${idBase}-shirt-number-help" class="shirt-number-rules" aria-labelledby="${idBase}-shirt-number-title">
        <strong id="${idBase}-shirt-number-title">Number Selection</strong>
        <p>Numbers 1,7,9,10 are not available.</p>
        <p>To keep things fair for everyone, shirt numbers 1, 7, 9, and 10 are only available if they match the day you were born — the date of your birthday, not the month or year.</p>
        <p>If your birthday does not fall on one of these dates, please choose another number. Most players choose the day of their birth date as their shirt number.</p>
        <p>Thank you for helping us keep shirt number allocation fair for everyone.</p>
      </section>
      <label class="personalisation-field shirt-number-birth-day" data-birth-day-field for="${idBase}-birth-day" hidden>
        <span>Day of Birth <strong>(Required for this restricted number)</strong></span>
        <input id="${idBase}-birth-day" data-shirt-number-birth-day type="text" inputmode="numeric" maxlength="2" autocomplete="off" aria-describedby="${idBase}-birth-day-help ${idBase}-birth-day-error">
        <small id="${idBase}-birth-day-help">Enter only the day of the month you were born, for example 7 if your birthday is on the 7th.</small>
        <small id="${idBase}-birth-day-error" class="personalisation-error" data-personalisation-error="birth-day" role="alert"></small>
      </label>` : ''}
    `;

    actionRow.before(options);

    const numberInput = options.querySelector('[data-personalisation="number"]');
    if (numberInput) {
      let previousNumber = '';
      numberInput.addEventListener('input', () => {
        numberInput.setCustomValidity('');
        const currentNumber = numberInput.value.trim();
        const birthDayField = options.querySelector('[data-birth-day-field]');
        const birthDayInput = options.querySelector('[data-shirt-number-birth-day]');
        const restricted = isTrainingKit && RESTRICTED_SHIRT_NUMBERS.has(currentNumber);
        if (birthDayField) birthDayField.hidden = !restricted;
        if (birthDayInput && (!restricted || currentNumber !== previousNumber)) birthDayInput.value = '';
        options.querySelector('[data-personalisation-error="number"]')?.replaceChildren();
        options.querySelector('[data-personalisation-error="birth-day"]')?.replaceChildren();
        previousNumber = currentNumber;
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
      const gallery = product ? getProductGallery(product, selected?.dataset.style || '', card?.dataset.productPage !== 'true') : [];
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

function setupAccessibleNavigation() {
  const sidebar = document.getElementById('cart-sidebar');
  const mobileMenu = document.getElementById('mobile-menu');
  if (sidebar) {
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-modal', 'true');
    sidebar.setAttribute('aria-hidden', 'true');
  }
  document.querySelectorAll('[onclick="toggleCart()"]:not(#cart-overlay)')
    .forEach(button => button.setAttribute('aria-expanded', 'false'));
  document.querySelectorAll('[onclick="toggleMobileMenu()"]')
    .forEach(button => {
      button.setAttribute('aria-expanded', 'false');
      if (mobileMenu?.id) button.setAttribute('aria-controls', mobileMenu.id);
    });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && sidebar?.classList.contains('open')) {
      event.preventDefault();
      toggleCart(false);
      return;
    }
    if (event.key !== 'Tab' || !sidebar?.classList.contains('open')) return;
    const controls = [...sidebar.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function refreshCartFromDatabaseProducts() {
  let changed = false;
  cart.forEach(item => {
    const product = getProducts().find(candidate => candidate.id === item.id);
    if (!product) return;

    const namePrice = personalisationOptionPrice(product, 'playerNamePrice');
    const numberPrice = personalisationOptionPrice(product, 'playerNumberPrice');
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
  if (changed) saveCart({ invalidateCheckout: false });
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
setupAccessibleNavigation();
setupNewsletterForm();
setupContactForm();
setupCheckout();
updateCartUI();
loadDatabaseProducts();
