// ── Cart state (persisted to localStorage) ──────────────────────────────────
let cart = JSON.parse(localStorage.getItem('ptg-cart') || '[]');

function saveCart() {
  localStorage.setItem('ptg-cart', JSON.stringify(cart));
}

// ── UI updates ───────────────────────────────────────────────────────────────
function updateCartUI() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);

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
      itemsEl.innerHTML = cart.map((item, i) => `
        <div class="flex items-center gap-4 py-5 border-b last:border-0">
          <div class="flex-1 min-w-0">
            <p class="font-medium text-gray-900 text-sm truncate">${item.name}</p>
            <p class="text-gray-500 text-xs mt-0.5">$${item.price.toFixed(2)} each</p>
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
      `).join('');
    }
  }
}

// ── Cart actions ─────────────────────────────────────────────────────────────
function addToCart(name, price) {
  const existing = cart.find(i => i.name === name);
  if (existing) { existing.qty++; } else { cart.push({ name, price, qty: 1 }); }
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

// ── Shop page filter ──────────────────────────────────────────────────────────
function filterProducts(category) {
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-filter="${category}"]`).classList.add('active');

  document.querySelectorAll('.product-item').forEach(card => {
    const cat = card.dataset.category;
    card.style.display = (category === 'all' || cat === category) ? '' : 'none';
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
updateCartUI();
