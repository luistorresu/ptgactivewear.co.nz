import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getAdminIdentity, isAdminMutationAllowed } from '../worker/auth.js';
import { commitPaidOrder, validateD1CheckoutPayload, verifyStripeCheckoutSnapshot } from '../worker/inventory.js';

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
    payment_surcharge_description: 'Processing cost', total_cents: '13782',
    fulfilment_type: 'pickup', shipping_method: 'Pick up from Training Centre', pickup_location: 'Training Centre', pickup_instructions: 'We will contact you.'
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

test('paid delivery order persists a complete NZ fulfilment snapshot with valid SQL bindings', async () => {
  let inserted = false;
  let invoiceNumber = '';
  let invoiceCreated = false;
  const DB = {
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (/SELECT id, email_status FROM orders/i.test(sql)) return inserted ? { id: 7, email_status: 'pending' } : null;
          if (/SELECT \* FROM orders WHERE id/i.test(sql)) return {
            id: 7, order_number: 'PTG-ORD-2026-000007', invoice_number: invoiceNumber, invoice_created_at: invoiceNumber ? '2026-07-20 00:00:00' : null,
            payment_status: 'paid', payment_date: '2026-07-20 00:00:00', created_at: '2026-07-20 00:00:00', customer_name: 'Test Customer', customer_email: 'customer@example.com',
            shipping_address_json: '{}', billing_address_json: '{}', subtotal_cents: 3500, personalisation_cents: 0, shipping_cents: 500,
            payment_surcharge_cents: 0, discount_cents: 0, tax_cents: 0, total_cents: 4000, refunded_cents: 0, currency: 'NZD'
          };
          if (/SELECT \* FROM invoices WHERE order_id/i.test(sql)) return invoiceCreated ? { invoice_number: invoiceNumber, issue_date: '2026-07-20 00:00:00', status: 'issued', refunded_cents: 0, snapshot_json: '{}' } : null;
          if (/INSERT INTO invoice_sequence/i.test(sql)) return { value: 1 };
          if (/FROM products p JOIN product_variants/i.test(sql)) return {
            product_id: 'patagonia-fc-beanie', name: 'Patagonia FC Beanie', price_cents: 3500,
            product_active: 1, product_archived: 0, available_for_sale: 1, track_inventory: 0,
            variant_id: 1, sku: 'BEANIE', stock_quantity: 10, variant_active: 1
          };
          return null;
        },
        async all() { return { results: [] }; },
        async run() {
          if (/UPDATE orders SET invoice_number/i.test(sql)) invoiceNumber = 'PTG-INV-2026-000001';
          if (/INSERT OR IGNORE INTO invoices/i.test(sql)) invoiceCreated = true;
          return { meta: { changes: 1 } };
        }
      };
    },
    async batch(statements) {
      for (const statement of statements) {
        assert.equal((statement.sql.match(/\?/g) || []).length, statement.args.length, statement.sql);
      }
      inserted = true;
      return statements.map(() => ({ meta: { changes: 1 } }));
    }
  };
  const metadata = {
    subtotal_cents: '3500', personalisation_cents: '0', shipping_cents: '500',
    payment_surcharge_cents: '0', payment_surcharge_enabled: '0', payment_surcharge_percent: '2.65',
    payment_surcharge_fixed_cents: '30', payment_surcharge_label: 'Card processing surcharge', payment_surcharge_description: 'Processing cost',
    total_cents: '4000', fulfilment_type: 'delivery', shipping_method: 'New Zealand Delivery'
  };
  const lineItems = [{
    quantity: 1, amount_total: 3500,
    price: { product: { metadata: { item_kind: 'base_product', product_id: 'patagonia-fc-beanie', variant_id: '1', cart_item_key: 'cart-1', sku: 'BEANIE', size: 'One Size' } } }
  }];
  const session = {
    id: 'cs_test_delivery', payment_intent: 'pi_test_delivery', payment_status: 'paid', currency: 'nzd',
    amount_subtotal: 3500, amount_total: 4000, total_details: { amount_shipping: 500, amount_discount: 0, amount_tax: 0 }, metadata,
    customer_details: { name: 'Test Customer', email: 'customer@example.com', phone: '0210000000', address: {} },
    collected_information: { shipping_details: { name: 'Test Customer', address: { line1: '1 Test Street', line2: 'RD 1', city: 'Hamilton', state: 'Waikato', postal_code: '3200', country: 'NZ' } } },
    payment_method_types: ['card']
  };
  const result = await commitPaidOrder({ DB }, { id: 'evt_test_delivery', type: 'checkout.session.completed' }, session, lineItems);
  assert.deepEqual(result, { orderId: 7, duplicate: false, emailStatus: 'pending' });
});

test('paid order items store the full line personalisation amount for invoice accuracy', async () => {
  const source = await readFile(new URL('../worker/inventory.js', import.meta.url), 'utf8');
  assert.match(source, /item\.customisationAmountTotal, item\.baseAmountTotal \+ item\.customisationAmountTotal/);
  assert.doesNotMatch(source, /customisationPerUnit/);
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
