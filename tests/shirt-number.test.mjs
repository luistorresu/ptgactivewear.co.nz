import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../_worker.js';
import { validateD1CheckoutPayload } from '../worker/inventory.js';
import {
  issueTrainingKitEligibilityProof,
  trainingKitPlayerNameIsValid,
  trainingKitShirtNumberIsValid,
  verifyTrainingKitEligibilityProof
} from '../worker/shirt-number.js';

const secretEnv = { SESSION_SECRET: 'test-shirt-number-secret-with-enough-entropy' };

function trainingDatabase() {
  const product = {
    id: 'patagonia-fc-training-kit', name: 'Patagonia FC Training Kit', price_cents: 9500,
    active: 1, archived: 0, available_for_sale: 1, track_inventory: 0,
    allow_player_name: 1, allow_player_number: 1, player_name_price_cents: 0, player_number_price_cents: 0
  };
  const variant = {
    id: 81, product_id: product.id, sku: 'PTG-PFC-TRAINING-KIT-8', size: '8', colour: '', style: '',
    stock_quantity: 0, active: 1, allow_player_name: 1, allow_player_number: 1
  };
  return { prepare(sql) { return { bind(...values) { return { async first() {
    if (sql.includes('FROM products WHERE id')) return values[0] === product.id ? product : null;
    if (sql.includes('FROM product_variants WHERE id')) return values[0] === variant.id ? variant : null;
    return null;
  } }; } }; } };
}

function d1Payload(number = '', token = '', name = "O'Connor") {
  return { items: [{
    productId: 'patagonia-fc-training-kit', variantId: 81, quantity: 1,
    personalisation: { name, number }, shirtNumberEligibilityToken: token
  }] };
}

test('Training Kit accepts safe optional names and whole shirt numbers 1 to 99 only', () => {
  for (const name of ['', 'Nico', 'Ana María', "O'Connor", 'Jean-Luc']) assert.equal(trainingKitPlayerNameIsValid(name), true, name);
  for (const name of ['Player7', '<script>', 'A.B']) assert.equal(trainingKitPlayerNameIsValid(name), false, name);
  for (const number of ['', '1', '2', '8', '11', '25', '99']) assert.equal(trainingKitShirtNumberIsValid(number), true, number);
  for (const number of ['0', '00', '1.5', '-1', '100', 'A', '<script>']) assert.equal(trainingKitShirtNumberIsValid(number), false, number);
});

test('Training Kit displays the approved number-selection notice in order', async () => {
  const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
  const approvedCopy = [
    'Number Selection',
    'Numbers 1,7,9,10 are not available.',
    'To keep things fair for everyone, shirt numbers 1, 7, 9, and 10 are only available if they match the day you were born — the date of your birthday, not the month or year.',
    'If your birthday does not fall on one of these dates, please choose another number. Most players choose the day of their birth date as their shirt number.',
    'Thank you for helping us keep shirt number allocation fair for everyone.'
  ];
  let previousIndex = -1;
  for (const copy of approvedCopy) {
    const index = source.indexOf(copy);
    assert.ok(index > previousIndex, copy);
    previousIndex = index;
  }
  const notice = source.slice(source.indexOf('id="${idBase}-shirt-number-help"'), source.indexOf('</section>', previousIndex));
  assert.doesNotMatch(notice, /Requested shirt number — subject to final availability\./);
});

test('restricted shirt-number proof accepts only the matching birth day and contains no birth-day data', async () => {
  for (const number of ['1', '7', '9', '10']) {
    const rejected = await issueTrainingKitEligibilityProof(number, number === '1' ? '2' : '1', secretEnv);
    assert.match(rejected.error, new RegExp(`number ${number}`, 'i'));
    const accepted = await issueTrainingKitEligibilityProof(number, number, secretEnv, 1000);
    assert.ok(accepted.token);
    assert.equal(await verifyTrainingKitEligibilityProof(accepted.token, number, secretEnv, 2000), true);
    assert.equal(await verifyTrainingKitEligibilityProof(accepted.token, number === '1' ? '7' : '1', secretEnv, 2000), false);
    const decoded = JSON.parse(Buffer.from(accepted.token.split('.')[0], 'base64url').toString('utf8'));
    assert.deepEqual(Object.keys(decoded).sort(), ['exp', 'n', 'p', 'v', 'verified']);
    assert.doesNotMatch(JSON.stringify(decoded), /birth|day/i);
  }
});

