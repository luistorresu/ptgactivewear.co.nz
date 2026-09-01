import { validateCheckoutCustomerDetails } from './customer-details.js';
import { calculatePaymentSurcharge, calculateRefundBreakdown, getPaymentSurchargeConfig } from './surcharge.js';

export const RAFFLE_SLUG = 'patagonia-fc-tournament-fundraising-raffle';
export const RAFFLE_CHECKOUT_MAX_NUMBERS = 40;
export const GIVEALITTLE_URL = 'https://givealittle.co.nz/cause/patagonia-fc-tournament-fundraiser-2026';

const ACTIVE_RESERVATION_STATES = new Set(['reserved', 'session_created', 'payment_pending']);
const RELEASABLE_RESERVATION_STATES = new Set(['preparing', ...ACTIVE_RESERVATION_STATES]);

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normaliseEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function sqlTimestamp(milliseconds) {
  return new Date(milliseconds).toISOString().slice(0, 19).replace('T', ' ');
}

function resultChanges(result) {
  return Number(result?.meta?.changes || 0);
}

function parseNumbersJson(value) {
  try {
    const numbers = JSON.parse(String(value || '[]'));
    return Array.isArray(numbers) ? numbers : [];
  } catch {
    return [];
  }
}

export function normaliseRaffleNumbers(value, totalNumbers = RAFFLE_CHECKOUT_MAX_NUMBERS) {
  if (!Array.isArray(value) || value.length === 0 || value.length > Math.min(totalNumbers, RAFFLE_CHECKOUT_MAX_NUMBERS)) {
    return { error: 'Choose at least one available drawing number.' };
  }

  const numbers = [];
  const seen = new Set();
  for (const rawNumber of value) {
    if (typeof rawNumber !== 'number' || !Number.isInteger(rawNumber) || rawNumber < 1 || rawNumber > totalNumbers) {
      return { error: `Drawing numbers must be whole numbers from 1 to ${totalNumbers}.` };
    }
    if (seen.has(rawNumber)) return { error: 'Each drawing number can only be selected once.' };
    seen.add(rawNumber);
    numbers.push(rawNumber);
  }
  numbers.sort((first, second) => first - second);
  return { numbers };
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function raffleCheckoutFingerprint(raffleId, numbers, customerDetails = {}) {
  return sha256(JSON.stringify({
    raffleId,
    numbers,
    customerName: customerDetails.customerName || '',
    childName: customerDetails.childName || '',
    customerEmail: customerDetails.customerEmail || ''
  }));
}

async function raffleBySlug(db, slug) {
  return db.prepare('SELECT * FROM raffles WHERE slug = ?').bind(slug).first();
}

async function reservationByRequest(db, requestId) {
  return db.prepare('SELECT * FROM raffle_reservations WHERE id = ?').bind(requestId).first();
}

function existingReservationResult(existing, fingerprint, raffle) {
  if (!existing) return null;
  if (existing.request_fingerprint !== fingerprint) {
    return {
      error: 'Your raffle selection changed while checkout was being prepared. Please try again.',
      code: 'RAFFLE_ATTEMPT_CHANGED',
      status: 409
    };
  }
  if (!ACTIVE_RESERVATION_STATES.has(existing.status)) {
    return {
      error: 'This raffle checkout attempt is no longer active. Please choose your number again.',
      code: 'RAFFLE_ATTEMPT_INACTIVE',
      status: 409
    };
  }
  return {
    raffle,
    reservationId: existing.id,
    requestFingerprint: existing.request_fingerprint,
    reservationToken: existing.reservation_token,
    numbers: parseNumbersJson(existing.numbers_json),
    expiresAt: existing.expires_at,
    checkoutUrl: existing.status === 'session_created' ? existing.checkout_url : '',
    reused: true
  };
}

export async function releaseExpiredRaffleReservations(env, limit = 20) {
  if (!env.DB) return 0;
  const result = await env.DB.prepare(`SELECT id FROM raffle_reservations
    WHERE status IN ('reserved', 'session_created') AND expires_at <= CURRENT_TIMESTAMP
    ORDER BY expires_at LIMIT ?`).bind(Math.max(1, Math.min(100, Number(limit) || 20))).all();
  for (const row of result.results || []) {
    await releaseRaffleReservation(env, { reservationId: row.id, reason: 'expired' });
  }
  return (result.results || []).length;
}

export async function getPublicRaffle(env, slug = RAFFLE_SLUG) {
  await releaseExpiredRaffleReservations(env, 20);
  const raffle = await raffleBySlug(env.DB, slug);
  if (!raffle || raffle.status === 'draft') return null;
  const result = await env.DB.prepare(`SELECT number, status FROM raffle_numbers
    WHERE raffle_id = ? ORDER BY number`).bind(raffle.id).all();
  const numbers = (result.results || []).map(row => ({ number: Number(row.number), status: row.status }));
  const soldCount = numbers.filter(number => number.status === 'sold').length;
  const reservedCount = numbers.filter(number => number.status === 'reserved').length;
  return {
    id: raffle.id,
    slug: raffle.slug,
    name: raffle.name,
    description: raffle.description,
    prize: raffle.prize_name,
    ticketPriceCents: Number(raffle.ticket_price_cents),
    totalNumbers: Number(raffle.total_numbers),
    currency: raffle.currency,
    status: raffle.status,
    reservationMinutes: Number(raffle.reservation_minutes),
    termsStatus: raffle.terms_status,
    soldCount,
    reservedCount,
    soldOut: soldCount >= Number(raffle.total_numbers),
    numbers
  };
}

export async function reserveRaffleNumbers(env, {
  slug = RAFFLE_SLUG,
  numbers: rawNumbers,
  requestId,
  customerDetails,
  now = Date.now()
}) {
  const raffle = await raffleBySlug(env.DB, slug);
  if (!raffle || raffle.status !== 'active') {
    return { error: 'This prize drawing is not currently accepting entries.', status: 409, code: 'RAFFLE_INACTIVE' };
  }
  const normalised = normaliseRaffleNumbers(rawNumbers, Number(raffle.total_numbers));
  if (normalised.error) return { ...normalised, status: 400, code: 'INVALID_RAFFLE_NUMBERS' };
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(requestId || ''))) {
    return { error: 'A fresh checkout reference is required. Please try again.', status: 400, code: 'INVALID_RAFFLE_REQUEST' };
  }
  const customer = validateCheckoutCustomerDetails(customerDetails, { required: true });
  if (customer.error) return { error: customer.error, status: 400, code: 'INVALID_CUSTOMER_DETAILS' };
  const customerEmail = normaliseEmail(customerDetails?.customerEmail);
  if (!customerEmail) return { error: 'Enter a valid email address.', status: 400, code: 'INVALID_CUSTOMER_EMAIL' };
  customer.customerEmail = customerEmail;
  const fingerprint = await raffleCheckoutFingerprint(raffle.id, normalised.numbers, customer);
  const existing = await reservationByRequest(env.DB, requestId);
  const existingResult = existingReservationResult(existing, fingerprint, raffle);
  if (existingResult) return existingResult;

  const reservationMinutes = Math.max(30, Number(raffle.reservation_minutes || 1440));
  const expiresAt = sqlTimestamp(now + reservationMinutes * 60 * 1000);
  const reservationToken = crypto.randomUUID();
  const numbersJson = JSON.stringify(normalised.numbers);
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO raffle_reservations (
    id, raffle_id, request_fingerprint, reservation_token, numbers_json,
    ticket_count, status, expires_at, customer_name, child_name, customer_email,
    external_provider, external_url
  ) VALUES (?, ?, ?, ?, ?, ?, 'preparing', ?, ?, ?, ?, 'givealittle', ?)`)
    .bind(requestId, raffle.id, fingerprint, reservationToken, numbersJson, normalised.numbers.length,
      expiresAt, customer.customerName, customer.childName, customer.customerEmail, GIVEALITTLE_URL).run();

  if (!resultChanges(claim)) {
    return existingReservationResult(await reservationByRequest(env.DB, requestId), fingerprint, raffle)
      || { error: 'Raffle checkout is already being prepared. Please try again.', status: 409, code: 'RAFFLE_ATTEMPT_BUSY' };
  }

  const placeholders = normalised.numbers.map(() => '?').join(', ');
  let reservedRows;
  try {
    reservedRows = await env.DB.prepare(`UPDATE raffle_numbers SET
      status = 'reserved', reservation_token = ?, reserved_at = CURRENT_TIMESTAMP,
      reservation_expires_at = ?, stripe_checkout_session_id = NULL,
      raffle_order_id = NULL, sold_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE raffle_id = ? AND number IN (${placeholders})
        AND (
          status = 'available'
          OR (
            status = 'reserved' AND reservation_expires_at <= CURRENT_TIMESTAMP
            AND NOT EXISTS (
              SELECT 1 FROM raffle_reservations active_reservation
              WHERE active_reservation.reservation_token = raffle_numbers.reservation_token
                AND active_reservation.status = 'payment_pending'
            )
          )
        )
      RETURNING number`)
      .bind(reservationToken, expiresAt, raffle.id, ...normalised.numbers).all();
  } catch (error) {
    await env.DB.prepare(`UPDATE raffle_reservations SET status = 'failed', release_reason = 'database_error',
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'preparing'`).bind(requestId).run().catch(() => {});
    throw error;
  }

  const reserved = new Set((reservedRows.results || []).map(row => Number(row.number)));
  if (reserved.size !== normalised.numbers.length) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE raffle_numbers SET status = 'available', reservation_token = NULL,
        reserved_at = NULL, reservation_expires_at = NULL, stripe_checkout_session_id = NULL,
        updated_at = CURRENT_TIMESTAMP
        WHERE raffle_id = ? AND reservation_token = ? AND status = 'reserved'`).bind(raffle.id, reservationToken),
      env.DB.prepare(`UPDATE raffle_reservations SET status = 'failed', release_reason = 'number_unavailable',
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'preparing'`).bind(requestId)
    ]);
    const unavailable = normalised.numbers.find(number => !reserved.has(number));
    return {
      error: `Sorry, number ${unavailable} has just been selected by someone else. Please choose another available number.`,
      status: 409,
      code: 'RAFFLE_NUMBER_UNAVAILABLE',
      unavailableNumber: unavailable
    };
  }

  const activated = await env.DB.prepare(`UPDATE raffle_reservations SET status = 'reserved',
    updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'preparing'`).bind(requestId).run();
  if (!resultChanges(activated)) {
    await releaseRaffleReservation(env, { reservationId: requestId, reason: 'activation_failed' });
    throw new Error('Raffle reservation could not be activated.');
  }

  return {
    raffle,
    reservationId: requestId,
    requestFingerprint: fingerprint,
    reservationToken,
    numbers: normalised.numbers,
    expiresAt,
    checkoutUrl: '',
    reused: false,
    customerDetails: customer
  };
}

