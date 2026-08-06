import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateCheckoutCustomerDetails } from '../worker/customer-details.js';
import worker, { buildBusinessOrderEmail, buildCustomerOrderEmail, buildOrderEmailData } from '../_worker.js';
import { buildReadyToCollectEmail } from '../worker/collection.js';

const root = new URL('../', import.meta.url);

test('checkout customer details accept normal international names and normalise spacing', () => {
  const valid = [
    ['Nico Torres', 'Sofia Torres'],
    ['Anne-Marie Smith', "D'Arcy Smith"],
    ['José Núñez', 'Chloé O’Connor'],
    ['Mārama Te Rangi', 'Āria Te Rangi']
  ];
  for (const [customerName, childName] of valid) {
    assert.deepEqual(validateCheckoutCustomerDetails({ customerName, childName }), { customerName, childName });
  }
  assert.deepEqual(
    validateCheckoutCustomerDetails({ customerName: '  Nico   Torres  ', childName: '  Sofia   Torres  ' }),
    { customerName: 'Nico Torres', childName: 'Sofia Torres' }
  );
});

test("Child's Name rejects blank, excessive, executable and malformed values", () => {
  for (const childName of ['', '   ']) {
    assert.equal(validateCheckoutCustomerDetails({ customerName: 'Nico Torres', childName }).field, 'childName');
  }
  assert.match(validateCheckoutCustomerDetails({ customerName: 'Nico Torres', childName: 'A'.repeat(61) }).error, /60 characters/);
  for (const childName of ['<b>Sofia</b>', '<script>alert(1)</script>', 'Sofia123']) {
    assert.match(validateCheckoutCustomerDetails({ customerName: 'Nico Torres', childName }).error, /letters, spaces, hyphens/);
  }
  for (const value of [[], { childName: 'Sofia' }, 'Sofia']) {
    assert.match(validateCheckoutCustomerDetails(value).error, /invalid|text|required/i);
  }
  assert.match(validateCheckoutCustomerDetails({ customerName: 'Nico Torres', childName: [] }).error, /text/i);
  assert.match(validateCheckoutCustomerDetails({ customerName: 'Nico Torres', childName: {} }).error, /text/i);
});

