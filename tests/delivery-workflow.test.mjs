import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildOutForDeliveryEmail,
  isDeliveryOrder,
  sendOutForDeliveryEmail,
  validateDeliveryAction
} from '../worker/delivery.js';

const root = new URL('../', import.meta.url);
const eligibleOrder = {
  id: 2,
  order_number: 'PTG-ORD-2026-000002',
  customer_name: 'Test Customer',
  customer_email: 'customer@example.com',
  payment_status: 'paid',
  fulfilment_status: 'paid',
  fulfilment_type: 'delivery',
  refund_status: 'not_refunded',
  refunded_cents: 0,
  total_cents: 4000
};
const emailEnv = {
  EMAIL_PROVIDER: 'resend',
  EMAIL_API_KEY: 're_test_not_real',
  CONTACT_FROM_EMAIL: 'info@ptgactivewear.co.nz',
  CONTACT_TO_EMAIL: 'info@ptgactivewear.co.nz'
};

test('delivery actions reject unsafe orders and allow direct completion of a paid delivery order', () => {
  assert.deepEqual(validateDeliveryAction(eligibleOrder, 'initial'), { ok: true });
  assert.deepEqual(validateDeliveryAction(eligibleOrder, 'completed'), { ok: true });
  assert.equal(validateDeliveryAction({ ...eligibleOrder, fulfilment_type: 'pickup' }, 'initial').code, 'NOT_DELIVERY');
  assert.equal(validateDeliveryAction({ ...eligibleOrder, payment_status: 'unpaid' }, 'initial').code, 'NOT_PAID');
  assert.equal(validateDeliveryAction({ ...eligibleOrder, fulfilment_status: 'cancelled' }, 'initial').code, 'ORDER_CLOSED');
  assert.equal(validateDeliveryAction({ ...eligibleOrder, refund_status: 'fully_refunded' }, 'completed').code, 'ORDER_CLOSED');
  assert.equal(validateDeliveryAction({ ...eligibleOrder, customer_email: '' }, 'initial').code, 'MISSING_EMAIL');
  assert.equal(validateDeliveryAction({ ...eligibleOrder, out_for_delivery_email_sent_at: '2026-07-27 01:00:00' }, 'initial').code, 'ALREADY_SENT');
  assert.equal(validateDeliveryAction(eligibleOrder, 'resend').code, 'NOT_SENT');
  assert.deepEqual(validateDeliveryAction({
    ...eligibleOrder,
    fulfilment_status: 'out_for_delivery',
    out_for_delivery_email_sent_at: '2026-07-27 01:00:00'
  }, 'resend'), { ok: true });
});

test('legacy delivery orders with a shipping address remain actionable', () => {
  const legacyDelivery = {
    ...eligibleOrder,
    fulfilment_type: '',
    shipping_address_json: JSON.stringify({
      line1: '3 Renown Avenue',
      city: 'Auckland',
      postal_code: '1051',
      country: 'NZ'
    })
  };
  assert.equal(isDeliveryOrder(legacyDelivery), true);
  assert.deepEqual(validateDeliveryAction(legacyDelivery, 'completed'), { ok: true });
  assert.equal(isDeliveryOrder({ ...legacyDelivery, fulfilment_type: 'pickup' }), false);
  assert.equal(isDeliveryOrder({ ...legacyDelivery, shipping_address_json: '{}' }), false);
  assert.equal(validateDeliveryAction({ ...legacyDelivery, shipping_address_json: '{}' }, 'completed').code, 'NOT_DELIVERY');
});

test('Out for Delivery email is branded, responsive and excludes technical references', () => {
  const email = buildOutForDeliveryEmail(eligibleOrder, emailEnv);
  assert.equal(email.subject, 'Your PTG Activewear order is out for delivery');
  assert.equal(email.to, 'customer@example.com');
  assert.equal(email.replyTo, 'info@ptgactivewear.co.nz');
  for (const content of [email.text, email.html]) {
    assert.match(content, /PTG Activewear/);
    assert.match(content, /PTG-ORD-2026-000002/);
    assert.match(content, /out for delivery/i);
    assert.doesNotMatch(content, /stripe|payment.intent|checkout.session|database ID|birth.?day|birthday/i);
  }
});

test('Out for Delivery Resend request uses the backend secret and idempotency key', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: 'email_delivery_123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const result = await sendOutForDeliveryEmail(
      emailEnv,
      buildOutForDeliveryEmail(eligibleOrder, emailEnv),
      'ptg-out-for-delivery-2-initial'
    );
    assert.equal(result.id, 'email_delivery_123');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer re_test_not_real');
    assert.equal(calls[0].options.headers['Idempotency-Key'], 'ptg-out-for-delivery-2-initial');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.from, 'info@ptgactivewear.co.nz');
    assert.deepEqual(body.to, ['customer@example.com']);
    assert.equal(body.reply_to, 'info@ptgactivewear.co.nz');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Out for Delivery provider failures expose only a safe status code', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('private provider response', { status: 422 });
  try {
    await assert.rejects(
      sendOutForDeliveryEmail(
        emailEnv,
        buildOutForDeliveryEmail(eligibleOrder, emailEnv),
        'ptg-out-for-delivery-2-initial'
      ),
      error => error.code === 'RESEND_422' && !error.message.includes('private provider response')
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('delivery migration and admin workflow are additive, protected and retry-safe', async () => {
  const [migration, api, html, admin, worker] = await Promise.all([
    'migrations/0017_delivery_fulfilment.sql',
    'worker/admin-api.js',
    'admin/index.html',
    'admin/admin.js',
    '_worker.js'
  ].map(path => readFile(new URL(path, root), 'utf8')));
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
  assert.match(migration, /out_for_delivery_email_status/);
  assert.match(migration, /delivery_email_attempts/);
  assert.match(migration, /completed_at/);
  assert.match(migration, /delivery_request_id/);
  assert.match(api, /out-for-delivery/);
  assert.match(api, /resend-out-for-delivery/);
  assert.match(api, /mark-completed/);
  assert.match(api, /out_for_delivery_email_status != 'sending'/);
  assert.match(api, /out_for_delivery_email_lock_at < datetime\('now', '-5 minutes'\)/);
  assert.match(api, /order_marked_out_for_delivery/);
  assert.match(api, /out_for_delivery_email_sent/);
  assert.match(api, /out_for_delivery_email_failed/);
  assert.match(api, /order_marked_completed/);
  assert.match(api, /SET fulfilment_type = 'delivery'/);
  assert.match(api, /shipping_address_json NOT IN \('', '\{\}'\)/);
  assert.match(html, /Out for delivery/);
  assert.match(admin, /Mark Out for Delivery & Send Email/);
  assert.match(admin, /Resend Out for Delivery Email/);
  assert.match(admin, /Mark Completed/);
  assert.match(worker, /isAdminMutationAllowed/);
});

test('Out for Delivery email remains a manual admin action', async () => {
  const [worker, api] = await Promise.all([
    readFile(new URL('_worker.js', root), 'utf8'),
    readFile(new URL('worker/admin-api.js', root), 'utf8')
  ]);
  const paidEmailStart = worker.indexOf('async function sendOrderEmails');
  const paidEmailEnd = worker.indexOf('async function handleSuccessfulCheckoutEvent', paidEmailStart);
  assert.doesNotMatch(worker.slice(paidEmailStart, paidEmailEnd), /Out for Delivery|sendOutForDeliveryEmail/);
  assert.match(api, /method === 'POST'.*out-for-delivery/s);
});
