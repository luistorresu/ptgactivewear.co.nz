import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdminIdentity, isAdminMutationAllowed } from '../worker/auth.js';
import { validateD1CheckoutPayload, verifyStripeCheckoutSnapshot } from '../worker/inventory.js';

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

test('D1 checkout applies variant-specific mug personalisation rules', async () => {
  const styleOne = await validateD1CheckoutPayload(checkoutPayload(), {
    DB: mockDatabase({ variant: { allow_player_name: 0, allow_player_number: 0, style: 'Style 1' } })
  });
  assert.match(styleOne.error, /Style 1 does not support player names/i);

  const styleTwo = await validateD1CheckoutPayload(checkoutPayload(), {
    DB: mockDatabase({ product: { player_name_price_cents: 0, player_number_price_cents: 0 }, variant: { allow_player_name: 1, allow_player_number: 1, style: 'Style 2' } })
  });
  assert.equal(styleTwo.error, undefined);
  assert.equal(styleTwo.items[0].nameAddOn, 0);
  assert.equal(styleTwo.items[0].numberAddOn, 0);
});

test('local development has no authentication bypass', async () => {
  const env = { ENVIRONMENT: 'development', LOCAL_ADMIN_EMAIL: 'admin@example.com' };
  assert.equal(await getAdminIdentity(new Request('http://localhost:8787/api/admin/me'), env), null);
  assert.equal(await getAdminIdentity(new Request('https://ptgactivewear.co.nz/api/admin/me'), env), null);
});

test('paid order snapshot rejects any one-cent mismatch', () => {
  const metadata = {
    subtotal_cents: '9500', personalisation_cents: '4000', shipping_cents: '0',
    payment_surcharge_cents: '282', payment_surcharge_enabled: '1', payment_surcharge_percent: '2.65',
    payment_surcharge_fixed_cents: '30', payment_surcharge_label: 'Card processing surcharge',
    payment_surcharge_description: 'Processing cost', total_cents: '13782'
  };
  const product = item_kind => ({ metadata: { item_kind } });
  const lines = [
    { amount_total: 9500, price: { product: product('base_product') } },
    { amount_total: 2000, price: { product: product('player_name_addon') } },
    { amount_total: 2000, price: { product: product('player_number_addon') } },
    { amount_total: 282, price: { product: product('payment_surcharge') } }
  ];
  const session = { metadata, amount_subtotal: 13782, amount_total: 13782, total_details: { amount_shipping: 0 } };
  assert.equal(verifyStripeCheckoutSnapshot(session, lines, 4000).paymentSurchargeCents, 282);
  assert.throws(() => verifyStripeCheckoutSnapshot({ ...session, amount_total: 13781 }, lines, 4000), /paid total/i);
  assert.throws(() => verifyStripeCheckoutSnapshot(session, [...lines.slice(0, 3), { ...lines[3], amount_total: 281 }], 4000), /surcharge/i);
});

test('admin mutations require exact same origin, safe content type, custom header and CSRF token', () => {
  const identity = { csrfToken: 'test-csrf-token' };
  const valid = new Request('http://localhost:8787/api/admin/products/test', {
    method: 'PUT',
    headers: { Origin: 'http://localhost:8787', 'Content-Type': 'application/json', 'X-PTG-Admin-Request': '1', 'X-CSRF-Token': 'test-csrf-token' },
    body: '{}'
  });
  const invalid = new Request('http://localhost:8787/api/admin/products/test', {
    method: 'PUT',
    headers: { Origin: 'https://example.com', 'Content-Type': 'application/json', 'X-PTG-Admin-Request': '1', 'X-CSRF-Token': 'test-csrf-token' },
    body: '{}'
  });
  assert.equal(isAdminMutationAllowed(valid, identity), true);
  assert.equal(isAdminMutationAllowed(invalid, identity), false);
  const upload = new Request('http://localhost:8787/api/admin/products/test/pictures', {
    method: 'POST', headers: { Origin: 'http://localhost:8787', 'Content-Type': 'multipart/form-data; boundary=test', 'X-PTG-Admin-Request': '1', 'X-CSRF-Token': 'test-csrf-token' }, body: '--test--'
  });
  assert.equal(isAdminMutationAllowed(upload, identity), true);
  const bodylessDelete = new Request('http://localhost:8787/api/admin/pictures/1', {
    method: 'DELETE', headers: { Origin: 'http://localhost:8787', 'X-PTG-Admin-Request': '1', 'X-CSRF-Token': 'test-csrf-token' }
  });
  assert.equal(isAdminMutationAllowed(bodylessDelete, identity), true);
  assert.equal(isAdminMutationAllowed(valid, { csrfToken: 'wrong' }), false);
});