test("Child's Name is required before Stripe and is included in stable metadata", async () => {
  const [worker, client] = await Promise.all([
    readFile(new URL('_worker.js', root), 'utf8'),
    readFile(new URL('js/main.js', root), 'utf8')
  ]);
  assert.match(worker, /requireCustomerDetails: true/);
  assert.match(worker, /metadata\[child_name\]/);
  assert.match(worker, /metadata\[checkout_details_version\]/);
  assert.match(client, /<span>Child&rightsquo;s Name<\/span>|<span>Child&rsquo;s Name<\/span>/);
  assert.ok(client.indexOf('<span>Customer Name</span>') < client.indexOf('<span>Child&rsquo;s Name</span>'));
  assert.match(client, /Enter the name of the child who will receive this order\./);
  assert.match(client, /sessionStorage\.setItem\(CHECKOUT_CUSTOMER_KEY/);
  assert.doesNotMatch(client, /localStorage\.setItem\(CHECKOUT_CUSTOMER_KEY/);
});

test("checkout rejects a missing Child's Name before contacting Stripe", async () => {
  const originalFetch = globalThis.fetch;
  let stripeCalls = 0;
  globalThis.fetch = async () => {
    stripeCalls += 1;
    throw new Error('Stripe must not be called for invalid customer details.');
  };
  try {
    const response = await worker.fetch(new Request('https://ptgactivewear.co.nz/api/create-checkout-session', {
      method: 'POST',
      headers: { Origin: 'https://ptgactivewear.co.nz', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fulfilmentType: 'pickup',
        checkoutRequestId: 'child-name-test-1',
        customerDetails: { customerName: 'Nico Torres', childName: '   ' },
        items: [{ productId: 'patagonia-fc-beanie', quantity: 1, size: 'One Size' }]
      })
    }), { STRIPE_SECRET_KEY: 'sk_test_not_real', CHECKOUT_ENABLED: 'true' });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error, "Child's Name is required.");
    assert.equal(stripeCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Child's Name is escaped in order emails and retained in collection messaging", () => {
  const session = {
    id: 'cs_test_child', payment_status: 'paid', currency: 'nzd', amount_total: 3500,
    customer_details: { name: 'Stripe Billing Name', email: 'customer@example.com' },
    total_details: { amount_shipping: 0 },
    metadata: {
      checkout_details_version: '1', checkout_customer_name: 'Nico Torres', child_name: 'Sofia Torres',
      subtotal_cents: '3500', personalisation_cents: '0', shipping_cents: '0', payment_surcharge_cents: '0',
      payment_surcharge_enabled: '0', payment_surcharge_percent: '0', payment_surcharge_fixed_cents: '0',
      fulfilment_type: 'pickup', shipping_method: 'Pick up from Training Centre', pickup_location: 'Training Centre'
    }
  };
  const lines = [{ description: 'Beanie', quantity: 1, amount_total: 3500, price: { product: { metadata: { item_kind: 'base_product' } } } }];
  const order = { ...buildOrderEmailData(session, lines), orderNumber: 'PTG-ORD-2026-000001', orderDate: '6 August 2026' };
  for (const email of [buildBusinessOrderEmail(order), buildCustomerOrderEmail(order)]) {
    assert.match(email.text, /Child's Name: Sofia Torres/);
    assert.match(email.html, /Child's Name:<\/strong> Sofia Torres/);
  }
  const ready = buildReadyToCollectEmail({
    order_number: order.orderNumber, customer_name: order.customerName, child_name: order.childName,
    customer_email: order.customerEmail, pickup_location: 'Training Centre', pickup_instructions: 'Collect after training.'
  }, { CONTACT_TO_EMAIL: 'info@ptgactivewear.co.nz' });
  assert.match(ready.text, /order for Sofia Torres is ready to collect/);
  assert.match(ready.text, /Child's Name:\nSofia Torres/);
});

test("Child's Name migration, admin search, invoice and exports are additive and private", async () => {
  const [migration, inventory, invoices, adminApi, admin, invoice] = await Promise.all([
    'migrations/0020_order_child_name.sql', 'worker/inventory.js', 'worker/invoices.js',
    'worker/admin-api.js', 'admin/admin.js', 'admin/invoice.js'
  ].map(path => readFile(new URL(path, root), 'utf8')));
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
  assert.match(migration, /ALTER TABLE orders ADD COLUMN child_name TEXT/);
  assert.match(migration, /ALTER TABLE invoices ADD COLUMN child_name TEXT/);
  assert.match(inventory, /customer_name, child_name, customer_email/);
  assert.match(invoices, /customer_name, child_name, customer_email/);
  assert.match(adminApi, /child_name LIKE \?/);
  assert.match(adminApi, /values\.push\(`%\$\{search\}%`, `%\$\{search\}%`, `%\$\{search\}%`, `%\$\{search\}%`\)/);
  assert.match(adminApi, /"Child's Name"/);
  assert.match(admin, /Child's Name/);
  assert.match(invoice, /Child's Name:/);
});

test('legacy checkout sessions and historical orders remain compatible', () => {
  const legacy = validateCheckoutCustomerDetails(undefined, { required: false });
  assert.deepEqual(legacy, { customerName: '', childName: '' });
  const session = {
    id: 'cs_test_legacy', payment_status: 'paid', currency: 'nzd', amount_total: 1500,
    customer_details: { name: 'Legacy Customer', email: 'legacy@example.com' },
    total_details: { amount_shipping: 0 },
    metadata: { fulfilment_type: 'pickup', shipping_method: 'Pickup', subtotal_cents: '1500' }
  };
  const order = buildOrderEmailData(session, []);
  assert.equal(order.customerName, 'Legacy Customer');
  assert.equal(order.childName, '');
});
