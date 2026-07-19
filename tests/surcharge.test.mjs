import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { buildBusinessOrderEmail, buildCustomerOrderEmail, buildOrderEmailData } from '../_worker.js';
import {
  buildTrustedOrderSummary,
  calculatePaymentSurcharge,
  calculateRefundBreakdown,
  getPaymentSurchargeConfig
} from '../worker/surcharge.js';

const enabledEnv = {
  PAYMENT_SURCHARGE_ENABLED: 'true',
  PAYMENT_SURCHARGE_PERCENT: '2.65',
  PAYMENT_SURCHARGE_FIXED_CENTS: '30',
  PAYMENT_SURCHARGE_LABEL: 'Card processing surcharge',
  PAYMENT_SURCHARGE_DESCRIPTION: 'This surcharge helps cover card payment processing costs.'
};

function item(unitAmountNzdCents, quantity = 1, nameAddOn = 0, numberAddOn = 0) {
  return { quantity, nameAddOn, numberAddOn, product: { unitAmountNzdCents } };
}

test('surcharge uses integer cents for percentage-only, fixed-only and combined configurations', () => {
  assert.equal(calculatePaymentSurcharge(10000, getPaymentSurchargeConfig({ ...enabledEnv, PAYMENT_SURCHARGE_FIXED_CENTS: '0' })), 265);
  assert.equal(calculatePaymentSurcharge(10000, getPaymentSurchargeConfig({ ...enabledEnv, PAYMENT_SURCHARGE_PERCENT: '0' })), 30);
  assert.equal(calculatePaymentSurcharge(10000, getPaymentSurchargeConfig(enabledEnv)), 295);
  assert.equal(calculatePaymentSurcharge(1, getPaymentSurchargeConfig(enabledEnv)), 30);
  assert.equal(calculatePaymentSurcharge(100000000, getPaymentSurchargeConfig(enabledEnv)), 2650030);
});

test('disabled surcharge is zero and unsafe configuration fails closed', () => {
  const disabled = getPaymentSurchargeConfig({ ...enabledEnv, PAYMENT_SURCHARGE_ENABLED: 'false' });
  assert.equal(calculatePaymentSurcharge(10000, disabled), 0);
  const excessive = getPaymentSurchargeConfig({ ...enabledEnv, PAYMENT_SURCHARGE_PERCENT: '4.01' });
  assert.equal(excessive.valid, false);
  assert.throws(() => calculatePaymentSurcharge(10000, excessive), /4% safety limit/);
  assert.equal(getPaymentSurchargeConfig({ ...enabledEnv, PAYMENT_SURCHARGE_PERCENT: '-1' }).valid, false);
  assert.equal(getPaymentSurchargeConfig({ ...enabledEnv, PAYMENT_SURCHARGE_FIXED_CENTS: '-1' }).valid, false);
});

test('trusted summary handles one item, multiple items, quantities, personalisation, paid shipping and free shipping', () => {
  const single = buildTrustedOrderSummary([item(3500)], 0, enabledEnv);
  assert.deepEqual([single.merchandiseSubtotalCents, single.personalisationCents, single.shippingCents, single.paymentSurchargeCents, single.totalCents], [3500, 0, 0, 123, 3623]);
  const multiple = buildTrustedOrderSummary([item(3500, 2), item(9500, 1, 2000, 2000)], 1200, enabledEnv);
  assert.deepEqual([multiple.merchandiseSubtotalCents, multiple.personalisationCents, multiple.shippingCents, multiple.paymentSurchargeCents, multiple.totalCents], [16500, 4000, 1200, 467, 22167]);
  const free = buildTrustedOrderSummary([item(1500, 3)], 0, { ...enabledEnv, PAYMENT_SURCHARGE_ENABLED: 'false' });
  assert.deepEqual([free.shippingCents, free.paymentSurchargeCents, free.totalCents], [0, 0, 4500]);
});

test('refund records preserve the original surcharge and only mark it refunded when supported', () => {
  assert.deepEqual(calculateRefundBreakdown(10000, 295, 10000), {
    refundedCents: 10000, paymentSurchargeRefundedCents: 295, refundStatus: 'fully_refunded'
  });
  assert.deepEqual(calculateRefundBreakdown(10000, 295, 2500), {
    refundedCents: 2500, paymentSurchargeRefundedCents: 0, refundStatus: 'partially_refunded'
  });
  assert.deepEqual(calculateRefundBreakdown(10000, 295, 2500, 75), {
    refundedCents: 2500, paymentSurchargeRefundedCents: 75, refundStatus: 'partially_refunded'
  });
});

test('checkout summary ignores browser-edited prices and totals', async () => {
  const request = new Request('https://ptgactivewear.co.nz/api/checkout-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ productId: 'patagonia-fc-beanie', quantity: 1, size: 'One Size', suppliedPrice: 1 }],
      subtotalCents: 1,
      paymentSurchargeCents: 0,
      totalCents: 1
    })
  });
  const response = await worker.fetch(request, enabledEnv);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual([body.summary.merchandiseSubtotalCents, body.summary.paymentSurchargeCents, body.summary.totalCents], [3500, 123, 3623]);
});