export async function attachRaffleCheckoutSession(db, reservation, session) {
  const results = await db.batch([
    db.prepare(`UPDATE raffle_reservations SET status = 'session_created',
      stripe_checkout_session_id = ?, checkout_url = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND request_fingerprint = ? AND reservation_token = ?
        AND status IN ('reserved', 'session_created')`)
      .bind(session.id, cleanText(session.url, 1000), reservation.reservationId,
        reservation.requestFingerprint, reservation.reservationToken),
    db.prepare(`UPDATE raffle_numbers SET stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE raffle_id = ? AND reservation_token = ? AND status = 'reserved'`)
      .bind(session.id, reservation.raffle.id, reservation.reservationToken)
  ]);
  if (!resultChanges(results[0]) || resultChanges(results[1]) !== reservation.numbers.length) {
    throw new Error('Raffle reservation could not be linked to Stripe.');
  }
}

export async function markRaffleReservationPaymentPending(db, session) {
  const requestId = cleanText(session.metadata?.raffle_request_id, 64);
  const sessionId = cleanText(session.id, 255);
  if (!requestId && !sessionId) return { marked: false };
  const result = await db.prepare(`UPDATE raffle_reservations SET status = 'payment_pending',
    stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, ?), updated_at = CURRENT_TIMESTAMP
    WHERE (stripe_checkout_session_id = ? OR (? != '' AND id = ?))
      AND status IN ('reserved', 'session_created', 'payment_pending')`)
    .bind(sessionId || null, sessionId, requestId, requestId).run();
  return { marked: Boolean(resultChanges(result)) };
}

