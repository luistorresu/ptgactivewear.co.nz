import { calculateRefundBreakdown } from './surcharge.js';
import { ensureInvoiceSnapshot } from './invoices.js';
import { validateCheckoutCustomerDetails } from './customer-details.js';
import {
  RESTRICTED_SHIRT_NUMBERS,
  TRAINING_KIT_ID,
  restrictedShirtNumberError,
  trainingKitPlayerNameIsValid,
  trainingKitShirtNumberIsValid,
  verifyTrainingKitEligibilityProof
} from './shirt-number.js';

const MAX_ITEM_QUANTITY = 20;
const ACTIVE_RESERVATION_STATES = new Set(['reserved', 'session_created', 'payment_pending']);

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function playerNameIsValid(value) {
  return !value || /^[A-Za-z0-9 .'-]{1,20}$/.test(value);
}

function playerNumberIsValid(value) {
  return !value || /^(?:0|00|[1-9][0-9]?)$/.test(value);
}

export async function validateD1CheckoutPayload(payload, env) {
  if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
    return { error: 'Your cart is empty.' };
  }
  if (payload.items.length > 30) return { error: 'Too many cart items.' };

  const checkedItems = [];
  const threshold = Math.max(0, Number(env.LOW_STOCK_THRESHOLD || 5));

  for (const rawItem of payload.items) {
    const productId = cleanText(rawItem?.productId || rawItem?.id, 120).toLowerCase();
    const variantId = Number(rawItem?.variantId);
    const quantity = Number(rawItem?.quantity || rawItem?.qty);
    const playerName = cleanText(rawItem?.personalisation?.name || rawItem?.playerName, 20);
    const playerNumber = cleanText(rawItem?.personalisation?.number || rawItem?.playerNumber, 2);
    const shirtNumberEligibilityToken = cleanText(rawItem?.shirtNumberEligibilityToken, 1000);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
      return { error: 'A cart item has an invalid quantity.' };
    }
    if (!Number.isInteger(variantId) || variantId < 1) {
      return { error: 'Please refresh the shop and choose an available product option.' };
    }

    const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first();
    if (!product || product.archived || !product.active || !product.available_for_sale) {
      return { error: 'One of the products in your cart is no longer available.' };
    }
    const variant = await env.DB.prepare('SELECT * FROM product_variants WHERE id = ? AND product_id = ?').bind(variantId, productId).first();
    if (!variant || !variant.active) return { error: `${product.name} option is no longer available.` };
    if (product.track_inventory && variant.stock_quantity < quantity) {
      return { error: `There is not enough stock available for ${product.name} (${[variant.size, variant.colour, variant.style].filter(Boolean).join(' / ')}).` };
    }
    if (product.track_inventory && variant.stock_quantity <= 0) {
      return { error: `${product.name} is out of stock.` };
    }
    const allowPlayerName = variant.allow_player_name === null || variant.allow_player_name === undefined
      ? Boolean(product.allow_player_name)
      : Boolean(variant.allow_player_name);
    const allowPlayerNumber = variant.allow_player_number === null || variant.allow_player_number === undefined
      ? Boolean(product.allow_player_number)
      : Boolean(variant.allow_player_number);
    if (!allowPlayerName && playerName) return { error: `${product.name} ${variant.style || 'option'} does not support player names.` };
    if (!allowPlayerNumber && playerNumber) return { error: `${product.name} ${variant.style || 'option'} does not support player numbers.` };
    if (productId === TRAINING_KIT_ID) {
      if (!trainingKitPlayerNameIsValid(playerName)) return { error: 'Player Name may contain letters, spaces, hyphens, and apostrophes only.' };
      if (!trainingKitShirtNumberIsValid(playerNumber)) return { error: 'Please enter a whole Shirt Number from 1 to 99.' };
      if (RESTRICTED_SHIRT_NUMBERS.has(playerNumber)
        && !await verifyTrainingKitEligibilityProof(shirtNumberEligibilityToken, playerNumber, env)) {
        return { error: restrictedShirtNumberError(playerNumber) };
      }
    } else {
      if (!playerNameIsValid(playerName)) return { error: `The player name for ${product.name} contains unsupported characters.` };
      if (!playerNumberIsValid(playerNumber)) return { error: `Please enter a player number from 0 to 99 for ${product.name}.` };
    }

    const nameAddOn = allowPlayerName && playerName
      ? product.player_name_price_cents
      : 0;
    const numberAddOn = allowPlayerNumber && playerNumber
      ? product.player_number_price_cents
      : 0;
    checkedItems.push({
      productId,
      variantId,
      quantity,
      size: variant.size,
      variant: [variant.colour, variant.style].filter(Boolean).join(' / '),
      playerName,
      playerNumber,
      restrictedNumberEligibilityVerified: productId === TRAINING_KIT_ID && RESTRICTED_SHIRT_NUMBERS.has(playerNumber),
      nameAddOn,
      numberAddOn,
      cartItemKey: `${productId}:${variantId}:${checkedItems.length + 1}`,
      product: {
        id: product.id,
        name: product.name,
        unitAmountNzdCents: product.price_cents,
        personalisable: allowPlayerName || allowPlayerNumber
      },
      sku: variant.sku,
      trackInventory: Boolean(product.track_inventory),
      stockStatus: product.track_inventory && variant.stock_quantity <= threshold ? 'low_stock' : 'in_stock'
    });
  }

  return { items: checkedItems };
}

