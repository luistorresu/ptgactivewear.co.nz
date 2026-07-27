import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildReadyToCollectEmail,
  sendReadyToCollectEmail,
  validateCollectionAction
} from '../worker/collection.js';

const root = new URL('../', import.meta.url);
const eligibleOrder = {
  id: 42,
  order_number: 'PTG-ORD-2026-000042',
  customer_name: 'Nico Torres',
  customer_email: 'nico@example.com',
  payment_status: 'paid',
  fulfilment_status: 'processing',
  fulfilment_type: 'pickup',
  refund_status: 'not_refunded',
  refunded_cents: 0,
  total_cents: 9500,
  pickup_location: 'Training Centre',
  pickup_instructions: 'Collect after training.'
};
const emailEnv = {
  EMAIL_API_KEY: 're_test_not_real',
  CONTACT_FROM_EMAIL: 'info@ptgactivewear.co.nz',
  CONTACT_TO_EMAIL: 'info@ptgactivewear.co.nz',
  PICKUP_LOCATION_NAME: 'Training Centre',
  PICKUP_ADDRESS_LINE_1: '',
  PICKUP_ADDRESS_LINE_2: '',
  PICKUP_CITY: '',
  PICKUP_POSTCODE: ''
};

test('Ready to Collect eligibility rejects unsafe orders and permits paid pickup orders', () => {
  assert.deepEqual(validateCollectionAction(eligibleOrder, 'initial'), { ok: true });
  assert.equal(validateCollectionAction({ ...eligibleOrder, fulfilment_type: 'delivery' }, 'initial').code, 'NOT_PICKUP');
  assert.equal(validateCollectionAction({ ...eligibleOrder, payment_status: 'unpaid' }, 'initial').code, 'NOT_PAID');
  assert.equal(validateCollectionAction({ ...eligibleOrder, fulfilment_status: 'cancelled' }, 'initial').code, 'ORDER_CLOSED');
  assert.equal(validateCollectionAction({ ...eligibleOrder, refund_status: 'fully_refunded' }, 'initial').code, 'ORDER_CLOSED');
  assert.equal(validateCollectionAction({ ...eligibleOrder, customer_email: '' }, 'initial').code, 'MISSING_EMAIL');
  assert.equal(validateCollectionAction({ ...eligibleOrder, ready_for_collection_email_sent_at: '2026-07-27 01:00:00' }, 'initial').code, 'ALREADY_SENT');
  assert.equal(validateCollectionAction(eligibleOrder, 'resend').code, 'NOT_SENT');
  assert.deepEqual(validateCollectionAction({
    ...eligibleOrder,
    fulfilment_status: 'ready_for_collection',
    ready_for_collection_email_sent_at: '2026-07-27 01:00:00'
  }, 'resend'), { ok: true });
  assert.deepEqual(validateCollectionAction({ ...eligibleOrder, fulfilment_status: 'ready_for_collection' }, 'collected'), { ok: true });
  assert.equal(validateCollectionAction(eligibleOrder, 'collected').code, 'NOT_READY');
});

test('Ready to Collect email is branded, responsive and contains no private or technical references', () => {
  const email = buildReadyToCollectEmail(eligibleOrder, emailEnv);
  assert.equal(email.subject, 'Your PTG Activewear order is ready to collect');
  assert.equal(email.to, 'nico@example.com');
  for (const content of [email.text, email.html]) {
    assert.match(content, /PTG Activewear/);
    assert.match(content, /PTG-ORD-2026-000042/);
    assert.match(content, /Training Centre/);
    assert.match(content, /Collect after training/);
    assert.doesNotMatch(content, /stripe|payment.intent|checkout.session|database ID|birth.?day|birthday/i);
  }
  assert.doesNotMatch(email.text, /Pickup address:/);
  assert.doesNotMatch(email.html, /Pickup address/);

  const configured = buildReadyToCollectEmail(eligibleOrder, {
    ...emailEnv,
    PICKUP_ADDRESS_LINE_1: '10 Example Street',
    PICKUP_CITY: 'Auckland',
    PICKUP_POSTCODE: '1010'
  });
  assert.match(configured.text, /Pickup address:\n10 Example Street, Auckland, 1010/);
  assert.match(configured.html, /10 Example Street, Auckland, 1010/);
});

test('Resend delivery uses the backend secret and an idempotency key', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: 'email_test_123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const email = buildReadyToCollectEmail(eligibleOrder, emailEnv);
    const result = await sendReadyToCollectEmail(emailEnv, email, 'ptg-ready-42-initial');
    assert.equal(result.id, 'email_test_123');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer re_test_not_real');
    assert.equal(calls[0].options.headers['Idempotency-Key'], 'ptg-ready-42-initial');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.from, 'info@ptgactivewear.co.nz');
    assert.deepEqual(body.to, ['nico@example.com']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Resend failures expose only a safe provider status code', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('private provider response', { status: 422 });
  try {
    await assert.rejects(
      sendReadyToCollectEmail(emailEnv, buildReadyToCollectEmail(eligibleOrder, emailEnv), 'ptg-ready-42-initial'),
      error => error.code === 'RESEND_422' && !error.message.includes('private provider response')
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('collection migration and admin workflow are additive, protected and retry-safe', async () => {
  const [migration, api, html, admin, invoice, worker] = await Promise.all([
    'migrations/0016_ready_for_collection.sql',
    'worker/admin-api.js',
    'admin/index.html',
    'admin/admin.js',
    'admin/invoice.js',
    '_worker.js'
  ].map(path => readFile(new URL(path, root), 'utf8')));
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
  assert.match(migration, /ready_for_collection_email_status/);
  assert.match(migration, /ready_collection_email_attempts/);
  assert.match(migration, /restricted_number_verified/);
  assert.match(migration, /collection_request_id/);
  assert.doesNotMatch(migration, /birth.?day|birthday/i);
  assert.match(api, /ready-for-collection/);
  assert.match(api, /resend-ready-for-collection/);
  assert.match(api, /mark-collected/);
  assert.match(api, /ready_for_collection_email_status != 'sending'/);
  assert.match(api, /ready_for_collection_email_lock_at < datetime\('now', '-5 minutes'\)/);
  assert.match(api, /order_marked_ready_for_collection/);
  assert.match(api, /ready_to_collect_email_sent/);
  assert.match(api, /ready_to_collect_email_failed/);
  assert.match(api, /order_marked_collected/);
  assert.match(html, /data-order-collection-state/);
  assert.match(html, /Ready email not sent/);
  assert.match(admin, /Mark Ready to Collect & Send Email/);
  assert.match(admin, /Resend Ready to Collect Email/);
  assert.match(admin, /Mark as Collected/);
  assert.match(invoice, /restricted_number_verified/);
  assert.match(worker, /isAdminMutationAllowed/);
});

test('Ready to Collect email is manual and not part of the paid-order email function', async () => {
  const [worker, api] = await Promise.all([
    readFile(new URL('_worker.js', root), 'utf8'),
    readFile(new URL('worker/admin-api.js', root), 'utf8')
  ]);
  const paidEmailStart = worker.indexOf('async function sendOrderEmails');
  const paidEmailEnd = worker.indexOf('async function handleSuccessfulCheckoutEvent', paidEmailStart);
  assert.doesNotMatch(worker.slice(paidEmailStart, paidEmailEnd), /Ready to Collect|sendReadyToCollectEmail/);
  assert.match(api, /method === 'POST'.*ready-for-collection/s);
});