export async function releaseRaffleReservation(env, { reservationId = '', sessionId = '', reason = 'released' }) {
  const reservation = reservationId
    ? await reservationByRequest(env.DB, reservationId)
    : await env.DB.prepare('SELECT * FROM raffle_reservations WHERE stripe_checkout_session_id = ?').bind(sessionId).first();
  if (!reservation || !RELEASABLE_RESERVATION_STATES.has(reservation.status)) return { released: false };
  const finalStatus = reason === 'expired' ? 'expired' : 'released';
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE raffle_numbers SET status = 'available', reservation_token = NULL,
      reserved_at = NULL, reservation_expires_at = NULL, stripe_checkout_session_id = NULL,
      updated_at = CURRENT_TIMESTAMP
      WHERE raffle_id = ? AND reservation_token = ? AND status = 'reserved'`)
      .bind(reservation.raffle_id, reservation.reservation_token),
    env.DB.prepare(`UPDATE raffle_reservations SET status = ?, release_reason = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?
      AND status IN ('preparing', 'reserved', 'session_created', 'payment_pending')`)
      .bind(finalStatus, cleanText(reason, 120), reservation.id)
  ]);
  return { released: Boolean(resultChanges(results[1])), releasedNumbers: resultChanges(results[0]) };
}

function metadataInteger(metadata, key) {
  const value = String(metadata?.[key] ?? '');
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function lineKind(lineItem) {
  return String(lineItem?.price?.product?.metadata?.item_kind || '');
}

function lineTotal(lineItems, kind) {
  return lineItems.filter(item => lineKind(item) === kind)
    .reduce((sum, item) => sum + Number(item.amount_total || 0), 0);
}

export function verifyRaffleStripeSnapshot(session, lineItems) {
  const metadata = session.metadata || {};
  if (metadata.order_type !== 'raffle') throw new Error('Stripe session is not a raffle checkout.');
  const ticketPriceCents = metadataInteger(metadata, 'raffle_ticket_price_cents');
  const ticketCount = metadataInteger(metadata, 'raffle_ticket_count');
  const subtotalCents = metadataInteger(metadata, 'raffle_subtotal_cents');
  const surchargeCents = metadataInteger(metadata, 'payment_surcharge_cents');
  const totalCents = metadataInteger(metadata, 'total_cents');
  const numbers = normaliseRaffleNumbers(String(metadata.raffle_numbers || '').split(',').filter(Boolean).map(Number), 10000);
  if (numbers.error || !ticketPriceCents || !ticketCount || ticketCount !== numbers.numbers.length) {
    throw new Error('Stripe raffle ticket metadata is invalid.');
  }
  if (subtotalCents !== ticketPriceCents * ticketCount) throw new Error('Stripe raffle subtotal does not match the tickets.');
  if (lineTotal(lineItems, 'raffle_ticket') !== subtotalCents) throw new Error('Stripe raffle line items do not match the subtotal.');
  if (lineTotal(lineItems, 'payment_surcharge') !== surchargeCents) throw new Error('Stripe raffle surcharge does not match.');
  if (totalCents !== subtotalCents + surchargeCents || Number(session.amount_total) !== totalCents) {
    throw new Error('Stripe raffle paid total does not match.');
  }
  if (Number(session.total_details?.amount_shipping || 0) !== 0 || Number(session.total_details?.amount_discount || 0) !== 0) {
    throw new Error('Raffle checkout must not include shipping or discounts.');
  }
  if (String(session.currency || '').toLowerCase() !== 'nzd') throw new Error('Raffle checkout currency must be NZD.');
  return {
    raffleId: cleanText(metadata.raffle_id, 120),
    reservationToken: cleanText(metadata.raffle_reservation_token, 100),
    requestId: cleanText(metadata.raffle_request_id, 64),
    numbers: numbers.numbers,
    numbersJson: JSON.stringify(numbers.numbers),
    ticketPriceCents,
    ticketCount,
    subtotalCents,
    surchargeCents,
    totalCents,
    surchargeEnabled: metadata.payment_surcharge_enabled === '1',
    surchargePercent: cleanText(metadata.payment_surcharge_percent, 12) || '0',
    surchargeFixedCents: metadataInteger(metadata, 'payment_surcharge_fixed_cents') || 0,
    surchargeLabel: cleanText(metadata.payment_surcharge_label, 80) || 'Card processing surcharge'
  };
}

export function raffleCheckoutTotals(raffle, ticketCount, env) {
  if (!Number.isSafeInteger(ticketCount) || ticketCount < 1 || ticketCount > Number(raffle.total_numbers)) {
    throw new Error('Raffle ticket quantity is invalid.');
  }
  const subtotalCents = Number(raffle.ticket_price_cents) * ticketCount;
  const surcharge = getPaymentSurchargeConfig(env);
  const paymentSurchargeCents = calculatePaymentSurcharge(subtotalCents, surcharge);
  return {
    currency: raffle.currency,
    ticketPriceCents: Number(raffle.ticket_price_cents),
    ticketCount,
    subtotalCents,
    paymentSurchargeCents,
    totalCents: subtotalCents + paymentSurchargeCents,
    surcharge
  };
}

async function existingRaffleOrder(db, sessionId) {
  return db.prepare('SELECT id, email_status FROM raffle_orders WHERE stripe_checkout_session_id = ?').bind(sessionId).first();
}

export async function commitPaidRaffleOrder(env, event, session, lineItems) {
  const existing = await existingRaffleOrder(env.DB, session.id);
  if (existing) return { orderId: existing.id, duplicate: true, emailStatus: existing.email_status };
  const snapshot = verifyRaffleStripeSnapshot(session, lineItems);
  const reservation = await env.DB.prepare(`SELECT rr.*, r.name AS raffle_name, r.prize_name,
      r.ticket_price_cents, r.currency
    FROM raffle_reservations rr JOIN raffles r ON r.id = rr.raffle_id
    WHERE rr.raffle_id = ? AND rr.reservation_token = ?
      AND (rr.stripe_checkout_session_id = ? OR (? != '' AND rr.id = ?)) LIMIT 1`)
    .bind(snapshot.raffleId, snapshot.reservationToken, session.id, snapshot.requestId, snapshot.requestId).first();
  if (!reservation || !ACTIVE_RESERVATION_STATES.has(reservation.status)) {
    throw new Error('Paid raffle reservation is missing or inactive.');
  }
  if (reservation.numbers_json !== snapshot.numbersJson
    || Number(reservation.ticket_count) !== snapshot.ticketCount
    || Number(reservation.ticket_price_cents) !== snapshot.ticketPriceCents
    || String(reservation.currency).toUpperCase() !== 'NZD') {
    throw new Error('Paid raffle reservation does not match its authoritative raffle snapshot.');
  }
  const checkoutDetails = validateCheckoutCustomerDetails({
    customerName: session.metadata?.checkout_customer_name,
    childName: session.metadata?.child_name
  }, { required: true });
  if (checkoutDetails.error) throw new Error('Paid raffle customer details are invalid.');
  const customer = session.customer_details || {};
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || null;

  try {
    await env.DB.prepare(`INSERT INTO raffle_orders (
      raffle_id, raffle_name, prize_name, ticket_price_cents, ticket_count,
      numbers_json, reservation_token, stripe_checkout_session_id,
      stripe_payment_intent_id, stripe_event_id, customer_name, child_name,
      customer_email, customer_phone, subtotal_cents, payment_surcharge_cents,
      payment_surcharge_enabled, payment_surcharge_percent,
      payment_surcharge_fixed_cents, payment_surcharge_label, total_cents,
      currency, payment_status, payment_method_label
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        snapshot.raffleId, reservation.raffle_name, reservation.prize_name,
        snapshot.ticketPriceCents, snapshot.ticketCount, snapshot.numbersJson,
        snapshot.reservationToken, session.id, paymentIntentId, event.id,
        checkoutDetails.customerName, checkoutDetails.childName,
        cleanText(customer.email || session.customer_email, 254),
        cleanText(customer.phone, 50), snapshot.subtotalCents, snapshot.surchargeCents,
        snapshot.surchargeEnabled ? 1 : 0, snapshot.surchargePercent,
        snapshot.surchargeFixedCents, snapshot.surchargeLabel, snapshot.totalCents,
        'NZD', cleanText(session.payment_status || 'paid', 30),
        cleanText(Array.isArray(session.payment_method_types) ? session.payment_method_types.join(', ') : '', 100)
      ).run();
  } catch (error) {
    const duplicate = await existingRaffleOrder(env.DB, session.id);
    if (duplicate) return { orderId: duplicate.id, duplicate: true, emailStatus: duplicate.email_status };
    throw error;
  }

  const order = await existingRaffleOrder(env.DB, session.id);
  await env.DB.batch([
    env.DB.prepare(`UPDATE raffle_orders SET order_number = printf('PTG-RAF-%s-%06d',
      strftime('%Y', created_at), id), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND order_number IS NULL`).bind(order.id),
    env.DB.prepare(`INSERT OR IGNORE INTO stripe_events (
      event_id, event_type, stripe_checkout_session_id, status, processed_at
    ) VALUES (?, ?, ?, 'inventory_committed', CURRENT_TIMESTAMP)`).bind(event.id, event.type, session.id)
  ]);
  return { orderId: order.id, duplicate: false, emailStatus: order.email_status };
}