function reservationItems(items) {
  const grouped = new Map();
  for (const item of items) {
    if (!item.trackInventory) continue;
    const variantId = Number(item.variantId);
    grouped.set(variantId, (grouped.get(variantId) || 0) + Number(item.quantity));
  }
  return [...grouped.entries()].map(([variantId, quantity]) => ({ variantId, quantity }));
}

function canonicalCheckoutSnapshot(items, summary, fulfilment, customerDetails = {}) {
  return JSON.stringify({
    items: items.map(item => ({
      productId: item.productId,
      variantId: Number(item.variantId),
      quantity: Number(item.quantity),
      playerName: item.playerName,
      playerNumber: item.playerNumber,
      nameAddOn: Number(item.nameAddOn),
      numberAddOn: Number(item.numberAddOn)
    })),
    fulfilmentType: fulfilment.type,
    customerName: customerDetails.customerName || '',
    childName: customerDetails.childName || '',
    shippingCents: Number(summary.shippingCents),
    totalCents: Number(summary.totalCents)
  });
}

export async function checkoutReservationFingerprint(items, summary, fulfilment, customerDetails = {}) {
  const bytes = new TextEncoder().encode(canonicalCheckoutSnapshot(items, summary, fulfilment, customerDetails));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function checkoutReservation(db, reservationId) {
  return db.prepare('SELECT * FROM checkout_inventory_reservations WHERE id = ?').bind(reservationId).first();
}

async function reservationResult(db, reservationId, fingerprint) {
  const existing = await checkoutReservation(db, reservationId);
  if (!existing) return null;
  if (existing.cart_fingerprint !== fingerprint) {
    return { error: 'Your cart changed while checkout was being prepared. Please try again.', code: 'CHECKOUT_ATTEMPT_CHANGED', status: 409 };
  }
  if (existing.status === 'session_created' && existing.checkout_url) {
    return { reservationId, reused: true, checkoutUrl: existing.checkout_url, expiresAt: existing.expires_at };
  }
  if (existing.status === 'reserved') return { reservationId, reused: false, expiresAt: existing.expires_at };
  return { error: 'This checkout attempt is no longer active. Please try again.', code: 'CHECKOUT_ATTEMPT_INACTIVE', status: 409 };
}

export async function reserveCheckoutInventory(env, { reservationId, fingerprint, items, expiresAt }) {
  const trackedItems = reservationItems(items);
  if (!trackedItems.length) return { required: false };

  const existing = await reservationResult(env.DB, reservationId, fingerprint);
  if (existing) return { required: true, ...existing };

  const statements = [
    env.DB.prepare(`INSERT INTO checkout_inventory_reservations
      (id, cart_fingerprint, status, expires_at) VALUES (?, ?, 'reserved', ?)`)
      .bind(reservationId, fingerprint, expiresAt)
  ];
  for (const item of trackedItems) {
    const operationId = `reservation:${reservationId}:${item.variantId}`.slice(0, 240);
    statements.push(
      env.DB.prepare(`UPDATE product_variants SET
        stock_quantity = stock_quantity - ?, version = version + 1,
        last_adjustment_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`).bind(item.quantity, operationId, item.variantId),
      env.DB.prepare(`INSERT INTO checkout_inventory_reservation_items
        (reservation_id, product_variant_id, quantity) VALUES (?, ?, ?)`)
        .bind(reservationId, item.variantId, item.quantity),
      env.DB.prepare(`INSERT INTO stock_movements (
        product_variant_id, change_quantity, quantity_before, quantity_after,
        reason, reference_type, reference_id, changed_by
      ) SELECT id, ?, stock_quantity + ?, stock_quantity,
        'Stripe checkout stock reservation', 'checkout_reservation', ?, 'system:checkout'
        FROM product_variants WHERE id = ? AND last_adjustment_id = ?`)
        .bind(-item.quantity, item.quantity, reservationId, item.variantId, operationId)
    );
  }

  try {
    await env.DB.batch(statements);
    return { required: true, reservationId, reused: false, expiresAt };
  } catch (error) {
    const raced = await reservationResult(env.DB, reservationId, fingerprint).catch(() => null);
    if (raced) return { required: true, ...raced };
    console.error('Checkout stock reservation failed', { reservationId, message: error.message });
    return { required: true, error: 'Stock changed while checkout was being prepared. Please review your cart and try again.', status: 409 };
  }
}

export async function attachCheckoutReservation(db, reservationId, fingerprint, session) {
  const result = await db.prepare(`UPDATE checkout_inventory_reservations SET
    status = 'session_created', stripe_checkout_session_id = ?, checkout_url = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND cart_fingerprint = ? AND status IN ('reserved', 'session_created')`)
    .bind(session.id, cleanText(session.url, 1000), reservationId, fingerprint).run();
  if (!result.meta?.changes) throw new Error('Checkout stock reservation could not be linked to Stripe.');
}

export async function markCheckoutReservationPaymentPending(db, session) {
  const reservationId = cleanText(session.metadata?.checkout_request_id, 64);
  if (!session.id && !reservationId) return { marked: false };
  const result = await db.prepare(`UPDATE checkout_inventory_reservations SET
    status = 'payment_pending', stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, ?),
    updated_at = CURRENT_TIMESTAMP
    WHERE (stripe_checkout_session_id = ? OR (? != '' AND id = ?))
      AND status IN ('reserved', 'session_created', 'payment_pending')`)
    .bind(session.id || null, session.id || '', reservationId, reservationId).run();
  return { marked: Boolean(result.meta?.changes) };
}

export async function releaseCheckoutInventory(env, { reservationId = '', sessionId = '', reason = 'released' }) {
  const reservation = reservationId
    ? await checkoutReservation(env.DB, reservationId)
    : await env.DB.prepare('SELECT * FROM checkout_inventory_reservations WHERE stripe_checkout_session_id = ?').bind(sessionId).first();
  if (!reservation || !ACTIVE_RESERVATION_STATES.has(reservation.status)) return { released: false };

  const result = await env.DB.prepare(`SELECT product_variant_id, quantity
    FROM checkout_inventory_reservation_items WHERE reservation_id = ? ORDER BY product_variant_id`)
    .bind(reservation.id).all();
  const statements = [];
  for (const item of result.results || []) {
    const operationId = `reservation-release:${reservation.id}:${item.product_variant_id}`.slice(0, 240);
    statements.push(
      env.DB.prepare(`UPDATE product_variants SET
        stock_quantity = stock_quantity + ?, version = version + 1,
        last_adjustment_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND EXISTS (
          SELECT 1 FROM checkout_inventory_reservations
          WHERE id = ? AND status IN ('reserved', 'session_created', 'payment_pending')
        )`).bind(item.quantity, operationId, item.product_variant_id, reservation.id),
      env.DB.prepare(`INSERT INTO stock_movements (
        product_variant_id, change_quantity, quantity_before, quantity_after,
        reason, reference_type, reference_id, changed_by
      ) SELECT id, ?, stock_quantity - ?, stock_quantity,
        'Released Stripe checkout reservation', 'checkout_reservation', ?, 'system:checkout'
        FROM product_variants WHERE id = ? AND last_adjustment_id = ?`)
        .bind(item.quantity, item.quantity, reservation.id, item.product_variant_id, operationId)
    );
  }
  statements.push(env.DB.prepare(`UPDATE checkout_inventory_reservations SET
    status = ?, release_reason = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('reserved', 'session_created', 'payment_pending')`)
    .bind(reason === 'expired' ? 'expired' : 'released', cleanText(reason, 120), reservation.id));
  await env.DB.batch(statements);
  return { released: true, reservationId: reservation.id };
}

export async function releaseExpiredCheckoutReservations(env, limit = 10) {
  const result = await env.DB.prepare(`SELECT id FROM checkout_inventory_reservations
    WHERE status IN ('reserved', 'session_created') AND expires_at <= CURRENT_TIMESTAMP
    ORDER BY expires_at LIMIT ?`).bind(Math.max(1, Math.min(50, Number(limit) || 10))).all();
  for (const row of result.results || []) {
    await releaseCheckoutInventory(env, { reservationId: row.id, reason: 'expired' });
  }
  return (result.results || []).length;
}

function lineMetadata(lineItem) {
  return lineItem?.price?.product?.metadata || {};
}

function metadataInteger(metadata, key) {
  const value = String(metadata?.[key] ?? '');
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function surchargeLineTotal(lineItems) {
  return lineItems.reduce((total, item) => lineMetadata(item).item_kind === 'payment_surcharge'
    ? total + Number(item.amount_total || 0)
    : total, 0);
}

export function verifyStripeCheckoutSnapshot(session, lineItems, personalisationCents) {
  const metadata = session.metadata || {};
  const hasSnapshot = metadata.subtotal_cents !== undefined || metadata.payment_surcharge_cents !== undefined;
  if (!hasSnapshot) {
    return {
      subtotalCents: Number(session.amount_subtotal || 0),
      personalisationCents,
      shippingCents: Number(session.total_details?.amount_shipping || 0),
      paymentSurchargeCents: 0,
      paymentSurchargeEnabled: false,
      paymentSurchargePercent: '0',
      paymentSurchargeFixedCents: 0,
      paymentSurchargeLabel: '',
      paymentSurchargeDescription: '',
      fulfilmentType: 'delivery',
      shippingMethod: 'New Zealand Delivery',
      pickupLocation: '',
      pickupInstructions: '',
      totalCents: Number(session.amount_total || 0)
    };
  }

  const subtotalCents = metadataInteger(metadata, 'subtotal_cents');
  const storedPersonalisationCents = metadataInteger(metadata, 'personalisation_cents');
  const shippingCents = metadataInteger(metadata, 'shipping_cents');
  const paymentSurchargeCents = metadataInteger(metadata, 'payment_surcharge_cents');
  const paymentSurchargeEnabled = metadataInteger(metadata, 'payment_surcharge_enabled');
  const paymentSurchargeFixedCents = metadataInteger(metadata, 'payment_surcharge_fixed_cents');
  const totalCents = metadataInteger(metadata, 'total_cents');
  const fulfilmentType = cleanText(metadata.fulfilment_type, 20).toLowerCase();
  const shippingMethod = cleanText(metadata.shipping_method, 80);
  if ([subtotalCents, storedPersonalisationCents, shippingCents, paymentSurchargeCents, paymentSurchargeEnabled, paymentSurchargeFixedCents, totalCents].some(value => value === null)
    || ![0, 1].includes(paymentSurchargeEnabled)
    || !['pickup', 'delivery'].includes(fulfilmentType)
    || !shippingMethod) {
    throw new Error('Checkout total metadata is invalid.');
  }
  if (storedPersonalisationCents !== personalisationCents) throw new Error('Checkout personalisation total does not match Stripe line items.');
  if (paymentSurchargeCents !== surchargeLineTotal(lineItems)) throw new Error('Checkout surcharge does not match Stripe line items.');
  if (Number(session.amount_subtotal || 0) !== subtotalCents + personalisationCents + paymentSurchargeCents) {
    throw new Error('Checkout subtotal does not match Stripe line items.');
  }
  if (Number(session.total_details?.amount_shipping || 0) !== shippingCents) throw new Error('Checkout shipping total does not match Stripe.');
  if (fulfilmentType === 'pickup' && shippingCents !== 0) throw new Error('Pickup order includes an invalid shipping charge.');
  if (Number(session.amount_total || 0) !== totalCents
    || totalCents !== subtotalCents + personalisationCents + shippingCents + paymentSurchargeCents) {
    throw new Error('Checkout paid total does not match the server snapshot.');
  }

  return {
    subtotalCents,
    personalisationCents,
    shippingCents,
    paymentSurchargeCents,
    paymentSurchargeEnabled: paymentSurchargeEnabled === 1,
    paymentSurchargePercent: cleanText(metadata.payment_surcharge_percent, 12) || '0',
    paymentSurchargeFixedCents,
    paymentSurchargeLabel: cleanText(metadata.payment_surcharge_label, 80),
    paymentSurchargeDescription: cleanText(metadata.payment_surcharge_description, 240),
    fulfilmentType,
    shippingMethod,
    pickupLocation: cleanText(metadata.pickup_location, 120),
    pickupInstructions: cleanText(metadata.pickup_instructions, 300),
    totalCents
  };
}

function groupStripeItems(lineItems) {
  const groups = new Map();
  for (const lineItem of lineItems) {
    const metadata = lineMetadata(lineItem);
    if (!metadata.product_id || !metadata.variant_id) continue;
    const fallbackKey = [metadata.product_id, metadata.variant_id, metadata.player_name, metadata.player_number].join(':');
    const key = metadata.cart_item_key || fallbackKey;
    const group = groups.get(key) || {
      key,
      productId: metadata.product_id,
      variantId: Number(metadata.variant_id),
      sku: metadata.sku || '',
      size: metadata.size || '',
      colour: metadata.colour || '',
      style: metadata.colour_style || '',
      playerName: metadata.player_name || '',
      playerNumber: metadata.player_number || '',
      restrictedNumberEligibilityVerified:
        metadata.restricted_number_eligibility_verified === '1',
      quantity: Number(lineItem.quantity || 1),
      baseAmountTotal: 0,
      customisationAmountTotal: 0
    };
    if (metadata.item_kind === 'base_product') {
      group.quantity = Number(lineItem.quantity || 1);
      group.baseAmountTotal += Number(lineItem.amount_total || 0);
    } else {
      group.customisationAmountTotal += Number(lineItem.amount_total || 0);
    }
    groups.set(key, group);
  }
  return [...groups.values()].filter(group => group.baseAmountTotal > 0);
}

function restrictedNumberVerificationNote(items) {
  const numbers = [...new Set(items
    .filter(item => item.productId === TRAINING_KIT_ID && item.restrictedNumberEligibilityVerified)
    .map(item => item.playerNumber)
    .filter(number => RESTRICTED_SHIRT_NUMBERS.has(number)))].sort((a, b) => Number(a) - Number(b));
  return numbers.length ? `[system:training-kit-restricted-number-verified=${numbers.join(',')}]` : '';
}

function sessionAddress(session, fulfilmentType = 'delivery') {
  if (fulfilmentType !== 'delivery') return {};
  const shipping = session.shipping_details || session.collected_information?.shipping_details || {};
  return shipping.address || {};
}

async function existingOrder(db, sessionId) {
  return db.prepare('SELECT id, email_status FROM orders WHERE stripe_checkout_session_id = ?').bind(sessionId).first();
}

async function paidCheckoutReservation(db, session, catalogue) {
  const requestId = cleanText(session.metadata?.checkout_request_id, 64);
  const reservation = await db.prepare(`SELECT * FROM checkout_inventory_reservations
    WHERE stripe_checkout_session_id = ? OR (? != '' AND id = ?)
    ORDER BY CASE WHEN stripe_checkout_session_id = ? THEN 0 ELSE 1 END LIMIT 1`)
    .bind(session.id, requestId, requestId, session.id).first();
  if (!reservation) return null;
  if (!ACTIVE_RESERVATION_STATES.has(reservation.status)) {
    throw new Error(`Checkout inventory reservation is ${reservation.status}.`);
  }

  const rows = await db.prepare(`SELECT product_variant_id, quantity
    FROM checkout_inventory_reservation_items WHERE reservation_id = ? ORDER BY product_variant_id`)
    .bind(reservation.id).all();
  const reserved = new Map((rows.results || []).map(row => [Number(row.product_variant_id), Number(row.quantity)]));
  const expected = new Map();
  for (const item of catalogue) {
    if (!item.track_inventory) continue;
    expected.set(Number(item.variantId), (expected.get(Number(item.variantId)) || 0) + Number(item.quantity));
  }
  if (reserved.size !== expected.size
    || [...expected].some(([variantId, quantity]) => reserved.get(variantId) !== quantity)) {
    throw new Error('Checkout inventory reservation does not match the paid Stripe items.');
  }
  return reservation;
}

export async function commitPaidOrder(env, event, session, lineItems) {
  const existing = await existingOrder(env.DB, session.id);
  if (existing) {
    await ensureInvoiceSnapshot(env.DB, existing.id);
    return { orderId: existing.id, duplicate: true, emailStatus: existing.email_status };
  }

  const groups = groupStripeItems(lineItems);
  if (!groups.length) throw new Error('Paid order has no recognised inventory line items.');

  const catalogue = [];
  for (const group of groups) {
    const row = await env.DB.prepare(`
      SELECT p.id AS product_id, p.name, p.price_cents, p.active AS product_active, p.archived AS product_archived,
             p.available_for_sale, p.track_inventory,
             v.id AS variant_id, v.sku, v.stock_quantity, v.active AS variant_active
      FROM products p JOIN product_variants v ON v.product_id = p.id
      WHERE p.id = ? AND v.id = ?
    `).bind(group.productId, group.variantId).first();
    if (!row) throw new Error(`Order inventory record is missing for ${group.productId}.`);
    catalogue.push({ ...group, ...row });
  }

  const customer = session.customer_details || {};
  const metadata = session.metadata || {};
  const checkoutDetails = metadata.checkout_details_version === '1'
    ? validateCheckoutCustomerDetails({
        customerName: metadata.checkout_customer_name,
        childName: metadata.child_name
      })
    : { customerName: cleanText(customer.name, 100), childName: '' };
  if (checkoutDetails.error) throw new Error('Paid checkout customer details are invalid.');
  const personalisationCents = catalogue.reduce((sum, item) => sum + item.customisationAmountTotal, 0);
  const snapshot = verifyStripeCheckoutSnapshot(session, lineItems, personalisationCents);
  const shipping = session.shipping_details || session.collected_information?.shipping_details || {};
  const shippingAddress = sessionAddress(session, snapshot.fulfilmentType);
  const shippingCountry = cleanText(shippingAddress.country, 2).toUpperCase();
  if (snapshot.fulfilmentType === 'delivery' && shippingCountry !== 'NZ') {
    throw new Error('Delivery address must be in New Zealand.');
  }
  const shippingAddressText = [shippingAddress.line1, shippingAddress.line2, shippingAddress.city, shippingAddress.state, shippingAddress.postal_code].filter(Boolean).join(' ');
  const shippingRural = /\b(?:rural|r\.?d\.?\s*\d+)\b/i.test(shippingAddressText) ? 1 : 0;
  const verificationNote = restrictedNumberVerificationNote(catalogue);
  const reservation = await paidCheckoutReservation(env.DB, session, catalogue);
  const statements = [
    env.DB.prepare(`
      INSERT INTO stripe_events (event_id, event_type, stripe_checkout_session_id, status)
      VALUES (?, ?, ?, 'processing')
    `).bind(event.id, event.type, session.id),
    env.DB.prepare(`
      INSERT INTO orders (
        stripe_checkout_session_id, stripe_payment_intent_id, stripe_event_id,
        customer_name, child_name, customer_email, customer_phone, shipping_address_json,
        subtotal_cents, shipping_cents, total_cents, currency, payment_status,
        fulfilment_status, email_status, billing_address_json, payment_date,
        personalisation_cents, discount_cents, tax_cents, refund_status, payment_method_label, internal_notes,
        payment_surcharge_cents, payment_surcharge_enabled, payment_surcharge_percent, payment_surcharge_fixed_cents,
        payment_surcharge_label, payment_surcharge_description,
        fulfilment_type, shipping_method, pickup_location, pickup_instructions,
        shipping_name, shipping_phone, shipping_address_line_1, shipping_address_line_2,
        shipping_suburb, shipping_city, shipping_region, shipping_postcode, shipping_country, shipping_rural
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', 'pending', ?, CURRENT_TIMESTAMP, ?, ?, ?, 'not_refunded', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      session.id,
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
      event.id,
      checkoutDetails.customerName || cleanText(customer.name || shipping.name, 200),
      checkoutDetails.childName || null,
      cleanText(customer.email || session.customer_email, 254),
      cleanText(shipping.phone || customer.phone, 50),
      JSON.stringify(shippingAddress),
      snapshot.subtotalCents,
      snapshot.shippingCents,
      snapshot.totalCents,
      String(session.currency || 'nzd').toUpperCase(),
      cleanText(session.payment_status || 'paid', 30),
      JSON.stringify(customer.address || {}),
      snapshot.personalisationCents,
      Number(session.total_details?.amount_discount || 0),
      Number(session.total_details?.amount_tax || 0),
      cleanText(Array.isArray(session.payment_method_types) ? session.payment_method_types.join(', ') : '', 100),
      verificationNote,
      snapshot.paymentSurchargeCents,
      snapshot.paymentSurchargeEnabled ? 1 : 0,
      snapshot.paymentSurchargePercent,
      snapshot.paymentSurchargeFixedCents,
      snapshot.paymentSurchargeLabel,
      snapshot.paymentSurchargeDescription,
      snapshot.fulfilmentType,
      snapshot.shippingMethod,
      snapshot.pickupLocation,
      snapshot.pickupInstructions,
      cleanText(shipping.name || customer.name, 200),
      cleanText(shipping.phone || customer.phone, 50),
      cleanText(shippingAddress.line1, 200),
      cleanText(shippingAddress.line2, 200),
      '',
      cleanText(shippingAddress.city, 120),
      cleanText(shippingAddress.state, 120),
      cleanText(shippingAddress.postal_code, 20),
      shippingCountry,
      shippingRural
    )
  ];

  for (const item of catalogue) {
    const operationId = `${event.id}:${item.key}`.slice(0, 240);
    const unitPrice = Math.round(item.baseAmountTotal / item.quantity);
    statements.push(
      env.DB.prepare(`
        INSERT INTO order_items (
          order_id, product_id, variant_id, product_name, sku, quantity,
          unit_price_cents, player_name, player_number, customisation_total_cents, item_total_cents,
          size, colour, style, restricted_number, restricted_number_verified, number_subject_to_availability
        )
        SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM orders WHERE stripe_checkout_session_id = ?
      `).bind(
        item.productId, item.variantId, item.name, item.sku, item.quantity,
        unitPrice, item.playerName, item.playerNumber,
        item.customisationAmountTotal, item.baseAmountTotal + item.customisationAmountTotal,
        item.size, item.colour, item.style,
        item.productId === TRAINING_KIT_ID && RESTRICTED_SHIRT_NUMBERS.has(item.playerNumber) ? 1 : 0,
        item.restrictedNumberEligibilityVerified ? 1 : 0,
        item.productId === TRAINING_KIT_ID && Boolean(item.playerNumber) ? 1 : 0,
        session.id
      )
    );

    if (item.track_inventory && !reservation) {
      statements.push(
        env.DB.prepare(`
          UPDATE product_variants SET
            stock_quantity = stock_quantity - ?, version = version + 1,
            last_adjustment_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(item.quantity, operationId, item.variantId),
        env.DB.prepare(`
          INSERT INTO stock_movements (
            product_variant_id, change_quantity, quantity_before, quantity_after,
            reason, reference_type, reference_id, changed_by
          )
          SELECT id, ?, stock_quantity + ?, stock_quantity,
            'Paid Stripe order', 'stripe_order', ?, 'stripe:webhook'
          FROM product_variants WHERE id = ? AND last_adjustment_id = ?
        `).bind(-item.quantity, item.quantity, session.id, item.variantId, operationId)
      );
    }
  }

  if (reservation) {
    statements.push(
      env.DB.prepare(`UPDATE checkout_inventory_reservations SET
        status = 'committed', stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('reserved', 'session_created', 'payment_pending')`)
        .bind(session.id, reservation.id),
      env.DB.prepare(`UPDATE checkout_inventory_reservation_items SET
        committed_order_id = (SELECT id FROM orders WHERE stripe_checkout_session_id = ?)
        WHERE reservation_id = ?`).bind(session.id, reservation.id)
    );
  }

  statements.push(
    env.DB.prepare(`
      UPDATE stripe_events SET status = 'inventory_committed', processed_at = CURRENT_TIMESTAMP
      WHERE event_id = ?
    `).bind(event.id)
  );

  try {
    await env.DB.batch(statements);
  } catch (error) {
    const duplicate = await existingOrder(env.DB, session.id);
    if (duplicate) return { orderId: duplicate.id, duplicate: true, emailStatus: duplicate.email_status };
    throw error;
  }

  const order = await existingOrder(env.DB, session.id);
  await env.DB.prepare(`UPDATE orders SET order_number = printf('PTG-ORD-%s-%06d', strftime('%Y', created_at), id), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND order_number IS NULL`).bind(order.id).run();
  if (verificationNote) {
    const numberedOrder = await env.DB.prepare('SELECT order_number FROM orders WHERE id = ?').bind(order.id).first();
    await env.DB.prepare(`INSERT INTO admin_audit_log
      (admin_email, action, entity_type, entity_id, summary)
      VALUES ('system:checkout', 'restricted_number_validation', 'order', ?, ?)`)
      .bind(String(order.id), `Restricted Training Kit shirt-number eligibility verified for ${numberedOrder?.order_number || `order ${order.id}`}`).run();
  }
  await ensureInvoiceSnapshot(env.DB, order.id);
  return { orderId: order.id, duplicate: false, emailStatus: order.email_status };
}

export async function recordStripeRefund(env, event, charge) {
  const paymentIntentId = typeof charge?.payment_intent === 'string' ? charge.payment_intent : charge?.payment_intent?.id;
  if (!paymentIntentId) return { matched: false };
  const order = await env.DB.prepare(`
    SELECT id, stripe_checkout_session_id, total_cents, payment_surcharge_cents
    FROM orders WHERE stripe_payment_intent_id = ?
  `).bind(paymentIntentId).first();
  if (!order) return { matched: false };

  const explicitSurchargeRefundedCents = (charge.refunds?.data || []).reduce((total, refund) => {
    const value = metadataInteger(refund.metadata || {}, 'payment_surcharge_refund_cents');
    return total + (value || 0);
  }, 0);
  const refund = calculateRefundBreakdown(
    Number(order.total_cents || 0),
    Number(order.payment_surcharge_cents || 0),
    Number(charge.amount_refunded || 0),
    explicitSurchargeRefundedCents
  );
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE orders SET refund_status = ?, refunded_cents = ?, payment_surcharge_refunded_cents = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(refund.refundStatus, refund.refundedCents, refund.paymentSurchargeRefundedCents, order.id),
    env.DB.prepare(`
      UPDATE invoices SET status = ?, refunded_cents = ?, updated_at = CURRENT_TIMESTAMP
      WHERE order_id = ?
    `).bind(refund.refundStatus === 'fully_refunded' ? 'refunded' : refund.refundStatus === 'partially_refunded' ? 'partially_refunded' : 'issued', refund.refundedCents, order.id),
    env.DB.prepare(`
      INSERT OR IGNORE INTO stripe_events (event_id, event_type, stripe_checkout_session_id, status, processed_at)
      VALUES (?, ?, ?, 'processed', CURRENT_TIMESTAMP)
    `).bind(event.id, event.type, order.stripe_checkout_session_id)
  ]);
  return { matched: true, orderId: order.id, ...refund };
}

export async function markOrderEmailResult(env, orderId, eventId, sent, errorMessage = '') {
  const safeError = cleanText(errorMessage, 500);
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE orders SET email_status = ?, email_attempts = email_attempts + 1,
        email_sent_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE email_sent_at END,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(sent ? 'sent' : 'failed', sent ? 1 : 0, orderId),
    env.DB.prepare(`
      UPDATE stripe_events SET status = ?, last_error = ?, processed_at = CURRENT_TIMESTAMP
      WHERE event_id = ?
    `).bind(sent ? 'processed' : 'email_failed', safeError, eventId)
  ]);
}