test('Stripe Checkout receives one surcharge line and stable idempotency key', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ id: 'cs_test_surcharge', url: 'https://checkout.stripe.com/test' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const payload = {
      checkoutRequestId: 'test-request-1234',
      items: [{ productId: 'patagonia-fc-beanie', quantity: 1, size: 'One Size', suppliedPrice: 1 }],
      subtotalCents: 1,
      paymentSurchargeCents: 999999,
      totalCents: 1
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await worker.fetch(new Request('https://ptgactivewear.co.nz/api/create-checkout-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      }), { ...enabledEnv, STRIPE_SECRET_KEY: 'sk_test_not_real', CHECKOUT_ENABLED: 'true' });
      assert.equal(response.status, 200);
    }
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.headers['Idempotency-Key'], 'ptg-checkout-test-request-1234');
    assert.equal(calls[1].options.headers['Idempotency-Key'], calls[0].options.headers['Idempotency-Key']);
    const params = new URLSearchParams(calls[0].options.body);
    const kinds = [...params.entries()].filter(([key]) => key.endsWith('[metadata][item_kind]')).map(([, value]) => value);
    assert.equal(kinds.filter(value => value === 'payment_surcharge').length, 1);
    assert.equal(params.get('metadata[subtotal_cents]'), '3500');
    assert.equal(params.get('metadata[payment_surcharge_cents]'), '123');
    assert.equal(params.get('metadata[payment_surcharge_enabled]'), '1');
    assert.equal(params.get('metadata[total_cents]'), '3623');
    assert.equal(params.get('payment_method_types[0]'), 'card');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('customer and business emails use the same surcharge snapshot and hide technical references from customers', () => {
  const session = {
    id: 'cs_test_123', payment_intent: 'pi_test_123', payment_status: 'paid', currency: 'nzd', amount_total: 13782,
    customer_details: { name: 'Test Customer', email: 'customer@example.com' },
    total_details: { amount_shipping: 0 },
    metadata: {
      subtotal_cents: '9500', personalisation_cents: '4000', shipping_cents: '0', payment_surcharge_cents: '282',
      payment_surcharge_enabled: '1', payment_surcharge_percent: '2.65', payment_surcharge_fixed_cents: '30', payment_surcharge_label: 'Card processing surcharge'
    }
  };
  const lineItems = [
    { description: 'Training Kit', quantity: 1, amount_total: 9500, price: { product: { metadata: { item_kind: 'base_product' } } } },
    { description: 'Player Name', quantity: 1, amount_total: 2000, price: { product: { metadata: { item_kind: 'player_name_addon' } } } },
    { description: 'Player Number', quantity: 1, amount_total: 2000, price: { product: { metadata: { item_kind: 'player_number_addon' } } } },
    { description: 'Card processing surcharge', quantity: 1, amount_total: 282, price: { product: { metadata: { item_kind: 'payment_surcharge' } } } }
  ];
  const order = { ...buildOrderEmailData(session, lineItems), orderNumber: 'PTG-ORD-2026-000001', orderDate: '19 July 2026', eventId: 'evt_test_123' };
  const customer = buildCustomerOrderEmail(order);
  const business = buildBusinessOrderEmail(order);
  for (const email of [customer, business]) {
    assert.match(email.text, /Merchandise subtotal: NZD \$95\.00/);
    assert.match(email.text, /Personalisation: NZD \$40\.00/);
    assert.match(email.text, /Card processing surcharge: NZD \$2\.82/);
    assert.match(email.text, /Total paid: NZD \$137\.82/);
  }
  assert.doesNotMatch(customer.text, /cs_test|pi_test|evt_test|Internal Payment References/);
  assert.match(business.text, /2\.65% \+ NZD \$0\.30/);
  assert.match(business.text, /Internal Payment References/);
  const disabledCustomer = buildCustomerOrderEmail({ ...order, paymentSurchargeEnabled: false, paymentSurchargeAmount: 0 });
  assert.doesNotMatch(disabledCustomer.text, /Card processing surcharge/);
});

test('surcharge migration is additive and snapshots refunds without altering historical rows', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = `${await readFile(new URL('../migrations/0011_payment_surcharge.sql', import.meta.url), 'utf8')}\n${await readFile(new URL('../migrations/0012_payment_surcharge_enabled.sql', import.meta.url), 'utf8')}`;
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
  assert.match(sql, /payment_surcharge_cents INTEGER NOT NULL DEFAULT 0/i);
  assert.match(sql, /payment_surcharge_enabled INTEGER NOT NULL DEFAULT 0/i);
  assert.match(sql, /payment_surcharge_percent TEXT NOT NULL DEFAULT '0'/i);
  assert.match(sql, /payment_surcharge_refunded_cents INTEGER NOT NULL DEFAULT 0/i);
});
