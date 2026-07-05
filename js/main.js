// ── Cart state (persisted to localStorage) ──────────────────────────────────
let cart = JSON.parse(localStorage.getItem('ptg-cart') || '[]');
const PERSONALISATION_ADDON_PRICE = 20;

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

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function samePersonalisation(a = {}, b = {}) {
  return (a.name || '') === (b.name || '') && (a.number || '') === (b.number || '');
}

function sameVariant(a = '', b = '') {
  return (a || '') === (b || '');
}

function renderPersonalisationDetails(item) {
  const details = [];
  const personalisation = item.personalisation || {};

  if (item.variant) details.push(`Colour: ${escapeHtml(item.variant)}`);
  if (personalisation.name) details.push(`Name: ${escapeHtml(personalisation.name)} (+${formatMoney(PERSONALISATION_ADDON_PRICE)})`);
  if (personalisation.number) details.push(`Number: ${escapeHtml(personalisation.number)} (+${formatMoney(PERSONALISATION_ADDON_PRICE)})`);

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

function addToCart(name, price, trigger) {
  const personalisation = getPersonalisation(trigger);
  if (!personalisation) return;

  const variant = getSelectedVariant(trigger);
  const basePrice = Number(price);
  const addOnTotal =
    (personalisation.name ? PERSONALISATION_ADDON_PRICE : 0) +
    (personalisation.number ? PERSONALISATION_ADDON_PRICE : 0);
  const finalPrice = basePrice + addOnTotal;
  const existing = cart.find(i => i.name === name && sameVariant(i.variant, variant) && samePersonalisation(i.personalisation, personalisation));

  if (existing) { existing.qty++; } else { cart.push({ name, basePrice, price: finalPrice, qty: 1, variant, personalisation }); }
  saveCart();
  updateCartUI();
  showToast(`✓  ${name} added to cart`);
}

function changeQty(index, delta) {
  cart[index].qty += delta;
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
function handleNewsletter(e) {
  e.preventDefault();
  showToast('Welcome to the PTG squad!');
  e.target.reset();
}

function setupPersonalisationOptions() {
  document.querySelectorAll('.product-card').forEach((card, index) => {
    const button = card.querySelector('button[onclick^="addToCart"]');
    if (!button || card.querySelector('.personalisation-options')) return;

    const actionRow = button.closest('.flex.items-center.justify-between');
    if (!actionRow) return;

    const idBase = `personalisation-${index}`;
    const options = document.createElement('div');
    options.className = 'personalisation-options';
    options.innerHTML = `
      <label class="personalisation-field" for="${idBase}-name">
        <span>ADD YOUR NAME <strong>(+${formatMoney(PERSONALISATION_ADDON_PRICE)})</strong></span>
        <input id="${idBase}-name" data-personalisation="name" type="text" maxlength="20" autocomplete="off" placeholder="Player name">
      </label>
      <label class="personalisation-field" for="${idBase}-number">
        <span>ADD YOUR NUMBER <strong>(+${formatMoney(PERSONALISATION_ADDON_PRICE)})</strong></span>
        <input id="${idBase}-number" data-personalisation="number" type="text" inputmode="numeric" maxlength="2" pattern="(?:0|00|[1-9][0-9]?)" title="Enter a jersey number from 0 to 99" placeholder="e.g. 10">
      </label>
    `;

    actionRow.before(options);

    const numberInput = options.querySelector('[data-personalisation="number"]');
    numberInput.addEventListener('input', () => {
      numberInput.value = numberInput.value.replace(/[^\d]/g, '').slice(0, 2);
      numberInput.setCustomValidity('');
    });
  });
}

// ── Shop page filter ──────────────────────────────────────────────────────────
function setupProductVariants() {
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
  document.querySelector(`[data-filter="${category}"]`).classList.add('active');

  document.querySelectorAll('.product-item').forEach(card => {
    const cat = card.dataset.category;
    card.style.display = (category === 'all' || cat === category) ? '' : 'none';
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
setupPersonalisationOptions();
setupProductVariants();
updateCartUI();