test('D1 checkout requires a valid signed proof for restricted Training Kit numbers', async () => {
  const env = { ...secretEnv, DB: trainingDatabase(), LOW_STOCK_THRESHOLD: '5' };
  for (const number of ['1', '7', '9', '10']) {
    const missing = await validateD1CheckoutPayload(d1Payload(number), env);
    assert.match(missing.error, new RegExp(`born on the ${number}`, 'i'));
    const proof = await issueTrainingKitEligibilityProof(number, number, env);
    const accepted = await validateD1CheckoutPayload(d1Payload(number, proof.token), env);
    assert.equal(accepted.error, undefined);
    assert.equal(accepted.items[0].restrictedNumberEligibilityVerified, true);
    assert.equal(accepted.items[0].nameAddOn, 2000);
    assert.equal(accepted.items[0].numberAddOn, 2000);
    assert.equal('shirtNumberEligibilityToken' in accepted.items[0], false);
  }
  for (const number of ['', '2', '8', '11', '25', '99']) {
    assert.equal((await validateD1CheckoutPayload(d1Payload(number), env)).error, undefined, number);
  }
});

test('Stripe Checkout receives shirt details and verification status but never birth-day data', async () => {
  const proof = await issueTrainingKitEligibilityProof('9', '9', secretEnv);
  const originalFetch = globalThis.fetch;
  let stripeBody = '';
  globalThis.fetch = async (url, options) => {
    stripeBody = String(options.body);
    return new Response(JSON.stringify({ id: 'cs_test_training_kit', url: 'https://checkout.stripe.com/test' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const response = await worker.fetch(new Request('https://ptgactivewear.co.nz/api/create-checkout-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        fulfilmentType: 'pickup', checkoutRequestId: 'training-kit-proof-9',
        items: [{
          productId: 'patagonia-fc-training-kit', quantity: 1, size: '8',
          personalisation: { name: 'Nico', number: '9' }, shirtNumberEligibilityToken: proof.token
        }]
      })
    }), { ...secretEnv, STRIPE_SECRET_KEY: 'sk_test_not_real', CHECKOUT_ENABLED: 'true' });
    assert.equal(response.status, 200);
    const decoded = decodeURIComponent(stripeBody.replace(/\+/g, ' '));
    assert.match(decoded, /Requested shirt number: 9 \(\+\$20\.00\)/);
    assert.match(decoded, /restricted_number_eligibility_verified.*=1/);
    assert.doesNotMatch(decoded, /birth.?day|birthday|day.?of.?birth/i);
    assert.doesNotMatch(decoded, new RegExp(proof.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public eligibility endpoint rejects mismatch and returns a non-sensitive proof for a match', async () => {
  const mismatch = await worker.fetch(new Request('https://ptgactivewear.co.nz/api/training-kit-number-eligibility', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shirtNumber: '10', birthDay: '9' })
  }), secretEnv);
  assert.equal(mismatch.status, 400);
  const accepted = await worker.fetch(new Request('https://ptgactivewear.co.nz/api/training-kit-number-eligibility', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shirtNumber: '10', birthDay: '10' })
  }), secretEnv);
  const body = await accepted.json();
  assert.equal(accepted.status, 200);
  assert.ok(body.eligibilityToken);
  assert.equal('birthDay' in body, false);
});

test('birth-day value is excluded from cart persistence, Stripe metadata, orders, emails, invoices, exports and logs', async () => {
  const sources = await Promise.all([
    'js/main.js', '_worker.js', 'worker/inventory.js', 'worker/invoices.js', 'admin/admin.js', 'admin/invoice.js', 'worker/admin-api.js'
  ].map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
  assert.match(sources[0], /\['birthDay', 'birthdayDay', 'dayOfBirth'\]/);
  assert.doesNotMatch(sources.slice(1).join('\n'), /metadata[^\n]*(?:birthDay|birthdayDay|dayOfBirth)|INSERT[^\n]*(?:birthDay|birthdayDay|dayOfBirth)/i);
  assert.doesNotMatch(sources.slice(2).join('\n'), /console\.(?:log|error)[^\n]*(?:birthDay|birthdayDay|dayOfBirth)/i);
});

test('paid orders persist only the non-sensitive restricted-number verification result', async () => {
  const [inventory, admin, exports] = await Promise.all([
    'worker/inventory.js',
    'admin/admin.js',
    'worker/admin-api.js'
  ].map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
  assert.match(inventory, /\[system:training-kit-restricted-number-verified=/);
  assert.doesNotMatch(inventory.match(/function restrictedNumberVerificationNote[\s\S]*?\n\}/)?.[0] || '', /birth|birthday/i);
  assert.match(admin, /Server verified.*Not recorded/);
  assert.match(admin, /Requested Shirt Number.*\(\+\$20\.00\)/);
  assert.match(exports, /eligibilityVerified \? 'Server verified' : 'Not recorded'/);
  assert.match(exports, /Player Name Charge NZD.*Shirt Number Charge NZD/);
  assert.match(exports, /systemMarkers.*suppliedNotes/s);
});
