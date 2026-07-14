import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdminIdentity, isAdminMutationAllowed } from '../worker/auth.js';
import { validateD1CheckoutPayload } from '../worker/inventory.js';

function mockDatabase(overrides = {}) {
  const product = {
    id: 'patagonia-fc-tournament-player-kit',
    name: 'Patagonia FC Tournament Player Kit',
    price_cents: 9500,
    active: 1,
    available_for_sale: 1,
    track_inventory: 1,
    allow_player_name: 1,
    allow_player_number: 1,
    player_name_price_cents: 2000,
    player_number_price_cents: 2000,
    ...overrides.product
  };
  const variant = {
    id: 10,
    product_id: product.id,
    sku: 'PTG-PFC-KIT-M',
    size: 'M',
    colour: '',
    style: '',
    stock_quantity: 4,
    active: 1,
    ...overrides.variant
  };
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes('FROM products WHERE id')) return values[0] === product.id ? product : null;
              if (sql.includes('FROM product_variants WHERE id')) return values[0] === variant.id && values[1] === product.id ? variant : null;
              return null;
            }
          };
        }
      };
    }
  };
}

function checkoutPayload(overrides = {}) {
  return {
    items: [{
      productId: 'patagonia-fc-tournament-player-kit',
      variantId: 10,
      quantity: 1,
      suppliedPrice: 1,
      personalisation: { name: 'Nico', number: '10' },
      ...overrides
    }]
  };
}

test('D1 checkout uses server prices and personalisation charges', async () => {
  const result = await validateD1CheckoutPayload(checkoutPayload(), { DB: mockDatabase(), LOW_STOCK_THRESHOLD: '5' });
  assert.equal(result.error, undefined);
  assert.equal(result.items[0].product.unitAmountNzdCents, 9500);
  assert.equal(result.items[0].nameAddOn, 2000);
  assert.equal(result.items[0].numberAddOn, 2000);
});

test('D1 checkout rejects quantities above available stock', async () => {
  const result = await validateD1CheckoutPayload(checkoutPayload({ quantity: 5 }), { DB: mockDatabase(), LOW_STOCK_THRESHOLD: '5' });
  assert.match(result.error, /not enough stock/i);
});

test('D1 checkout rejects disabled products', async () => {
  const result = await validateD1CheckoutPayload(checkoutPayload(), { DB: mockDatabase({ product: { active: 0 } }) });
  assert.match(result.error, /no longer available/i);
});

test('D1 checkout rejects personalisation for products that disallow it', async () => {
  const result = await validateD1CheckoutPayload(checkoutPayload(), {
    DB: mockDatabase({ product: { allow_player_name: 0, allow_player_number: 0 } })
  });
  assert.match(result.error, /does not support player names/i);
});

test('local admin identity only activates for localhost development', async () => {
  const env = { ENVIRONMENT: 'development', LOCAL_ADMIN_EMAIL: 'admin@example.com' };
  assert.equal((await getAdminIdentity(new Request('http://localhost:8787/api/admin/me'), env)).email, 'admin@example.com');
  assert.equal(await getAdminIdentity(new Request('https://ptgactivewear.co.nz/api/admin/me'), env), null);
});

test('admin mutations require exact same origin, JSON and custom header', () => {
  const valid = new Request('http://localhost:8787/api/admin/products/test', {
    method: 'PUT',
    headers: { Origin: 'http://localhost:8787', 'Content-Type': 'application/json', 'X-PTG-Admin-Request': '1' },
    body: '{}'
  });
  const invalid = new Request('http://localhost:8787/api/admin/products/test', {
    method: 'PUT',
    headers: { Origin: 'https://example.com', 'Content-Type': 'application/json', 'X-PTG-Admin-Request': '1' },
    body: '{}'
  });
  assert.equal(isAdminMutationAllowed(valid), true);
  assert.equal(isAdminMutationAllowed(invalid), false);
});
