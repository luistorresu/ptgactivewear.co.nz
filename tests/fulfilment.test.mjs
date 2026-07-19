import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../_worker.js';
import { getFulfilmentConfig, selectFulfilment } from '../worker/fulfilment.js';

const env = {
  PICKUP_ENABLED: 'true',
  PICKUP_LABEL: 'Pick up from Training Centre',
  PICKUP_PRICE_CENTS: '0',
  PICKUP_LOCATION_NAME: 'Training Centre',
  PICKUP_INSTRUCTIONS: 'We will contact you when your order is ready.',
  NZ_DELIVERY_ENABLED: 'true',
  NZ_DELIVERY_LABEL: 'New Zealand Delivery',
  NZ_DELIVERY_PRICE_CENTS: '500',
  NZ_DELIVERY_COUNTRY: 'NZ',
  PAYMENT_SURCHARGE_ENABLED: 'false'
};

const item = { productId: 'patagonia-fc-beanie', quantity: 1, size: 'One Size' };

async function summary(fulfilmentType, extra = {}) {
  const response = await worker.fetch(new Request('https://ptgactivewear.co.nz/api/checkout-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fulfilmentType, items: [item], shippingCents: 999999, totalCents: 1 })
  }), { ...env, ...extra });
  return { response, body: await response.json() };
}

test('fulfilment configuration keeps pickup free and delivery restricted to NZ', () => {
  const config = getFulfilmentConfig(env);
  assert.equal(config.pickup.priceCents, 0);
  assert.equal(config.delivery.priceCents, 500);
  assert.equal(config.delivery.country, 'NZ');
  assert.throws(() => getFulfilmentConfig({ ...env, NZ_DELIVERY_COUNTRY: 'AU' }), /New Zealand/);
  assert.throws(() => selectFulfilment({ fulfilmentType: 'pickup' }, { ...env, PICKUP_PRICE_CENTS: '1' }), /free/);
});

test('checkout requires a choice and ignores browser-edited shipping totals', async () => {
  const missing = await summary('');
  assert.equal(missing.response.status, 400);
  assert.match(missing.body.error, /choose free pickup or New Zealand delivery/i);

  const pickup = await summary('pickup');
  assert.equal(pickup.response.status, 200);
  assert.deepEqual([pickup.body.summary.shippingCents, pickup.body.summary.totalCents], [0, 3500]);
  assert.equal(pickup.body.summary.fulfilment.type, 'pickup');

  const delivery = await summary('delivery');
  assert.equal(delivery.response.status, 200);
  assert.deepEqual([delivery.body.summary.shippingCents, delivery.body.summary.totalCents], [500, 4000]);
  assert.equal(delivery.body.summary.fulfilment.country, 'NZ');
});

test('Stripe parameters differ safely for pickup and NZ delivery', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(new URLSearchParams(options.body));
    return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/test' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    for (const fulfilmentType of ['pickup', 'delivery']) {
      const response = await worker.fetch(new Request('https://ptgactivewear.co.nz/api/create-checkout-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fulfilmentType, items: [item], checkoutRequestId: `request-${fulfilmentType}` })
      }), { ...env, STRIPE_SECRET_KEY: 'sk_test_not_real', CHECKOUT_ENABLED: 'true' });
      assert.equal(response.status, 200);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  const [pickup, delivery] = calls;
  assert.equal(pickup.get('metadata[fulfilment_type]'), 'pickup');
  assert.equal(pickup.get('metadata[shipping_cents]'), '0');
  assert.equal(pickup.has('shipping_address_collection[allowed_countries][0]'), false);
  assert.match(pickup.get('custom_text[submit][message]'), /Pick up from Training Centre - Free/);

  assert.equal(delivery.get('metadata[fulfilment_type]'), 'delivery');
  assert.equal(delivery.get('metadata[shipping_cents]'), '500');
  assert.equal(delivery.get('shipping_address_collection[allowed_countries][0]'), 'NZ');
  assert.equal(delivery.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'), '500');
});

test('fulfilment migration is additive and preserves historical orders', async () => {
  const sql = await readFile(new URL('../migrations/0013_order_fulfilment_details.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE|TRUNCATE|UPDATE)\b/i);
  for (const field of ['fulfilment_type', 'shipping_method', 'pickup_location', 'shipping_country', 'shipping_rural']) {
    assert.match(sql, new RegExp(`ADD COLUMN ${field}`, 'i'));
  }
});
