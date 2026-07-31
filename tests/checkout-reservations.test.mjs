import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkoutReservationFingerprint } from '../worker/inventory.js';

const root = new URL('../', import.meta.url);

function checkoutItem(overrides = {}) {
  return {
    productId: 'patagonia-fc-training-kit',
    variantId: 10,
    quantity: 1,
    playerName: 'Nico',
    playerNumber: '12',
    nameAddOn: 0,
    numberAddOn: 0,
    trackInventory: true,
    ...overrides
  };
}

const summary = { shippingCents: 0, totalCents: 9500 };
const pickup = { type: 'pickup' };

test('checkout reservation fingerprint is stable and changes with trusted checkout data', async () => {
  const first = await checkoutReservationFingerprint([checkoutItem()], summary, pickup);
  const retry = await checkoutReservationFingerprint([checkoutItem()], { ...summary }, { ...pickup });
  const changedQuantity = await checkoutReservationFingerprint([checkoutItem({ quantity: 2 })], summary, pickup);
  const changedFulfilment = await checkoutReservationFingerprint([checkoutItem()], { ...summary, shippingCents: 500, totalCents: 10000 }, { type: 'delivery' });

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(retry, first);
  assert.notEqual(changedQuantity, first);
  assert.notEqual(changedFulfilment, first);
});

test('inventory reservation migration is additive and constrains its lifecycle', async () => {
  const migration = await readFile(new URL('migrations/0019_checkout_inventory_reservations.sql', root), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS checkout_inventory_reservations/);
  assert.match(migration, /CHECK \(status IN \('reserved', 'session_created', 'payment_pending', 'committed', 'released', 'expired'\)\)/);
  assert.match(migration, /stripe_checkout_session_id TEXT UNIQUE/);
  assert.match(migration, /PRIMARY KEY \(reservation_id, product_variant_id\)/);
  assert.match(migration, /REFERENCES product_variants\(id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(migration, /\b(?:DROP TABLE|DELETE FROM|TRUNCATE|ALTER TABLE)\b/i);
});

test('checkout reserves before Stripe and releases only deterministic failures', async () => {
  const worker = await readFile(new URL('_worker.js', root), 'utf8');
  const reserveIndex = worker.indexOf('await reserveCheckoutInventory');
  const stripeIndex = worker.indexOf('const session = await createStripeCheckoutSession', reserveIndex);
  assert.ok(reserveIndex > -1 && stripeIndex > reserveIndex);
  assert.match(worker, /requestedExpiresAtUnix = Math\.floor\(Date\.now\(\) \/ 1000\) \+ 31 \* 60/);
  assert.match(worker, /if \(reservation\.required\) params\.append\('expires_at', String\(reservationExpiresAtUnix\)\)/);
  assert.doesNotMatch(worker, /params\.append\('expires_at', String\(requestedExpiresAtUnix\)\)/);
  assert.match(worker, /checkout\.session\.async_payment_failed/);
  assert.match(worker, /checkout\.session\.expired/);
  assert.match(worker, /markCheckoutReservationPaymentPending/);
  assert.match(worker, /error\.safeToReleaseReservation/);
});

test('reservation expiry is persisted so Stripe retries keep identical parameters', async () => {
  const inventory = await readFile(new URL('worker/inventory.js', root), 'utf8');
  assert.match(inventory, /existing\.expires_at/);
  assert.match(inventory, /required: true, reservationId, reused: false, expiresAt/);
});

test('success page confirms the paid order before clearing the cart', async () => {
  const page = await readFile(new URL('order-success.html', root), 'utf8');
  const statusIndex = page.indexOf('/api/checkout-status');
  const clearIndex = page.indexOf("localStorage.removeItem('ptg-cart')");
  assert.ok(statusIndex > -1 && clearIndex > statusIndex);
  assert.match(page, /Payment Confirmed/);
  assert.doesNotMatch(page, /Your payment has been received[^<]*$/m);
});
