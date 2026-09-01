import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from '../_worker.js';
import {
  RAFFLE_SLUG,
  attachRaffleCheckoutSession,
  buildRaffleBusinessEmail,
  buildRaffleCustomerEmail,
  commitPaidRaffleOrder,
  getAdminRaffles,
  getPublicRaffle,
  markRaffleReservationPaymentPending,
  normaliseRaffleNumbers,
  raffleCheckoutTotals,
  releaseExpiredRaffleReservations,
  releaseRaffleReservation,
  reserveRaffleNumbers,
  updateRaffleNumberStatus,
  verifyRaffleStripeSnapshot
} from '../worker/raffles.js';

const root = new URL('../', import.meta.url);
const customerDetails = { customerName: 'Test Parent', childName: 'Test Player', customerEmail: 'parent@example.com' };

class D1Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    return this.db.prepare(this.sql).get(...this.args) || null;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.args) };
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
  }
}

class D1Database {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new D1Statement(this.sqlite, sql);
  }

  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) || null;
  }

  async put(key, value) {
    this.values.set(key, value);
  }

  async delete(key) {
    this.values.delete(key);
  }
}

async function testDatabase({ localSeed = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE stripe_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      stripe_checkout_session_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      attempts INTEGER NOT NULL DEFAULT 1,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT
    );`);
  sqlite.exec(await readFile(new URL('migrations/0024_fundraising_raffles.sql', root), 'utf8'));
  sqlite.exec(await readFile(new URL('migrations/0025_givealittle_fundraiser.sql', root), 'utf8'));
  if (localSeed) sqlite.exec(await readFile(new URL('seed/seed-raffle-test.sql', root), 'utf8'));
  return { sqlite, DB: new D1Database(sqlite) };
}

function raffleEnv(DB, overrides = {}) {
  return {
    DB,
    PAYMENT_SURCHARGE_ENABLED: 'false',
    PAYMENT_SURCHARGE_PERCENT: '2.65',
    PAYMENT_SURCHARGE_FIXED_CENTS: '30',
    PAYMENT_SURCHARGE_LABEL: 'Card processing surcharge',
    PAYMENT_SURCHARGE_DESCRIPTION: 'Processing cost',
    ...overrides
  };
}

function paidSession(reservation, totals, overrides = {}) {
  return {
    id: overrides.id || `cs_test_${reservation.reservationId}`,
    payment_intent: overrides.paymentIntent || `pi_test_${reservation.reservationId}`,
    payment_status: 'paid',
    payment_method_types: ['card'],
    currency: 'nzd',
    amount_total: totals.totalCents,
    total_details: { amount_shipping: 0, amount_discount: 0, amount_tax: 0 },
    customer_details: { name: customerDetails.customerName, email: 'customer@example.com', phone: '0210000000' },
    metadata: {
      order_type: 'raffle',
      checkout_customer_name: customerDetails.customerName,
      child_name: customerDetails.childName,
      raffle_id: reservation.raffle.id,
      raffle_request_id: reservation.reservationId,
      raffle_reservation_token: reservation.reservationToken,
      raffle_numbers: reservation.numbers.join(','),
      raffle_ticket_price_cents: String(totals.ticketPriceCents),
      raffle_ticket_count: String(totals.ticketCount),
      raffle_subtotal_cents: String(totals.subtotalCents),
      payment_surcharge_cents: String(totals.paymentSurchargeCents),
      payment_surcharge_enabled: totals.surcharge.enabled ? '1' : '0',
      payment_surcharge_percent: totals.surcharge.percent,
      payment_surcharge_fixed_cents: String(totals.surcharge.fixedCents),
      payment_surcharge_label: totals.surcharge.label,
      total_cents: String(totals.totalCents)
    }
  };
}

function paidLines(totals) {
  const lines = [{
    quantity: totals.ticketCount,
    amount_total: totals.subtotalCents,
    price: { product: { metadata: { item_kind: 'raffle_ticket' } } }
  }];
  if (totals.paymentSurchargeCents) lines.push({
    quantity: 1,
    amount_total: totals.paymentSurchargeCents,
    price: { product: { metadata: { item_kind: 'payment_surcharge' } } }
  });
  return lines;
}

async function reserve(env, number, requestId, now = Date.now()) {
  return reserveRaffleNumbers(env, {
    numbers: Array.isArray(number) ? number : [number],
    requestId,
    customerDetails,
    now
  });
}

test('raffle migration is additive, reusable and enforces unique numbers', async () => {
  const migration = await readFile(new URL('migrations/0024_fundraising_raffles.sql', root), 'utf8');
  const givealittleMigration = await readFile(new URL('migrations/0025_givealittle_fundraiser.sql', root), 'utf8');
  assert.doesNotMatch(migration, /^\s*(?:DROP|DELETE|TRUNCATE|ALTER\s+TABLE)\b/im);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS raffles/);
  assert.match(migration, /PRIMARY KEY \(raffle_id, number\)/);
  assert.match(givealittleMigration, /customer_email/);
  assert.match(givealittleMigration, /reservation_minutes = 1440/);
  const { sqlite } = await testDatabase();
  assert.throws(() => sqlite.prepare(`INSERT INTO raffle_numbers (raffle_id, number) VALUES (?, ?)`)
    .run('patagonia-fc-tournament-2026', 1), /UNIQUE constraint/i);
});

test('local raffle seed exposes the requested available, reserved and sold states', async () => {
  const { DB } = await testDatabase({ localSeed: true });
  const raffle = await getPublicRaffle(raffleEnv(DB));
  assert.deepEqual(raffle.numbers.slice(0, 6), [
    { number: 1, status: 'available' }, { number: 2, status: 'available' },
    { number: 3, status: 'available' }, { number: 4, status: 'reserved' },
    { number: 5, status: 'sold' }, { number: 6, status: 'sold' }
  ]);
  assert.equal(raffle.soldCount, 2);
  assert.equal(raffle.reservedCount, 1);
  assert.equal(JSON.stringify(raffle).includes('Local Test Customer'), false);
});

test('sold-out raffles remain visible and cannot start another reservation', async () => {
  const { DB } = await testDatabase();
  await DB.prepare(`UPDATE raffle_numbers SET status = 'sold', sold_at = CURRENT_TIMESTAMP
    WHERE raffle_id = 'patagonia-fc-tournament-2026'`).run();
  const env = raffleEnv(DB);
  const raffle = await getPublicRaffle(env);
  assert.equal(raffle.soldCount, 36);
  assert.equal(raffle.soldOut, true);
  const attempt = await reserve(env, 9, 'soldout-test-123');
  assert.equal(attempt.code, 'RAFFLE_NUMBER_UNAVAILABLE');
  assert.equal(attempt.status, 409);
});

test('raffle number validation rejects duplicates, decimals, strings, negatives and out-of-range values', () => {
  for (const invalid of [[1, 1], [1.5], ['1'], [-1], [0], [37], [], null]) {
    assert.ok(normaliseRaffleNumbers(invalid, 36).error, JSON.stringify(invalid));
  }
  assert.deepEqual(normaliseRaffleNumbers([36, 2, 11], 36).numbers, [2, 11, 36]);
});

test('exactly one simultaneous reservation for the same number succeeds', async () => {
  const { DB } = await testDatabase();
  const env = raffleEnv(DB);
  const [first, second] = await Promise.all([
    reserve(env, 7, 'race-customer-a'),
    reserve(env, 7, 'race-customer-b')
  ]);
  const successes = [first, second].filter(result => !result.error);
  const conflicts = [first, second].filter(result => result.code === 'RAFFLE_NUMBER_UNAVAILABLE');
  assert.equal(successes.length, 1);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0].error, /number 7 has just been selected/i);
  const row = await DB.prepare(`SELECT status, reservation_token FROM raffle_numbers WHERE raffle_id = ? AND number = 7`)
    .bind('patagonia-fc-tournament-2026').first();
  assert.equal(row.status, 'reserved');
  assert.equal(row.reservation_token, successes[0].reservationToken);
});

test('duplicate checkout attempts are idempotent and changed retries are rejected', async () => {
  const { DB } = await testDatabase();
  const env = raffleEnv(DB);
  const first = await reserve(env, [8, 9], 'duplicate-raffle-attempt');
  const retry = await reserve(env, [8, 9], 'duplicate-raffle-attempt');
  const changed = await reserve(env, [8, 10], 'duplicate-raffle-attempt');
  assert.equal(retry.reservationToken, first.reservationToken);
  assert.equal(retry.reused, true);
  assert.equal(changed.code, 'RAFFLE_ATTEMPT_CHANGED');
  const rows = await DB.prepare(`SELECT number FROM raffle_numbers WHERE raffle_id = ? AND status = 'reserved' ORDER BY number`)
    .bind('patagonia-fc-tournament-2026').all();
  assert.deepEqual(rows.results.map(row => row.number), [8, 9]);
});

test('a multi-number conflict never silently substitutes or leaves a partial reservation', async () => {
  const { DB } = await testDatabase();
  const env = raffleEnv(DB);
  await reserve(env, 10, 'existing-number-ten');
  const result = await reserve(env, [10, 11], 'partial-conflict-attempt');
  assert.equal(result.code, 'RAFFLE_NUMBER_UNAVAILABLE');
  const numberEleven = await DB.prepare(`SELECT status FROM raffle_numbers WHERE raffle_id = ? AND number = 11`)
    .bind('patagonia-fc-tournament-2026').first();
  assert.equal(numberEleven.status, 'available');
});

test('expired and cancelled reservations become available without a customer return', async () => {
  const { DB } = await testDatabase();
  const env = raffleEnv(DB);
  const expired = await reserve(env, 12, 'expired-raffle-attempt', Date.now() - 25 * 60 * 60 * 1000);
  assert.equal(expired.error, undefined);
  assert.equal(await releaseExpiredRaffleReservations(env), 1);
  assert.equal((await DB.prepare(`SELECT status FROM raffle_numbers WHERE raffle_id = ? AND number = 12`)
    .bind('patagonia-fc-tournament-2026').first()).status, 'available');

  const cancelled = await reserve(env, 13, 'cancelled-raffle-attempt');
  const session = { id: 'cs_test_cancelled_raffle', url: 'https://checkout.stripe.test/cancelled' };
  await attachRaffleCheckoutSession(DB, cancelled, session);
  const released = await releaseRaffleReservation(env, { sessionId: session.id, reason: 'expired' });
  assert.equal(released.released, true);
  assert.equal((await DB.prepare(`SELECT status FROM raffle_numbers WHERE raffle_id = ? AND number = 13`)
    .bind('patagonia-fc-tournament-2026').first()).status, 'available');
});

test('admin can confirm a matched Givealittle donation or release an abandoned reservation', async () => {
  const { DB } = await testDatabase();
  const env = raffleEnv(DB);
  const soldReservation = await reserve(env, 17, 'admin-confirm-reservation');
  assert.equal(soldReservation.error, undefined);
  const confirmed = await updateRaffleNumberStatus(env, {
    raffleId: soldReservation.raffle.id, number: 17, action: 'confirm'
  });
  assert.equal(confirmed.ok, true);
  assert.equal((await DB.prepare('SELECT status FROM raffle_numbers WHERE raffle_id = ? AND number = 17')
    .bind(soldReservation.raffle.id).first()).status, 'sold');

  const abandoned = await reserve(env, 18, 'admin-release-reservation');
  const released = await updateRaffleNumberStatus(env, {
    raffleId: abandoned.raffle.id, number: 18, action: 'release'
  });
  assert.equal(released.ok, true);
  assert.equal((await DB.prepare('SELECT status FROM raffle_numbers WHERE raffle_id = ? AND number = 18')
    .bind(abandoned.raffle.id).first()).status, 'available');
});

test('Stripe snapshot uses integer cents and rejects price, surcharge, shipping, discount and total manipulation', async () => {
  const { DB } = await testDatabase();
  const env = raffleEnv(DB, { PAYMENT_SURCHARGE_ENABLED: 'true' });
  const raffle = await DB.prepare('SELECT * FROM raffles WHERE slug = ?').bind(RAFFLE_SLUG).first();
  const totals = raffleCheckoutTotals(raffle, 2, env);
  assert.deepEqual({ subtotal: totals.subtotalCents, surcharge: totals.paymentSurchargeCents, total: totals.totalCents }, {
    subtotal: 4000, surcharge: 136, total: 4136
  });
  const reservation = { raffle, reservationId: 'snapshot', reservationToken: 'token', numbers: [14, 15] };
  const session = paidSession(reservation, totals);
  const lines = paidLines(totals);
  assert.equal(verifyRaffleStripeSnapshot(session, lines).totalCents, 4136);
  assert.throws(() => verifyRaffleStripeSnapshot({ ...session, amount_total: 4135 }, lines), /paid total/i);
  assert.throws(() => verifyRaffleStripeSnapshot({ ...session, total_details: { amount_shipping: 1, amount_discount: 0 } }, lines), /shipping or discounts/i);
  assert.throws(() => verifyRaffleStripeSnapshot({ ...session, metadata: { ...session.metadata, raffle_ticket_price_cents: '1999' } }, lines), /subtotal/i);
  assert.throws(() => verifyRaffleStripeSnapshot(session, [lines[0], { ...lines[1], amount_total: 135 }]), /surcharge/i);
});

test.skip('legacy verified paid checkout atomically sells all numbers and duplicate webhooks create one order', async () => {
  const { DB } = await testDatabase();
  const env = raffleEnv(DB);
  const reservation = await reserve(env, [14, 15], 'paid-raffle-attempt');
  const totals = raffleCheckoutTotals(reservation.raffle, 2, env);
  const session = paidSession(reservation, totals, { id: 'cs_test_paid_raffle' });
  await attachRaffleCheckoutSession(DB, reservation, { id: session.id, url: 'https://checkout.stripe.test/paid' });
  const event = { id: 'evt_test_paid_raffle', type: 'checkout.session.completed' };
  const first = await commitPaidRaffleOrder(env, event, session, paidLines(totals));
  const duplicate = await commitPaidRaffleOrder(env, event, session, paidLines(totals));
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(first.orderId, duplicate.orderId);
  const numbers = await DB.prepare(`SELECT number, status, raffle_order_id FROM raffle_numbers
    WHERE raffle_id = ? AND number IN (14, 15) ORDER BY number`).bind(reservation.raffle.id).all();
  assert.deepEqual(numbers.results.map(row => [row.number, row.status, row.raffle_order_id]), [
    [14, 'sold', first.orderId], [15, 'sold', first.orderId]
  ]);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS count FROM raffle_orders').first()).count, 1);
});

test.skip('legacy payment after expiry is rejected unless Stripe previously marked it payment pending', async () => {
  const { DB } = await testDatabase();
  const env = raffleEnv(DB);
  const expired = await reserve(env, 16, 'late-paid-raffle', Date.now() - 25 * 60 * 60 * 1000);
  const totals = raffleCheckoutTotals(expired.raffle, 1, env);
  const session = paidSession(expired, totals, { id: 'cs_test_late_paid' });
  await attachRaffleCheckoutSession(DB, expired, { id: session.id, url: 'https://checkout.stripe.test/late' });
  await assert.rejects(() => commitPaidRaffleOrder(env, { id: 'evt_test_late', type: 'checkout.session.completed' }, session, paidLines(totals)), /raffle reservation mismatch/i);
  assert.equal((await DB.prepare(`SELECT status FROM raffle_numbers WHERE raffle_id = ? AND number = 16`)
    .bind(expired.raffle.id).first()).status, 'reserved');

  await markRaffleReservationPaymentPending(DB, session);
  const committed = await commitPaidRaffleOrder(env, { id: 'evt_test_late_async', type: 'checkout.session.async_payment_succeeded' }, session, paidLines(totals));
  assert.equal(committed.duplicate, false);
  assert.equal((await DB.prepare(`SELECT status FROM raffle_numbers WHERE raffle_id = ? AND number = 16`)
    .bind(expired.raffle.id).first()).status, 'sold');
});

test('admin raffle data contains sold ownership while the public response remains private', async () => {
  const { DB } = await testDatabase({ localSeed: true });
  const [publicRaffle, adminRaffles] = await Promise.all([
    getPublicRaffle(raffleEnv(DB)),
    getAdminRaffles(DB)
  ]);
  assert.equal(JSON.stringify(publicRaffle).includes('raffle-test@example.invalid'), false);
  const soldFive = adminRaffles[0].numbers.find(number => number.number === 5);
  assert.equal(soldFive.customerName, 'Local Test Customer');
  assert.equal(soldFive.orderNumber, 'PTG-RAF-TEST-000001');
  assert.equal(adminRaffles[0].fundsRaisedCents, 4000);
  assert.equal(adminRaffles[0].maximumRevenueCents, 72000);
});

test('raffle emails identify the purchase and escape customer-provided HTML', () => {
  const order = {
    orderNumber: 'PTG-RAF-2026-000001', customerName: '<script>alert(1)</script>', childName: 'Junior',
    customerEmail: 'customer@example.com', customerPhone: '0210000000', raffleName: 'Patagonia FC Tournament Fundraising Prize Drawing',
    prizeName: 'DJI Neo Drone', numbers: [1, 36], ticketPriceCents: 2000, ticketCount: 2,
    subtotalCents: 4000, surchargeCents: 0, surchargeEnabled: false, surchargeLabel: 'Card processing surcharge',
    totalCents: 4000, paymentStatus: 'paid', purchasedAt: '2026-08-31 12:00:00',
    sessionId: 'cs_test_email', paymentIntentId: 'pi_test_email', eventId: 'evt_test_email'
  };
  const business = buildRaffleBusinessEmail(order);
  const customer = buildRaffleCustomerEmail(order);
  assert.match(business.subject, /Prize drawing entry/);
  assert.match(business.text, /PRIZE DRAWING ENTRY/);
  assert.match(customer.text, /Your drawing number\(s\): 01, 36/);
  assert.match(customer.text, /Good luck and thank you for supporting Patagonia FC/);
  assert.doesNotMatch(business.html, /<script>alert/);
  assert.match(business.html, /&lt;script&gt;alert/);
});

test('public page, shop, navigation, admin, SEO and security wiring are present', async () => {
  const [page, shop, main, client, worker, adminHtml, adminJs, sitemap, script] = await Promise.all([
    readFile(new URL('raffle.html', root), 'utf8'), readFile(new URL('shop.html', root), 'utf8'),
    readFile(new URL('js/main.js', root), 'utf8'), readFile(new URL('js/raffle.js', root), 'utf8'),
    readFile(new URL('_worker.js', root), 'utf8'), readFile(new URL('admin/index.html', root), 'utf8'),
    readFile(new URL('admin/admin.js', root), 'utf8'), readFile(new URL('sitemap.xml', root), 'utf8'),
    readFile(new URL('scripts/dev.ps1', root), 'utf8')
  ]);
  assert.match(page, /PATAGONIA FC TOURNAMENT FUNDRAISING PRIZE DRAWING/);
  assert.match(page, /Number reservations are held for 24 hours/);
  assert.match(page, /assets\/images\/dji-neo-prize\.jpg/);
  assert.match(page, /data-raffle-number-grid/);
  assert.match(shop, /raffle\.html/);
  assert.match(main, /renderRaffleShopCard/);
  assert.match(main, /assets\/images\/dji-neo-prize\.jpg/);
  assert.match(main, /Donate on Givealittle/);
  assert.doesNotMatch(main.match(/function renderRaffleShopCard[\s\S]*?\n}/)?.[0] || '', /addToCart/);
  assert.match(client, /REFRESH_INTERVAL = 20000/);
  assert.match(client, /crypto\.randomUUID/);
  assert.match(worker, /verifiedBrowserJsonRequest\(request\)/);
  assert.match(worker, /handleReserveRaffleNumber/);
  assert.match(worker, /Website payment is disabled/);
  assert.match(adminHtml, /data-view-target="raffles"/);
  assert.match(adminJs, /\/api\/admin\/raffles/);
  assert.match(sitemap, /\/raffle/);
  assert.match(script, /seed\\seed-raffle-test\.sql/);
});

test('drawing reservation bypasses website payment, shipping and promotion paths', async () => {
  const worker = await readFile(new URL('_worker.js', root), 'utf8');
  const start = worker.indexOf('async function handleReserveRaffleNumber');
  const end = worker.indexOf('async function handleCreateRaffleCheckout', start);
  const reservationHandler = worker.slice(start, end);
  assert.match(reservationHandler, /reserveRaffleNumbers/);
  assert.match(reservationHandler, /givealittle\.co\.nz/);
  assert.doesNotMatch(reservationHandler, /STRIPE_SECRET_KEY|createStripeCheckoutSession|shipping|promotion/i);
});

test('Givealittle reservation route never processes payment or marks the number sold automatically', async () => {
  {
    const { DB } = await testDatabase();
    const env = { DB, ENVIRONMENT: 'development' };
    const reserveResponse = await worker.fetch(new Request(
      `https://ptg.test/api/raffles/${RAFFLE_SLUG}/reserve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://ptg.test' },
        body: JSON.stringify({
          numbers: [7],
          customerDetails,
          reservationRequestId: 'givealittle-route-test'
        })
      }
    ), env);
    const reserveBody = await reserveResponse.json();
    assert.equal(reserveResponse.status, 200);
    assert.equal(reserveBody.reservation.number, 7);
    assert.equal(reserveBody.reservation.provider, 'Givealittle');
    assert.equal(reserveBody.reservation.url, 'https://givealittle.co.nz/cause/patagonia-fc-tournament-fundraiser-2026');
    assert.match(reserveBody.reservation.donationMessage, /#07/);
    const reserved = await DB.prepare(`SELECT status FROM raffle_numbers WHERE raffle_id = ? AND number = 7`)
      .bind('patagonia-fc-tournament-2026').first();
    assert.equal(reserved.status, 'reserved');

    const duplicateResponse = await worker.fetch(new Request(
      `https://ptg.test/api/raffles/${RAFFLE_SLUG}/reserve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://ptg.test' },
        body: JSON.stringify({ numbers: [7], customerDetails, reservationRequestId: 'second-donor-test' })
      }
    ), env);
    assert.equal(duplicateResponse.status, 409);

    const checkoutResponse = await worker.fetch(new Request(
      `https://ptg.test/api/raffles/${RAFFLE_SLUG}/checkout`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://ptg.test' }, body: '{}' }
    ), env);
    assert.equal(checkoutResponse.status, 410);

    const confirmed = await updateRaffleNumberStatus(env, {
      raffleId: 'patagonia-fc-tournament-2026', number: 7, action: 'confirm'
    });
    assert.equal(confirmed.ok, true);
    assert.equal((await DB.prepare(`SELECT status FROM raffle_numbers WHERE raffle_id = ? AND number = 7`)
      .bind('patagonia-fc-tournament-2026').first()).status, 'sold');
    return;
  }
  const { DB } = await testDatabase();
  const kv = new MemoryKv();
  const stripeSessionId = 'cs_test_raffleintegration1234567890';
  const webhookSecret = 'whsec_local_raffle_test_only';
  const outbound = [];
  let checkoutParams;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    outbound.push({ url, init });
    if (url === 'https://api.stripe.com/v1/checkout/sessions') {
      checkoutParams = new URLSearchParams(init.body);
      return Response.json({ id: stripeSessionId, url: `https://checkout.stripe.com/c/pay/${stripeSessionId}` });
    }
    if (url.includes(`/v1/checkout/sessions/${stripeSessionId}/line_items`)) {
      return Response.json({ data: [{
        amount_total: 4000,
        price: { product: { metadata: { item_kind: 'raffle_ticket' } } }
      }] });
    }
    if (url === 'https://api.resend.com/emails') return Response.json({ id: `email-${outbound.length}` });
    throw new Error(`Unexpected outbound request: ${url}`);
  };

  const env = {
    DB,
    ORDER_EVENT_STORE: kv,
    STRIPE_SECRET_KEY: 'sk_test_not_real',
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    CHECKOUT_ENABLED: 'true',
    SITE_URL: 'https://ptg.test',
    ENVIRONMENT: 'development',
    PAYMENT_SURCHARGE_ENABLED: 'false',
    EMAIL_PROVIDER: 'resend',
    EMAIL_API_KEY: 're_test_not_real',
    CONTACT_TO_EMAIL: 'info@ptgactivewear.co.nz',
    CONTACT_FROM_EMAIL: 'info@ptgactivewear.co.nz'
  };

  try {
    const checkoutResponse = await worker.fetch(new Request(
      `https://ptg.test/api/raffles/${RAFFLE_SLUG}/checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://ptg.test' },
        body: JSON.stringify({
          numbers: [7, 8],
          customerDetails,
          checkoutRequestId: 'route-test-12345'
        })
      }
    ), env);
    const checkoutBody = await checkoutResponse.json();
    assert.equal(checkoutResponse.status, 200);
    assert.equal(checkoutBody.url, `https://checkout.stripe.com/c/pay/${stripeSessionId}`);
    assert.equal(checkoutBody.summary.subtotalCents, 4000);
    assert.equal(checkoutBody.summary.shippingCents, 0);
    assert.equal(checkoutBody.summary.discountCents, 0);
    assert.equal(outbound[0].init.headers['Idempotency-Key'], 'ptg-raffle-route-test-12345');
    assert.equal(checkoutParams.get('line_items[0][price_data][unit_amount]'), '2000');
    assert.equal(checkoutParams.get('line_items[0][quantity]'), '2');
    assert.equal(checkoutParams.has('shipping_address_collection[allowed_countries][0]'), false);
    assert.equal(checkoutParams.has('allow_promotion_codes'), false);

    const metadata = {};
    for (const [key, value] of checkoutParams) {
      const match = key.match(/^metadata\[([^\]]+)\]$/);
      if (match) metadata[match[1]] = value;
    }
    const event = {
      id: 'evt_route_raffle_paid_1',
      type: 'checkout.session.completed',
      data: { object: {
        id: stripeSessionId,
        metadata,
        payment_status: 'paid',
        payment_intent: 'pi_route_raffle_paid_1',
        payment_method_types: ['card'],
        amount_total: 4000,
        currency: 'nzd',
        total_details: { amount_shipping: 0, amount_discount: 0 },
        customer_details: { email: 'supporter@example.com', phone: '0210000000' }
      } }
    };
    const rawEvent = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', webhookSecret).update(`${timestamp}.${rawEvent}`).digest('hex');
    const webhookRequest = () => new Request('https://ptg.test/api/stripe-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${signature}` },
      body: rawEvent
    });
    const webhookResponse = await worker.fetch(webhookRequest(), env);
    assert.equal(webhookResponse.status, 200);
    assert.deepEqual(await webhookResponse.json(), { received: true });
    const order = await DB.prepare('SELECT order_number, ticket_count, total_cents, email_status FROM raffle_orders').first();
    assert.match(order.order_number, /^PTG-RAF-/);
    assert.equal(order.ticket_count, 2);
    assert.equal(order.total_cents, 4000);
    assert.equal(order.email_status, 'sent');
    const numbers = await DB.prepare('SELECT number, status FROM raffle_numbers WHERE number IN (7, 8) ORDER BY number').all();
    assert.deepEqual(numbers.results.map(row => ({ number: row.number, status: row.status })), [
      { number: 7, status: 'sold' },
      { number: 8, status: 'sold' }
    ]);
    assert.equal(outbound.filter(request => request.url === 'https://api.resend.com/emails').length, 2);

    const duplicateResponse = await worker.fetch(webhookRequest(), env);
    assert.equal(duplicateResponse.status, 200);
    assert.equal(outbound.filter(request => request.url === 'https://api.resend.com/emails').length, 2);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS count FROM raffle_orders').first()).count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