export async function markRaffleOrderEmailResult(env, orderId, eventId, sent, errorMessage = '') {
  await env.DB.batch([
    env.DB.prepare(`UPDATE raffle_orders SET email_status = ?, email_attempts = email_attempts + 1,
      email_sent_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE email_sent_at END,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(sent ? 'sent' : 'failed', sent ? 1 : 0, orderId),
    env.DB.prepare(`UPDATE stripe_events SET status = ?, last_error = ?, processed_at = CURRENT_TIMESTAMP
      WHERE event_id = ?`).bind(sent ? 'processed' : 'email_failed', cleanText(errorMessage, 500), eventId)
  ]);
}

export async function recordRaffleRefund(env, event, charge) {
  const paymentIntentId = typeof charge?.payment_intent === 'string'
    ? charge.payment_intent
    : charge?.payment_intent?.id;
  if (!paymentIntentId) return { matched: false };
  const order = await env.DB.prepare(`SELECT id, stripe_checkout_session_id, total_cents,
    payment_surcharge_cents FROM raffle_orders WHERE stripe_payment_intent_id = ?`).bind(paymentIntentId).first();
  if (!order) return { matched: false };
  const refund = calculateRefundBreakdown(
    Number(order.total_cents),
    Number(order.payment_surcharge_cents),
    Number(charge.amount_refunded || 0),
    0
  );
  await env.DB.batch([
    env.DB.prepare(`UPDATE raffle_orders SET refunded_cents = ?, refund_status = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(refund.refundedCents, refund.refundStatus, order.id),
    env.DB.prepare(`INSERT OR IGNORE INTO stripe_events (
      event_id, event_type, stripe_checkout_session_id, status, processed_at
    ) VALUES (?, ?, ?, 'processed', CURRENT_TIMESTAMP)`)
      .bind(event.id, event.type, order.stripe_checkout_session_id)
  ]);
  return { matched: true, orderId: order.id, ...refund };
}

export async function getRaffleOrderStatus(db, sessionId) {
  return db.prepare(`SELECT order_number, payment_status FROM raffle_orders
    WHERE stripe_checkout_session_id = ?`).bind(sessionId).first();
}

export async function getRaffleOrderEmailData(db, sessionId, eventId = '') {
  const row = await db.prepare('SELECT * FROM raffle_orders WHERE stripe_checkout_session_id = ?').bind(sessionId).first();
  if (!row) throw new Error('Raffle order is missing.');
  return {
    id: Number(row.id),
    orderNumber: row.order_number || 'PTG raffle order pending',
    raffleName: row.raffle_name,
    prizeName: row.prize_name,
    numbers: parseNumbersJson(row.numbers_json),
    ticketPriceCents: Number(row.ticket_price_cents),
    ticketCount: Number(row.ticket_count),
    customerName: row.customer_name,
    childName: row.child_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    subtotalCents: Number(row.subtotal_cents),
    surchargeCents: Number(row.payment_surcharge_cents),
    surchargeEnabled: Boolean(row.payment_surcharge_enabled),
    surchargeLabel: row.payment_surcharge_label,
    totalCents: Number(row.total_cents),
    paymentStatus: row.payment_status,
    purchasedAt: row.purchased_at,
    sessionId: row.stripe_checkout_session_id,
    paymentIntentId: row.stripe_payment_intent_id || '',
    eventId: eventId || row.stripe_event_id,
    currency: row.currency
  };
}

function money(cents) {
  return `NZD $${(Number(cents || 0) / 100).toFixed(2)}`;
}

export function buildRaffleBusinessEmail(order) {
  const numberList = order.numbers.map(number => String(number).padStart(2, '0')).join(', ');
  const surchargeLine = order.surchargeEnabled
    ? `\n${order.surchargeLabel}: ${money(order.surchargeCents)}`
    : '';
  const text = [
    'PRIZE DRAWING ENTRY', '',
    `Order number: ${order.orderNumber}`,
    `Customer name: ${order.customerName}`,
    `Child's Name: ${order.childName || 'Not provided'}`,
    `Customer email: ${order.customerEmail}`,
    `Phone: ${order.customerPhone || 'Not provided'}`,
    `Prize drawing: ${order.raffleName}`,
    `Drawing number(s): ${numberList}`,
    `Entry price: ${money(order.ticketPriceCents)} per number`,
    `Drawing subtotal: ${money(order.subtotalCents)}${surchargeLine}`,
    `Total paid: ${money(order.totalCents)}`,
    `Payment status: ${order.paymentStatus}`,
    `Purchase time: ${order.purchasedAt}`,
    '', 'Internal Payment References',
    `Checkout Session: ${order.sessionId}`,
    `Payment Intent: ${order.paymentIntentId || 'Not provided'}`,
    `Stripe Event: ${order.eventId || 'Not provided'}`
  ].join('\n');
  const html = `
    <h2>PRIZE DRAWING ENTRY</h2>
    <p style="font-size:20px"><strong>Order number:</strong> ${escapeHtml(order.orderNumber)}</p>
    <p><strong>Customer:</strong> ${escapeHtml(order.customerName)}<br>
    <strong>Child's Name:</strong> ${escapeHtml(order.childName || 'Not provided')}<br>
    <strong>Email:</strong> ${escapeHtml(order.customerEmail)}<br>
    <strong>Phone:</strong> ${escapeHtml(order.customerPhone || 'Not provided')}</p>
    <p><strong>Prize drawing:</strong> ${escapeHtml(order.raffleName)}<br>
    <strong>Drawing number(s):</strong> ${escapeHtml(numberList)}<br>
    <strong>Entry price:</strong> ${escapeHtml(money(order.ticketPriceCents))} per number<br>
    <strong>Drawing subtotal:</strong> ${escapeHtml(money(order.subtotalCents))}${order.surchargeEnabled ? `<br><strong>${escapeHtml(order.surchargeLabel)}:</strong> ${escapeHtml(money(order.surchargeCents))}` : ''}<br>
    <strong>Total paid:</strong> ${escapeHtml(money(order.totalCents))}</p>
    <p><strong>Payment status:</strong> ${escapeHtml(order.paymentStatus)}<br>
    <strong>Purchase time:</strong> ${escapeHtml(order.purchasedAt)}</p>
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #ddd;color:#555;font-size:12px">
      <h3>Internal Payment References</h3>
      <p>Checkout Session: ${escapeHtml(order.sessionId)}<br>Payment Intent: ${escapeHtml(order.paymentIntentId || 'Not provided')}<br>Stripe Event: ${escapeHtml(order.eventId || 'Not provided')}</p>
    </div>`;
  return { subject: `Prize drawing entry ${order.orderNumber}`, text, html };
}

export function buildRaffleCustomerEmail(order) {
  const numberList = order.numbers.map(number => String(number).padStart(2, '0')).join(', ');
  const text = [
    `Thank you for supporting Patagonia FC${order.customerName ? `, ${order.customerName}` : ''}!`, '',
    'PATAGONIA FC FUNDRAISING PRIZE DRAWING', '',
    `Your drawing number(s): ${numberList}`,
    `Entry price: ${money(order.ticketPriceCents)} per number`,
    `Prize drawing: ${order.raffleName}`,
    `Big Prize: ${order.prizeName}`,
    `Order number: ${order.orderNumber}`,
    `Total paid: ${money(order.totalCents)}`,
    '', 'Good luck and thank you for supporting Patagonia FC!',
    'Support: info@ptgactivewear.co.nz'
  ].join('\n');
  const html = `
    <h2>Thank you for supporting Patagonia FC!</h2>
    <p><strong>PATAGONIA FC FUNDRAISING PRIZE DRAWING</strong></p>
    <p style="font-size:18px"><strong>Your drawing number(s):</strong><br>${escapeHtml(numberList)}</p>
    <p><strong>Entry price:</strong> ${escapeHtml(money(order.ticketPriceCents))} per number<br>
    <strong>Prize drawing:</strong> ${escapeHtml(order.raffleName)}<br>
    <strong>Big Prize:</strong> ${escapeHtml(order.prizeName)}<br>
    <strong>Order number:</strong> ${escapeHtml(order.orderNumber)}<br>
    <strong>Total paid:</strong> ${escapeHtml(money(order.totalCents))}</p>
    <p>Good luck and thank you for supporting Patagonia FC!</p>
    <p>Questions? Contact <a href="mailto:info@ptgactivewear.co.nz">info@ptgactivewear.co.nz</a>.</p>`;
  return { subject: `Your Patagonia FC drawing numbers ${order.orderNumber}`, text, html };
}

export async function getAdminRaffles(db) {
  const rafflesResult = await db.prepare(`SELECT r.*,
      SUM(CASE WHEN rn.status = 'available' THEN 1 ELSE 0 END) AS available_count,
      SUM(CASE WHEN rn.status = 'reserved' THEN 1 ELSE 0 END) AS reserved_count,
      SUM(CASE WHEN rn.status = 'sold' THEN 1 ELSE 0 END) AS sold_count,
      SUM(CASE WHEN rn.status = 'sold' THEN r.ticket_price_cents ELSE 0 END) AS funds_raised_cents
    FROM raffles r LEFT JOIN raffle_numbers rn ON rn.raffle_id = r.id
    GROUP BY r.id ORDER BY r.created_at DESC`).all();
  const raffles = [];
  for (const raffle of rafflesResult.results || []) {
    const numberResult = await db.prepare(`SELECT rn.number, rn.status, rn.reservation_expires_at,
        rn.sold_at, ro.order_number,
        COALESCE(ro.customer_name, rr.customer_name, '') AS customer_name,
        COALESCE(ro.child_name, rr.child_name, '') AS child_name,
        COALESCE(ro.customer_email, rr.customer_email, '') AS customer_email,
        COALESCE(ro.purchased_at, rr.created_at, '') AS purchased_at,
        rr.id AS reservation_id, rr.external_provider
      FROM raffle_numbers rn
      LEFT JOIN raffle_orders ro ON ro.id = rn.raffle_order_id
      LEFT JOIN raffle_reservations rr ON rr.reservation_token = rn.reservation_token
      WHERE rn.raffle_id = ? ORDER BY rn.number`).bind(raffle.id).all();
    raffles.push({
      id: raffle.id,
      slug: raffle.slug,
      name: raffle.name,
      prize: raffle.prize_name,
      ticketPriceCents: Number(raffle.ticket_price_cents),
      totalNumbers: Number(raffle.total_numbers),
      status: raffle.status,
      termsStatus: raffle.terms_status,
      availableCount: Number(raffle.available_count || 0),
      reservedCount: Number(raffle.reserved_count || 0),
      soldCount: Number(raffle.sold_count || 0),
      fundsRaisedCents: Number(raffle.funds_raised_cents || 0),
      maximumRevenueCents: Number(raffle.ticket_price_cents) * Number(raffle.total_numbers),
      numbers: (numberResult.results || []).map(number => ({
        number: Number(number.number),
        status: number.status,
        reservationExpiresAt: number.reservation_expires_at || '',
        soldAt: number.sold_at || '',
        orderNumber: number.order_number || '',
        customerName: number.customer_name || '',
        childName: number.child_name || '',
        customerEmail: number.customer_email || '',
        purchasedAt: number.purchased_at || '',
        reservationId: number.reservation_id || '',
        externalProvider: number.external_provider || ''
      }))
    });
  }
  return raffles;
}

export async function updateRaffleNumberStatus(env, { raffleId, number, action }) {
  const safeRaffleId = cleanText(raffleId, 120);
  const safeNumber = Number(number);
  if (!safeRaffleId || !Number.isInteger(safeNumber) || safeNumber < 1) {
    return { error: 'Drawing number is invalid.', status: 400 };
  }
  const current = await env.DB.prepare(`SELECT rn.*, rr.id AS reservation_id, rr.customer_name,
      rr.customer_email, rr.status AS reservation_status
    FROM raffle_numbers rn
    LEFT JOIN raffle_reservations rr ON rr.reservation_token = rn.reservation_token
    WHERE rn.raffle_id = ? AND rn.number = ?`).bind(safeRaffleId, safeNumber).first();
  if (!current) return { error: 'Drawing number was not found.', status: 404 };
  if (action === 'release') {
    if (current.status !== 'reserved' || !current.reservation_id) {
      return { error: 'Only a reserved number can be released.', status: 409 };
    }
    const released = await releaseRaffleReservation(env, {
      reservationId: current.reservation_id,
      reason: 'admin_released'
    });
    return released.released
      ? { ok: true, action, number: safeNumber }
      : { error: 'The reservation changed before it could be released.', status: 409 };
  }
  if (action === 'confirm') {
    if (current.status !== 'reserved' || current.reservation_status !== 'reserved' || !current.reservation_token) {
      return { error: 'Only an active reserved number can be confirmed.', status: 409 };
    }
    const [confirmed, committed] = await env.DB.batch([
      env.DB.prepare(`UPDATE raffle_numbers SET status = 'sold',
        reservation_expires_at = NULL, sold_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE raffle_id = ? AND number = ? AND status = 'reserved' AND reservation_token = ?
        RETURNING number`).bind(safeRaffleId, safeNumber, current.reservation_token),
      env.DB.prepare(`UPDATE raffle_reservations SET status = 'committed', updated_at = CURRENT_TIMESTAMP
        WHERE reservation_token = ? AND raffle_id = ? AND status = 'reserved'
        RETURNING id`).bind(current.reservation_token, safeRaffleId)
    ]);
    const numberChanged = resultChanges(confirmed) || (confirmed.results || []).length;
    const reservationChanged = resultChanges(committed) || (committed.results || []).length;
    return numberChanged && reservationChanged
      ? { ok: true, action, number: safeNumber }
      : { error: 'The reservation changed before it could be confirmed.', status: 409 };
  }
  return { error: 'Drawing action is invalid.', status: 400 };
}
