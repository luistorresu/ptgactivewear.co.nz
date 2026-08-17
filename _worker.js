import { getAdminIdentity, handleAdminAuth, isAdminMutationAllowed } from './worker/auth.js';
import { handleAdminApi } from './worker/admin-api.js';
import { getPublicProductBySlug, getPublicProducts, isD1CatalogueEnabled } from './worker/catalog.js';
import {
  attachCheckoutReservation,
  checkoutReservationFingerprint,
  commitPaidOrder,
  markCheckoutReservationPaymentPending,
  markOrderEmailResult,
  recordStripeRefund,
  releaseCheckoutInventory,
  releaseExpiredCheckoutReservations,
  reserveCheckoutInventory,
  validateD1CheckoutPayload
} from './worker/inventory.js';
import { handlePicturesApi, serveProductPicture } from './worker/pictures.js';
import { resolvePromotion } from './worker/promotions.js';
import { buildTrustedOrderSummary } from './worker/surcharge.js';
import { publicFulfilment, selectFulfilment } from './worker/fulfilment.js';
import { validateCheckoutCustomerDetails } from './worker/customer-details.js';
import {
  checkKvRateLimit,
  isJsonRequest,
  isSameOriginRequest,
  readLimitedJson,
  readLimitedText
} from './worker/request-security.js';
import {
  RESTRICTED_SHIRT_NUMBERS,
  TRAINING_KIT_ID,
  issueTrainingKitEligibilityProof,
  restrictedShirtNumberError,
  trainingKitPlayerNameIsValid,
  trainingKitShirtNumberIsValid,
  verifyTrainingKitEligibilityProof
} from './worker/shirt-number.js';

const MAX_FIELD_LENGTHS = {
  name: 100,
  email: 254,
  message: 3000
};

const STRIPE_API_VERSION = '2025-06-30.basil';
const PERSONALISATION_ADDON_NZD_CENTS = 2000;
const MAX_CART_ITEMS = 30;
const MAX_ITEM_QUANTITY = 20;
const SITE_ORIGIN = 'https://ptgactivewear.co.nz';
const CONTACT_BODY_BYTES = 16 * 1024;
const ELIGIBILITY_BODY_BYTES = 4 * 1024;
const CHECKOUT_BODY_BYTES = 64 * 1024;
const STRIPE_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;

const SERVER_PRODUCTS = {
  'patagonia-fc-beanie': {
    id: 'patagonia-fc-beanie',
    name: 'Patagonia FC Beanie',
    unitAmountNzdCents: 3500,
    sizes: ['One Size'],
    variants: [],
    personalisable: false,
    available: true
  },
  'patagonia-fc-performance-tracksuit': {
    id: 'patagonia-fc-performance-tracksuit',
    name: 'Patagonia FC Performance Tracksuit',
    unitAmountNzdCents: 11500,
    sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL'],
    variants: [],
    personalisable: false,
    available: true
  },
  'patagonia-fc-personalised-mug': {
    id: 'patagonia-fc-personalised-mug',
    name: 'Patagonia FC Personalised Mug',
    unitAmountNzdCents: 1500,
    sizes: ['One Size'],
    variants: [],
    personalisable: false,
    available: true
  },
  'patagonia-fc-tournament-player-kit': {
    id: 'patagonia-fc-tournament-player-kit',
    name: 'Patagonia FC Tournament Player Kit',
    unitAmountNzdCents: 9500,
    sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL'],
    variants: [],
    personalisable: true,
    available: true
  },
  'patagonia-fc-waterproof-rain-suit': {
    id: 'patagonia-fc-waterproof-rain-suit',
    name: 'Patagonia FC Waterproof Rain Suit',
    unitAmountNzdCents: 5000,
    sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL'],
    variants: [],
    personalisable: false,
    available: true
  },
  'patagonia-fc-training-kit': {
    id: 'patagonia-fc-training-kit',
    name: 'Patagonia FC Training Kit',
    unitAmountNzdCents: 9500,
    sizes: ['8', '10', '12', 'XS'],
    variants: [],
    personalisable: true,
    playerNamePriceCents: 0,
    playerNumberPriceCents: 0,
    available: true
  },
  'patagonia-fc-windbreaker-jacket': {
    id: 'patagonia-fc-windbreaker-jacket',
    name: 'Patagonia FC Windbreaker Jacket',
    unitAmountNzdCents: 9500,
    sizes: ['8', '10', '12', 'XS'],
    variants: [],
    personalisable: false,
    available: true
  }
};

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, ...headers }
  });
}

function cleanText(value, maxLength = MAX_FIELD_LENGTHS.email) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanMessage(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, MAX_FIELD_LENGTHS.message);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatMoneyFromCents(cents, currency = 'NZD') {
  return `${currency.toUpperCase()} $${(Number(cents || 0) / 100).toFixed(2)}`;
}

function validateContactPayload(payload) {
  const website = cleanText(payload.website, 200);
  if (website) return { error: 'Invalid submission.' };

  const name = cleanText(payload.name, MAX_FIELD_LENGTHS.name);
  const email = cleanText(payload.email, MAX_FIELD_LENGTHS.email);
  const message = cleanMessage(payload.message);

  if (!name) return { error: 'Name is required.' };
  if (!isValidEmail(email)) return { error: 'A valid email is required.' };
  if (!message) return { error: 'Message is required.' };

  return { name, email, message };
}

function validateNewsletterPayload(payload) {
  const website = cleanText(payload.website, 200);
  if (website) return { error: 'Invalid submission.' };

  const email = cleanText(payload.email, MAX_FIELD_LENGTHS.email);
  if (!isValidEmail(email)) return { error: 'A valid email is required.' };

  return { email };
}

function buildContactEmail({ name, email, message }, toEmail) {
  const subject = `PTG Activewear contact form message from ${name}`;
  const text = [
    'New message from ptgactivewear.co.nz contact form',
    '',
    `Sender name: ${name}`,
    `Sender email: ${email}`,
    'Website source: ptgactivewear.co.nz contact form',
    '',
    'Message:',
    message
  ].join('\n');
  const html = `
    <h2>New PTG Activewear contact message</h2>
    <p><strong>Sender name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Sender email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Website source:</strong> ptgactivewear.co.nz contact form</p>
    <hr>
    <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
  `;

  return { subject, text, html, to: toEmail, replyTo: email };
}

function buildNewsletterEmail({ email }, toEmail) {
  const subject = 'PTG Activewear newsletter signup';
  const text = [
    'New newsletter subscription from ptgactivewear.co.nz',
    '',
    `Subscriber email: ${email}`,
    'Website source: ptgactivewear.co.nz newsletter form'
  ].join('\n');
  const html = `
    <h2>New PTG Activewear newsletter signup</h2>
    <p><strong>Subscriber email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Website source:</strong> ptgactivewear.co.nz newsletter form</p>
  `;

  return { subject, text, html, to: toEmail, replyTo: email };
}

async function sendWithResend(env, emailData) {
  const recipients = Array.isArray(emailData.to) ? emailData.to : [emailData.to];
  const headers = {
    Authorization: `Bearer ${env.EMAIL_API_KEY}`,
    'Content-Type': 'application/json'
  };
  if (emailData.idempotencyKey) headers['Idempotency-Key'] = emailData.idempotencyKey;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: env.CONTACT_FROM_EMAIL,
      to: recipients,
      reply_to: emailData.replyTo,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html
    })
  });

  if (!response.ok) {
    const error = new Error('Email provider request failed.');
    error.code = `RESEND_HTTP_${response.status}`;
    throw error;
  }
}

function verifiedBrowserJsonRequest(request) {
  return isJsonRequest(request) && isSameOriginRequest(request);
}

async function limitedJsonResponse(request, maxBytes) {
  const result = await readLimitedJson(request, maxBytes);
  if (result.error) {
    return {
      response: jsonResponse({ ok: false, error: result.error, code: result.code }, result.status)
    };
  }
  return { body: result.body };
}

async function rateLimitResponse(env, request, scope, options) {
  try {
    const result = await checkKvRateLimit(env, request, scope, options);
    if (result.allowed) return null;
    return jsonResponse(
      { ok: false, error: 'Too many requests. Please wait and try again.', code: 'RATE_LIMITED' },
      429,
      { 'Retry-After': String(result.retryAfter) }
    );
  } catch (error) {
    console.error('Rate limit check failed', { scope, code: 'RATE_LIMIT_UNAVAILABLE' });
    return null;
  }
}

async function handleEmailRequest(request, env, type) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: jsonHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  }
  if (!verifiedBrowserJsonRequest(request)) {
    return jsonResponse({ ok: false, error: 'Request verification failed.' }, 403);
  }

  const parsed = await limitedJsonResponse(request, CONTACT_BODY_BYTES);
  if (parsed.response) return parsed.response;
  const payload = parsed.body;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return jsonResponse({ ok: false, error: 'A JSON object is required.' }, 400);
  }

  const validation = type === 'contact'
    ? validateContactPayload(payload)
    : validateNewsletterPayload(payload);

  if (validation.error) {
    return jsonResponse({ ok: false, error: validation.error }, 400);
  }
  const limited = await rateLimitResponse(env, request, type, {
    limit: type === 'contact' ? 10 : 20,
    windowSeconds: type === 'contact' ? 15 * 60 : 60 * 60,
  });
  if (limited) return limited;

  const provider = String(env.EMAIL_PROVIDER || 'resend').toLowerCase();
  const toEmail = cleanText(env.CONTACT_TO_EMAIL, MAX_FIELD_LENGTHS.email);
  const fromEmail = cleanText(env.CONTACT_FROM_EMAIL, MAX_FIELD_LENGTHS.email);

  if (!toEmail || !fromEmail || !env.EMAIL_API_KEY) {
    return jsonResponse({ ok: false, error: 'Email service is not configured.' }, 503);
  }

  const emailData = type === 'contact'
    ? buildContactEmail(validation, toEmail)
    : buildNewsletterEmail(validation, toEmail);
  const requestKey = /^[A-Za-z0-9_-]{8,64}$/.test(String(request.headers.get('x-request-id') || ''))
    ? String(request.headers.get('x-request-id'))
    : crypto.randomUUID();
  emailData.idempotencyKey = `ptg-${type}-${requestKey}`;

  try {
    if (provider === 'resend') {
      await sendWithResend({ ...env, CONTACT_FROM_EMAIL: fromEmail }, emailData);
    } else {
      return jsonResponse({ ok: false, error: `Unsupported email provider: ${provider}` }, 503);
    }
  } catch (error) {
    console.error(`${type} email send failed`, { code: error.code || 'EMAIL_PROVIDER_ERROR' });
    return jsonResponse({ ok: false, error: 'Email could not be sent.' }, 502);
  }

    return jsonResponse({ ok: true, requestId: requestKey });
}

function getApprovedSiteUrl(request, env) {
  const configured = cleanText(env.SITE_URL, 200) || SITE_ORIGIN;
  const requestUrl = new URL(request.url);

  if (requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1') {
    return requestUrl.origin;
  }

  if (configured === SITE_ORIGIN) return SITE_ORIGIN;

  try {
    const parsed = new URL(configured);
    return parsed.origin;
  } catch (error) {
    return SITE_ORIGIN;
  }
}

function normaliseCheckoutItem(rawItem) {
  const productId = cleanText(rawItem.productId || rawItem.id, 120).toLowerCase();
  const quantity = Number(rawItem.quantity || rawItem.qty);
  const size = cleanText(rawItem.size, 40);
  const variant = cleanText(rawItem.variant || rawItem.colour || rawItem.color, 80);
  const personalisation = rawItem.personalisation || {};
  const playerName = cleanText(personalisation.name || rawItem.playerName, 20);
  const playerNumber = cleanText(personalisation.number || rawItem.playerNumber, 2);
  const shirtNumberEligibilityToken = cleanText(rawItem.shirtNumberEligibilityToken, 1000);

  return { productId, quantity, size, variant, playerName, playerNumber, shirtNumberEligibilityToken, variantId: null, cartItemKey: '' };
}

async function validateCheckoutPayload(payload, env) {
  if (!payload || !Array.isArray(payload.items)) {
    return { error: 'Cart items are required.' };
  }

  if (payload.items.length === 0) {
    return { error: 'Your cart is empty.' };
  }

  if (payload.items.length > MAX_CART_ITEMS) {
    return { error: 'Too many cart items.' };
  }

  const checkedItems = [];

  for (const rawItem of payload.items) {
    const item = normaliseCheckoutItem(rawItem || {});
    const product = SERVER_PRODUCTS[item.productId];

    if (!product || !product.available) {
      return { error: 'One of the products in your cart is no longer available.' };
    }

    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_ITEM_QUANTITY) {
      return { error: `Invalid quantity for ${product.name}.` };
    }

    if (product.sizes.length && !product.sizes.includes(item.size)) {
      return { error: `Please choose a valid size for ${product.name}.` };
    }

    if (product.variants.length) {
      if (!product.variants.includes(item.variant)) {
        return { error: `Please choose a valid colour or style for ${product.name}.` };
      }
    } else if (item.variant) {
      return { error: `${product.name} does not support that colour or style option.` };
    }

    if (!product.personalisable && (item.playerName || item.playerNumber)) {
      return { error: `${product.name} does not support player personalisation.` };
    }

    if (item.productId === TRAINING_KIT_ID) {
      if (!trainingKitPlayerNameIsValid(item.playerName)) {
        return { error: 'Player Name may contain letters, spaces, hyphens, and apostrophes only.' };
      }
      if (!trainingKitShirtNumberIsValid(item.playerNumber)) {
        return { error: 'Please enter a whole Shirt Number from 1 to 99.' };
      }
      if (RESTRICTED_SHIRT_NUMBERS.has(item.playerNumber)
        && !await verifyTrainingKitEligibilityProof(item.shirtNumberEligibilityToken, item.playerNumber, env)) {
        return { error: restrictedShirtNumberError(item.playerNumber) };
      }
    } else {
      if (item.playerName && !/^[A-Za-z0-9 .'-]{1,20}$/.test(item.playerName)) {
        return { error: `Please use letters, numbers, spaces, apostrophes, hyphens, or full stops for the player name on ${product.name}.` };
      }
      if (item.playerNumber && !/^(?:0|00|[1-9][0-9]?)$/.test(item.playerNumber)) {
        return { error: `Please enter a player number from 0 to 99 for ${product.name}.` };
      }
    }

    const nameAddOn = product.personalisable && item.playerName
      ? Number(product.playerNamePriceCents ?? PERSONALISATION_ADDON_NZD_CENTS)
      : 0;
    const numberAddOn = product.personalisable && item.playerNumber
      ? Number(product.playerNumberPriceCents ?? PERSONALISATION_ADDON_NZD_CENTS)
      : 0;

    checkedItems.push({
      ...item,
      product,
      restrictedNumberEligibilityVerified: item.productId === TRAINING_KIT_ID && RESTRICTED_SHIRT_NUMBERS.has(item.playerNumber),
      nameAddOn,
      numberAddOn
    });
  }

  return { items: checkedItems };
}

function buildOptionDescription(item) {
  const details = [];
  if (item.size) details.push(`Size: ${item.size}`);
  if (item.variant) details.push(`Colour/style: ${item.variant}`);
  if (item.playerName) details.push(`Player name: ${item.playerName}`);
  if (item.playerNumber) details.push(`${item.product.id === TRAINING_KIT_ID ? 'Requested shirt number' : 'Player number'}: ${item.playerNumber}`);
  if (item.product.id === TRAINING_KIT_ID && item.playerNumber) details.push('Subject to final shirt-number availability');
  return details.length ? details.join(' | ') : 'Standard item';
}

function appendStripeLineItem(params, index, line) {
  params.append(`line_items[${index}][price_data][currency]`, 'nzd');
  params.append(`line_items[${index}][price_data][unit_amount]`, String(line.unitAmount));
  params.append(`line_items[${index}][price_data][product_data][name]`, line.name);
  params.append(`line_items[${index}][price_data][product_data][description]`, line.description);
  params.append(`line_items[${index}][quantity]`, String(line.quantity));

  Object.entries(line.metadata || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.append(`line_items[${index}][price_data][product_data][metadata][${key}]`, String(value));
    }
  });
}

export function buildStripeLineItems(validatedItems, summary, fulfilment) {
  const lines = [];
  const eligibleProductIds = new Set(summary.promotion.eligibleProductIds || []);
  let remainingDiscountCents = summary.discountCents;

  validatedItems.forEach(item => {
    const optionDescription = buildOptionDescription(item);
    const baseMetadata = {
      product_id: item.product.id,
      variant_id: item.variantId,
      sku: item.sku,
      cart_item_key: item.cartItemKey,
      size: item.size,
      colour_style: item.variant,
      player_name: item.playerName,
      player_number: item.playerNumber,
      restricted_number_eligibility_verified: item.restrictedNumberEligibilityVerified ? '1' : '',
      original_unit_amount_cents: item.product.unitAmountNzdCents,
      item_kind: 'base_product'
    };

    let remainingQuantity = item.quantity;
    while (remainingQuantity > 0) {
      const unitDiscount = eligibleProductIds.has(item.product.id)
        ? Math.min(item.product.unitAmountNzdCents, remainingDiscountCents)
        : 0;
      const lineQuantity = unitDiscount > 0 ? 1 : remainingQuantity;
      lines.push({
        name: item.product.name,
        description: unitDiscount > 0
          ? `${optionDescription} | ${summary.promotion.code} discount: -${formatMoneyFromCents(unitDiscount)}`
          : optionDescription,
        unitAmount: item.product.unitAmountNzdCents - unitDiscount,
        quantity: lineQuantity,
        metadata: {
          ...baseMetadata,
          promotion_code: unitDiscount > 0 ? summary.promotion.code : '',
          promotion_discount_per_unit_cents: unitDiscount
        }
      });
      remainingDiscountCents -= unitDiscount;
      remainingQuantity -= lineQuantity;
    }

    if (item.nameAddOn) {
      lines.push({
        name: `${item.product.name} - Player Name Add-on`,
        description: `Player name: ${item.playerName}`,
        unitAmount: item.nameAddOn,
        quantity: item.quantity,
        metadata: { ...baseMetadata, item_kind: 'player_name_addon' }
      });
    }

    if (item.numberAddOn) {
      lines.push({
        name: `${item.product.name} - ${item.product.id === TRAINING_KIT_ID ? 'Shirt Number' : 'Player Number'} Add-on`,
        description: `${item.product.id === TRAINING_KIT_ID ? 'Requested shirt number' : 'Player number'}: ${item.playerNumber}`,
        unitAmount: item.numberAddOn,
        quantity: item.quantity,
        metadata: { ...baseMetadata, item_kind: 'player_number_addon' }
      });
    }
  });

  if (remainingDiscountCents !== 0) throw new Error('Promotion discount could not be allocated to eligible items.');

  if (summary.paymentSurchargeCents > 0) {
    lines.push({
      name: summary.surcharge.label,
      description: summary.surcharge.description,
      unitAmount: summary.paymentSurchargeCents,
      quantity: 1,
      metadata: { item_kind: 'payment_surcharge' }
    });
  }

  return lines;
}

async function createStripeCheckoutSession(env, sessionParams, idempotencyKey = '') {
  const headers = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': STRIPE_API_VERSION
  };
  if (idempotencyKey) headers['Idempotency-Key'] = `ptg-checkout-${idempotencyKey}`;
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers,
    body: sessionParams
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const stripeError = {
      status: response.status,
      type: body?.error?.type,
      code: body?.error?.code,
      message: body?.error?.message,
      parameter: body?.error?.param,
      requestId: response.headers.get('request-id')
    };
    console.error('Stripe Checkout Session creation failed', {
      ...stripeError
    });
    const error = new Error('Stripe session creation failed.');
    error.stripeStatus = response.status;
    error.safeToReleaseReservation = response.status >= 400 && response.status < 500;
    throw error;
  }

  return body;
}

function publicCheckoutSummary(summary, fulfilment) {
  return {
    currency: summary.currency,
    merchandiseSubtotalCents: summary.merchandiseSubtotalCents,
    discountedMerchandiseSubtotalCents: summary.discountedMerchandiseSubtotalCents,
    personalisationCents: summary.personalisationCents,
    discountCents: summary.discountCents,
    shippingCents: summary.shippingCents,
    paymentSurchargeCents: summary.paymentSurchargeCents,
    totalCents: summary.totalCents,
    fulfilment: publicFulfilment(fulfilment),
    promotion: summary.promotion.code ? {
      code: summary.promotion.code,
      type: summary.promotion.type,
      valueCents: summary.promotion.valueCents,
      eligibleSubtotalCents: summary.promotion.eligibleSubtotalCents,
      discountCents: summary.promotion.discountCents
    } : null,
    surcharge: {
      enabled: summary.surcharge.enabled,
      label: summary.surcharge.label,
      description: summary.surcharge.description,
      percent: summary.surcharge.percent,
      fixedCents: summary.surcharge.fixedCents
    }
  };
}

async function validateAndSummariseCheckout(payload, env, { requireCustomerDetails = false } = {}) {
  const customerDetails = validateCheckoutCustomerDetails(payload?.customerDetails, { required: requireCustomerDetails });
  if (customerDetails.error) return customerDetails;
  const useD1Inventory = Boolean(env.DB) && String(env.INVENTORY_ENFORCEMENT || '').toLowerCase() === 'd1';
  const validation = useD1Inventory
    ? await validateD1CheckoutPayload(payload, env)
    : await validateCheckoutPayload(payload, env);
  if (validation.error) return validation;
  try {
    const fulfilment = selectFulfilment(payload, env);
    if (fulfilment.error) return fulfilment;
    const promotionResult = await resolvePromotion(env.DB, payload?.promotionCode, validation.items);
    if (promotionResult.error) return promotionResult;
    return {
      ...validation,
      customerDetails,
      fulfilment,
      summary: buildTrustedOrderSummary(validation.items, fulfilment.shippingCents, env, promotionResult.promotion)
    };
  } catch (error) {
    console.error('Checkout total configuration failed', { message: error.message });
    return { error: 'Checkout totals are temporarily unavailable.', configurationError: true };
  }
}

async function handleTrainingKitNumberEligibility(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: jsonHeaders });
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  if (!verifiedBrowserJsonRequest(request)) return jsonResponse({ ok: false, error: 'Request verification failed.' }, 403);
  const parsed = await limitedJsonResponse(request, ELIGIBILITY_BODY_BYTES);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const limited = await rateLimitResponse(env, request, 'shirt-number-eligibility', {
    limit: 30,
    windowSeconds: 10 * 60
  });

  if (limited) return limited;
  const result = await issueTrainingKitEligibilityProof(body?.shirtNumber, body?.birthDay, env);
  if (result.error) return jsonResponse({ ok: false, error: result.error }, result.configurationError ? 503 : 400);
  return jsonResponse({ ok: true, eligibilityToken: result.token, expiresAt: result.expiresAt });
}

async function handleCheckoutSummary(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: jsonHeaders });
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  if (!verifiedBrowserJsonRequest(request)) return jsonResponse({ ok: false, error: 'Request verification failed.' }, 403);
  const parsed = await limitedJsonResponse(request, CHECKOUT_BODY_BYTES);
  if (parsed.response) return parsed.response;
  await releaseExpiredInventoryBeforeCheckout(env);
  const validation = await validateAndSummariseCheckout(parsed.body, env);
  if (validation.error) return jsonResponse({ ok: false, error: validation.error }, validation.configurationError ? 503 : 400);
  return jsonResponse({ ok: true, summary: publicCheckoutSummary(validation.summary, validation.fulfilment) });
}

async function handleCreateCheckoutSession(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: jsonHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  }

  if (!verifiedBrowserJsonRequest(request)) {
    return jsonResponse({ ok: false, error: 'Request verification failed.' }, 403);
  }

  if (String(env.CHECKOUT_ENABLED || 'true').toLowerCase() !== 'true') {
    return jsonResponse({ ok: false, error: 'Checkout is temporarily unavailable.' }, 503);
  }

  const parsed = await limitedJsonResponse(request, CHECKOUT_BODY_BYTES);
  if (parsed.response) return parsed.response;
  const payload = parsed.body;
  await releaseExpiredInventoryBeforeCheckout(env);
  const validation = await validateAndSummariseCheckout(payload, env, { requireCustomerDetails: true });

  if (validation.error) {
    return jsonResponse({ ok: false, error: validation.error }, validation.configurationError ? 503 : 400);
  }

  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({ ok: false, error: 'Checkout is not configured yet.' }, 503);
  }
  const limited = await rateLimitResponse(env, request, 'checkout-session', {
    limit: 10,
    windowSeconds: 10 * 60
  });
  if (limited) return limited;

  const siteUrl = getApprovedSiteUrl(request, env);
  const lineItems = buildStripeLineItems(validation.items, validation.summary, validation.fulfilment);
  const params = new URLSearchParams();
  const requestId = /^[A-Za-z0-9_-]{8,64}$/.test(String(payload.checkoutRequestId || '')) ? String(payload.checkoutRequestId) : '';
  const useReservations = Boolean(env.DB)
    && String(env.INVENTORY_ENFORCEMENT || '').toLowerCase() === 'd1'
    && validation.items.some(item => item.trackInventory);
  let reservation = { required: false };
  let reservationFingerprint = '';
  let reservationExpiresAtUnix = 0;

  if (useReservations) {
    if (!requestId) return jsonResponse({ ok: false, error: 'Checkout needs a fresh request reference. Please refresh your cart and try again.' }, 400);
    try {
      // Stripe requires at least 30 minutes. Persisting this value keeps every
      // idempotent retry byte-for-byte stable, including concurrent retries.
      const requestedExpiresAtUnix = Math.floor(Date.now() / 1000) + 31 * 60;
      const expiresAtSql = new Date(requestedExpiresAtUnix * 1000).toISOString().slice(0, 19).replace('T', ' ');
      reservationFingerprint = await checkoutReservationFingerprint(validation.items, validation.summary, validation.fulfilment, validation.customerDetails);
      reservation = await reserveCheckoutInventory(env, {
        reservationId: requestId,
        fingerprint: reservationFingerprint,
        items: validation.items,
        expiresAt: expiresAtSql
      });
    } catch (error) {
      console.error('Checkout reservation preparation failed', { requestId, message: error.message });
      return jsonResponse({ ok: false, error: 'Checkout stock could not be reserved. Please try again.' }, 503);
    }
    if (reservation.error) return jsonResponse({ ok: false, error: reservation.error, code: reservation.code || 'CHECKOUT_RESERVATION_FAILED' }, reservation.status || 409);
    if (reservation.checkoutUrl) {
      return jsonResponse({ ok: true, url: reservation.checkoutUrl, summary: publicCheckoutSummary(validation.summary, validation.fulfilment) });
    }
    reservationExpiresAtUnix = Math.floor(Date.parse(`${String(reservation.expiresAt || '').replace(' ', 'T')}Z`) / 1000);
    if (!Number.isSafeInteger(reservationExpiresAtUnix)) {
      await releaseCheckoutInventory(env, { reservationId: requestId, reason: 'invalid_expiry' }).catch(() => {});
      return jsonResponse({ ok: false, error: 'Checkout stock could not be reserved. Please try again.' }, 503);
    }
  }

  params.append('mode', 'payment');
  if (reservation.required) params.append('expires_at', String(reservationExpiresAtUnix));
  if (validation.summary.surcharge.enabled) params.append('payment_method_types[0]', 'card');
  params.append('success_url', `${siteUrl}/order-success?session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${siteUrl}/cart?checkout=cancelled`);
  params.append('billing_address_collection', 'required');
  params.append('customer_creation', 'if_required');
  params.append('phone_number_collection[enabled]', 'true');
  params.append('payment_intent_data[description]', 'PTG Activewear order');
  if (validation.fulfilment.type === 'delivery') {
    params.append('shipping_address_collection[allowed_countries][0]', 'NZ');
    params.append('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
    params.append('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(validation.fulfilment.shippingCents));
    params.append('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'nzd');
    params.append('shipping_options[0][shipping_rate_data][display_name]', validation.fulfilment.label);
    params.append('custom_text[shipping_address][message]', 'Delivery is available to New Zealand addresses only. Please check your address carefully before payment.');
  } else {
    params.append('custom_text[submit][message]', `${validation.fulfilment.label} - Free. ${validation.fulfilment.instructions}`);
  }
  params.append('metadata[source]', 'ptgactivewear.co.nz');
  params.append('metadata[checkout_details_version]', '1');
  params.append('metadata[checkout_customer_name]', validation.customerDetails.customerName);
  params.append('metadata[child_name]', validation.customerDetails.childName);
  params.append('metadata[fulfilment_type]', validation.fulfilment.type);
  params.append('metadata[shipping_method]', validation.fulfilment.label);
  params.append('metadata[pickup_location]', validation.fulfilment.locationName);
  params.append('metadata[pickup_address]', validation.fulfilment.pickupAddress);
  params.append('metadata[pickup_instructions]', validation.fulfilment.instructions);
  params.append('metadata[subtotal_cents]', String(validation.summary.merchandiseSubtotalCents));
  params.append('metadata[discount_cents]', String(validation.summary.discountCents));
  params.append('metadata[promotion_code]', validation.summary.promotion.code);
  params.append('metadata[promotion_type]', validation.summary.promotion.type);
  params.append('metadata[promotion_value_cents]', String(validation.summary.promotion.valueCents));
  params.append('metadata[promotion_eligible_subtotal_cents]', String(validation.summary.promotion.eligibleSubtotalCents));
  params.append('metadata[personalisation_cents]', String(validation.summary.personalisationCents));
  params.append('metadata[shipping_cents]', String(validation.summary.shippingCents));
  params.append('metadata[payment_surcharge_cents]', String(validation.summary.paymentSurchargeCents));
  params.append('metadata[payment_surcharge_enabled]', validation.summary.surcharge.enabled ? '1' : '0');
  params.append('metadata[payment_surcharge_percent]', validation.summary.surcharge.percent);
  params.append('metadata[payment_surcharge_fixed_cents]', String(validation.summary.surcharge.fixedCents));
  params.append('metadata[payment_surcharge_label]', validation.summary.surcharge.label);
  params.append('metadata[payment_surcharge_description]', validation.summary.surcharge.description);
  params.append('metadata[total_cents]', String(validation.summary.totalCents));
  if (reservation.required) {
    params.append('metadata[checkout_request_id]', requestId);
    params.append('metadata[inventory_reserved]', '1');
  }

  lineItems.forEach((line, index) => appendStripeLineItem(params, index, line));

  try {
    const session = await createStripeCheckoutSession(env, params, requestId);
    if (reservation.required) {
      await attachCheckoutReservation(env.DB, requestId, reservationFingerprint, session);
    }
    return jsonResponse({ ok: true, url: session.url, summary: publicCheckoutSummary(validation.summary, validation.fulfilment) });
  } catch (error) {
    if (reservation.required && error.safeToReleaseReservation) {
      await releaseCheckoutInventory(env, { reservationId: requestId, reason: `stripe_${error.stripeStatus}` }).catch(releaseError => {
        console.error('Checkout reservation release failed', { requestId, message: releaseError.message });
      });
    }
    return jsonResponse({ ok: false, error: 'Checkout could not be started. Please try again.' }, 502);
  }
}

async function releaseExpiredInventoryBeforeCheckout(env) {
  if (!env.DB || String(env.INVENTORY_ENFORCEMENT || '').toLowerCase() !== 'd1') return;
  try {
    await releaseExpiredCheckoutReservations(env, 10);
  } catch (error) {
    console.error('Expired checkout reservation cleanup failed', { message: error.message });
  }
}

async function handleCheckoutStatus(request, env) {
  if (request.method !== 'GET') return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  if (!env.DB) return jsonResponse({ ok: false, error: 'Order confirmation is temporarily unavailable.' }, 503);
  const limited = await rateLimitResponse(env, request, 'checkout-status', {
    limit: 60,
    windowSeconds: 10 * 60
  });
  if (limited) return limited;
  const sessionId = new URL(request.url).searchParams.get('session_id') || '';
  if (!/^cs_(?:test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) {
    return jsonResponse({ ok: false, error: 'A valid checkout reference is required.' }, 400);
  }
  const order = await env.DB.prepare(`SELECT order_number, payment_status, fulfilment_status
    FROM orders WHERE stripe_checkout_session_id = ?`).bind(sessionId).first();
  if (!order) return jsonResponse({ ok: true, status: 'pending' });
  if (!['paid', 'no_payment_required'].includes(String(order.payment_status || '').toLowerCase())) {
    return jsonResponse({ ok: true, status: 'pending' });
  }
  return jsonResponse({
    ok: true,
    status: 'confirmed',
    orderNumber: order.order_number || '',
    fulfilmentStatus: order.fulfilment_status || 'pending'
  });
}

function parseStripeSignatureHeader(header) {
  const parts = String(header || '').split(',').map(part => part.trim());
  const timestamp = parts.find(part => part.startsWith('t='))?.slice(2);
  const signatures = parts
    .filter(part => part.startsWith('v1='))
    .map(part => part.slice(3));

  return { timestamp, signatures };
}

function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return mismatch === 0;
}

async function verifyStripeWebhookSignature(rawBody, signatureHeader, secret) {
  const { timestamp, signatures } = parseStripeSignatureHeader(signatureHeader);

  if (!timestamp || signatures.length === 0) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > 300) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`));
  const expected = bufferToHex(digest);

  return signatures.some(signature => timingSafeEqual(signature, expected));
}

async function reserveWebhookEvent(env, eventId) {
  if (!env.ORDER_EVENT_STORE) {
    throw new Error('ORDER_EVENT_STORE KV binding is required for webhook idempotency.');
  }

  const existing = await env.ORDER_EVENT_STORE.get(eventId);
  if (existing) return false;

  await env.ORDER_EVENT_STORE.put(eventId, 'processing', { expirationTtl: 60 * 60 * 24 * 90 });
  return true;
}

async function markWebhookEventProcessed(env, eventId) {
  await env.ORDER_EVENT_STORE.put(eventId, 'processed', { expirationTtl: 60 * 60 * 24 * 90 });
}

async function releaseWebhookEvent(env, eventId) {
  await env.ORDER_EVENT_STORE.delete(eventId);
}

async function fetchStripeLineItems(env, sessionId) {
  const params = new URLSearchParams();
  params.append('limit', '100');
  params.append('expand[]', 'data.price.product');

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/line_items?${params}`, {
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Stripe-Version': STRIPE_API_VERSION
    }
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('Stripe line item fetch failed', { status: response.status, code: body?.error?.code });
    throw new Error('Could not fetch Stripe line items.');
  }

  return Array.isArray(body.data) ? body.data : [];
}

function formatStripeAddress(address = {}) {
  return [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postal_code,
    address.country
  ].filter(Boolean).join(', ');
}

function describeStripeLineItem(item) {
  const product = item.price?.product || {};
  const metadata = product.metadata || {};
  const details = [];

  if (metadata.size) details.push(`Size: ${metadata.size}`);
  if (metadata.colour_style) details.push(`Colour/style: ${metadata.colour_style}`);
  if (metadata.player_name) details.push(`Player name: ${metadata.player_name}`);
  if (metadata.player_number) details.push(`${metadata.product_id === TRAINING_KIT_ID ? 'Requested shirt number' : 'Player number'}: ${metadata.player_number}`);
  if (metadata.product_id === TRAINING_KIT_ID && metadata.player_number) details.push('Subject to final shirt-number availability');
  if (metadata.product_id === TRAINING_KIT_ID && metadata.restricted_number_eligibility_verified === '1') details.push('Restricted-number eligibility: verified');
  if (metadata.item_kind && metadata.item_kind !== 'base_product') details.push(`Charge: ${metadata.item_kind.replace(/_/g, ' ')}`);

  return {
    name: item.description || product.name || 'PTG Activewear item',
    quantity: item.quantity || 1,
    amountTotal: metadata.item_kind === 'base_product' && /^\d+$/.test(String(metadata.original_unit_amount_cents || ''))
      ? Number(metadata.original_unit_amount_cents) * Number(item.quantity || 1)
      : item.amount_total || 0,
    details,
    itemKind: metadata.item_kind || 'base_product',
    cartItemKey: metadata.cart_item_key || ''
  };
}

function consolidateEmailItems(items) {
  const consolidated = [];
  const grouped = new Map();
  for (const item of items) {
    if (item.itemKind !== 'base_product' || !item.cartItemKey) {
      consolidated.push(item);
      continue;
    }
    const existing = grouped.get(item.cartItemKey);
    if (!existing) {
      const copy = { ...item, details: [...item.details] };
      grouped.set(item.cartItemKey, copy);
      consolidated.push(copy);
      continue;
    }
    existing.quantity += item.quantity;
    existing.amountTotal += item.amountTotal;
    existing.details = [...new Set([...existing.details, ...item.details])];
  }
  return consolidated;
}

export function buildOrderEmailData(session, lineItems) {
  const customer = session.customer_details || {};
  const shipping = session.shipping_details || session.collected_information?.shipping_details || {};
  const shippingAddress = shipping.address || customer.address || {};
  const describedItems = lineItems.map(describeStripeLineItem);
  const items = consolidateEmailItems(describedItems.filter(item => !['payment_surcharge', 'fulfilment_pickup'].includes(item.itemKind)));
  const metadata = session.metadata || {};
  const checkoutDetails = metadata.checkout_details_version === '1'
    ? validateCheckoutCustomerDetails({
        customerName: metadata.checkout_customer_name,
        childName: metadata.child_name
      })
    : { customerName: customer.name || shipping.name || 'Not provided', childName: '' };
  if (checkoutDetails.error) throw new Error('Checkout customer details are invalid.');
  const metadataCents = key => /^\d+$/.test(String(metadata[key] || '')) ? Number(metadata[key]) : 0;
  const fulfilmentType = metadata.fulfilment_type === 'pickup' ? 'pickup' : 'delivery';
  const formattedShippingAddress = fulfilmentType === 'delivery' ? formatStripeAddress(shippingAddress) : '';

  return {
    sessionId: session.id,
    paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || '',
    paymentStatus: session.payment_status,
    customerName: checkoutDetails.customerName || customer.name || shipping.name || 'Not provided',
    childName: checkoutDetails.childName || '',
    customerEmail: customer.email || session.customer_email || '',
    phone: shipping.phone || customer.phone || '',
    fulfilmentType,
    shippingMethod: cleanText(metadata.shipping_method, 80) || (fulfilmentType === 'pickup' ? 'Pick up from Training Centre' : 'New Zealand Delivery'),
    pickupLocation: cleanText(metadata.pickup_location, 120) || 'Training Centre',
    pickupAddress: cleanText(metadata.pickup_address, 300),
    pickupInstructions: cleanText(metadata.pickup_instructions, 300) || 'We will contact you when your order is ready to collect and confirm the collection details.',
    shippingAddress: formattedShippingAddress,
    shippingRural: fulfilmentType === 'delivery' && /\b(?:rural|r\.?d\.?\s*\d+)\b/i.test(formattedShippingAddress),
    items,
    merchandiseSubtotal: metadataCents('subtotal_cents') || describedItems.filter(item => item.itemKind === 'base_product').reduce((sum, item) => sum + Number(item.amountTotal || 0), 0),
    personalisationAmount: metadataCents('personalisation_cents') || describedItems.filter(item => item.itemKind === 'player_name_addon' || item.itemKind === 'player_number_addon').reduce((sum, item) => sum + Number(item.amountTotal || 0), 0),
    promotionCode: cleanText(metadata.promotion_code, 64).toUpperCase(),
    promotionType: cleanText(metadata.promotion_type, 20).toLowerCase(),
    promotionValue: metadataCents('promotion_value_cents'),
    promotionEligibleSubtotal: metadataCents('promotion_eligible_subtotal_cents'),
    discountAmount: metadataCents('discount_cents') || Number(session.total_details?.amount_discount || 0),
    shippingAmount: metadataCents('shipping_cents') || session.total_details?.amount_shipping || 0,
    paymentSurchargeAmount: metadataCents('payment_surcharge_cents'),
    paymentSurchargeEnabled: metadata.payment_surcharge_enabled === '1',
    paymentSurchargePercent: cleanText(metadata.payment_surcharge_percent, 12) || '0',
    paymentSurchargeFixedCents: metadataCents('payment_surcharge_fixed_cents'),
    paymentSurchargeLabel: cleanText(metadata.payment_surcharge_label, 80) || 'Card processing surcharge',
    paymentSurchargeDescription: cleanText(metadata.payment_surcharge_description, 240),
    totalPaid: session.amount_total || 0,
    currency: session.currency || 'nzd'
  };
}

export function buildBusinessOrderEmail(order) {
  const itemLines = order.items.map(item => [
    `${item.quantity} x ${item.name} - ${formatMoneyFromCents(item.amountTotal, order.currency)}`,
    ...item.details.map(detail => `  - ${detail}`)
  ].join('\n')).join('\n\n');
  const fulfilmentLines = order.fulfilmentType === 'pickup'
    ? [
        `Pickup location: ${order.pickupLocation}`,
        `Pickup address: ${order.pickupAddress || 'To be confirmed with the customer'}`,
        `Pickup instructions: ${order.pickupInstructions}`
      ]
    : [
        `Delivery address: ${order.shippingAddress || 'Not provided'}`,
        `Rural delivery: ${order.shippingRural ? 'Yes - review if required' : 'No'}`
      ];
  const fulfilmentHtml = order.fulfilmentType === 'pickup'
    ? `<p><strong>Pickup location:</strong> ${escapeHtml(order.pickupLocation)}<br><strong>Pickup address:</strong> ${escapeHtml(order.pickupAddress || 'To be confirmed with the customer')}<br><strong>Pickup instructions:</strong> ${escapeHtml(order.pickupInstructions)}</p>`
    : `<p><strong>Delivery address:</strong> ${escapeHtml(order.shippingAddress || 'Not provided')}<br><strong>Rural delivery:</strong> ${order.shippingRural ? 'Yes - review if required' : 'No'}</p>`;
  const shippingLabel = order.fulfilmentType === 'pickup' ? 'Pickup' : order.shippingMethod;
  const shippingValue = order.shippingAmount ? formatMoneyFromCents(order.shippingAmount, order.currency) : 'Free';

  const text = [
    'New paid PTG Activewear order',
    '',
    `Order number: ${order.orderNumber}`,
    `Payment status: ${order.paymentStatus}`,
    `Customer name: ${order.customerName}`,
    `Child's Name: ${order.childName || 'Not provided'}`,
    `Customer email: ${order.customerEmail}`,
    `Phone: ${order.phone || 'Not provided'}`,
    `Fulfilment method: ${order.shippingMethod}`,
    ...fulfilmentLines,
    '',
    'Items:',
    itemLines,
    '',
    `Merchandise subtotal: ${formatMoneyFromCents(order.merchandiseSubtotal, order.currency)}`,
    ...(order.discountAmount ? [`Discount (${order.promotionCode}): -${formatMoneyFromCents(order.discountAmount, order.currency)}`, `Eligible tracksuit subtotal: ${formatMoneyFromCents(order.promotionEligibleSubtotal, order.currency)}`] : []),
    `Personalisation: ${formatMoneyFromCents(order.personalisationAmount, order.currency)}`,
    `${shippingLabel}: ${shippingValue}`,
    ...(order.paymentSurchargeEnabled ? [`${order.paymentSurchargeLabel}: ${formatMoneyFromCents(order.paymentSurchargeAmount, order.currency)}`, `Surcharge configuration: ${order.paymentSurchargePercent}% + ${formatMoneyFromCents(order.paymentSurchargeFixedCents, order.currency)}`] : []),
    `Total paid: ${formatMoneyFromCents(order.totalPaid, order.currency)}`,
    '',
    'Internal Payment References',
    `Checkout Session: ${order.sessionId}`,
    `Payment Intent: ${order.paymentIntentId || 'Not provided'}`,
    `Stripe Event: ${order.eventId || 'Not provided'}`
  ].join('\n');

  const htmlItems = order.items.map(item => `
    <li>
      <strong>${escapeHtml(String(item.quantity))} x ${escapeHtml(item.name)}</strong>
      <span>${escapeHtml(formatMoneyFromCents(item.amountTotal, order.currency))}</span>
      ${item.details.length ? `<ul>${item.details.map(detail => `<li>${escapeHtml(detail)}</li>`).join('')}</ul>` : ''}
    </li>
  `).join('');

  const html = `
    <h2>New paid PTG Activewear order</h2>
    <p style="font-size:20px"><strong>Order number:</strong> ${escapeHtml(order.orderNumber)}</p>
    <p><strong>Payment status:</strong> ${escapeHtml(order.paymentStatus)}</p>
    <p><strong>Customer name:</strong> ${escapeHtml(order.customerName)}</p>
    <p><strong>Child's Name:</strong> ${escapeHtml(order.childName || 'Not provided')}</p>
    <p><strong>Customer email:</strong> ${escapeHtml(order.customerEmail)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(order.phone || 'Not provided')}</p>
    <p style="font-size:18px"><strong>Fulfilment method:</strong> ${escapeHtml(order.shippingMethod)}</p>
    ${fulfilmentHtml}
    <h3>Items</h3>
    <ul>${htmlItems}</ul>
    <p><strong>Merchandise subtotal:</strong> ${escapeHtml(formatMoneyFromCents(order.merchandiseSubtotal, order.currency))}</p>
    ${order.discountAmount ? `<p><strong>Discount (${escapeHtml(order.promotionCode)}):</strong> -${escapeHtml(formatMoneyFromCents(order.discountAmount, order.currency))}<br><strong>Eligible tracksuit subtotal:</strong> ${escapeHtml(formatMoneyFromCents(order.promotionEligibleSubtotal, order.currency))}</p>` : ''}
    <p><strong>Personalisation:</strong> ${escapeHtml(formatMoneyFromCents(order.personalisationAmount, order.currency))}</p>
    <p><strong>${escapeHtml(shippingLabel)}:</strong> ${escapeHtml(shippingValue)}</p>
    ${order.paymentSurchargeEnabled ? `<p><strong>${escapeHtml(order.paymentSurchargeLabel)}:</strong> ${escapeHtml(formatMoneyFromCents(order.paymentSurchargeAmount, order.currency))}</p><p><strong>Surcharge configuration:</strong> ${escapeHtml(order.paymentSurchargePercent)}% + ${escapeHtml(formatMoneyFromCents(order.paymentSurchargeFixedCents, order.currency))}</p>` : ''}
    <p><strong>Total paid:</strong> ${escapeHtml(formatMoneyFromCents(order.totalPaid, order.currency))}</p>
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #ddd;color:#555;font-size:12px">
      <h3>Internal Payment References</h3>
      <p>Checkout Session: ${escapeHtml(order.sessionId)}<br>Payment Intent: ${escapeHtml(order.paymentIntentId || 'Not provided')}<br>Stripe Event: ${escapeHtml(order.eventId || 'Not provided')}</p>
    </div>
  `;

  return {
    subject: `New paid PTG Activewear order ${order.orderNumber}`,
    text,
    html
  };
}

export function buildCustomerOrderEmail(order) {
  const itemLines = order.items.map(item => [
    `${item.quantity} x ${item.name}`,
    ...item.details.map(detail => `  - ${detail}`)
  ].join('\n')).join('\n\n');
  const shippingLabel = order.fulfilmentType === 'pickup' ? 'Pickup' : order.shippingMethod;
  const shippingValue = order.shippingAmount ? formatMoneyFromCents(order.shippingAmount, order.currency) : 'Free';
  const fulfilmentLines = order.fulfilmentType === 'pickup'
    ? [
        `Pickup location: ${order.pickupLocation}`,
        `Pickup address: ${order.pickupAddress || 'We will confirm the collection address with you.'}`,
        `Pickup instructions: ${order.pickupInstructions}`
      ]
    : [`Delivery address: ${order.shippingAddress || 'Not provided'}`];
  const fulfilmentHtml = order.fulfilmentType === 'pickup'
    ? `<p><strong>Pickup location:</strong> ${escapeHtml(order.pickupLocation)}<br><strong>Pickup address:</strong> ${escapeHtml(order.pickupAddress || 'We will confirm the collection address with you.')}<br><strong>Pickup instructions:</strong> ${escapeHtml(order.pickupInstructions)}</p>`
    : `<p><strong>Delivery address:</strong> ${escapeHtml(order.shippingAddress || 'Not provided')}</p>`;

  const text = [
    `Thank you for your order${order.customerName && order.customerName !== 'Not provided' ? `, ${order.customerName}` : ''}.`,
    '',
    'Your order number is:',
    order.orderNumber,
    'Please keep this order number in case you need to contact us.',
    `Order date: ${order.orderDate}`,
    `Payment status: Paid`,
    `Child's Name: ${order.childName || 'Not provided'}`,
    '',
    'Items:',
    itemLines,
    '',
    `Merchandise subtotal: ${formatMoneyFromCents(order.merchandiseSubtotal, order.currency)}`,
    ...(order.discountAmount ? [`Discount (${order.promotionCode}): -${formatMoneyFromCents(order.discountAmount, order.currency)}`] : []),
    `Personalisation: ${formatMoneyFromCents(order.personalisationAmount, order.currency)}`,
    `${shippingLabel}: ${shippingValue}`,
    ...(order.paymentSurchargeEnabled ? [`${order.paymentSurchargeLabel}: ${formatMoneyFromCents(order.paymentSurchargeAmount, order.currency)}`] : []),
    `Total paid: ${formatMoneyFromCents(order.totalPaid, order.currency)} NZD`,
    ...(order.paymentSurchargeEnabled ? ['', 'The card processing surcharge helps cover the cost of processing your payment.'] : []),
    '',
    `Fulfilment method: ${order.shippingMethod}`,
    ...fulfilmentLines,
    '',
    'We have received your payment and will be in touch with any order updates.',
    'Support: info@ptgactivewear.co.nz'
  ].join('\n');

  const html = `
    <h2>Thank you for your order</h2>
    <p>We have received your payment.</p>
    <p><strong>Your order number is:</strong><br><span style="font-size:20px">${escapeHtml(order.orderNumber)}</span></p>
    <p>Please keep this order number in case you need to contact us.</p>
    <p><strong>Order date:</strong> ${escapeHtml(order.orderDate)}<br><strong>Payment status:</strong> Paid<br><strong>Child's Name:</strong> ${escapeHtml(order.childName || 'Not provided')}</p>
    <h3>Items</h3><ul>${order.items.map(item => `<li><strong>${escapeHtml(String(item.quantity))} x ${escapeHtml(item.name)}</strong>${item.details.length ? `<ul>${item.details.map(detail => `<li>${escapeHtml(detail)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>
    <p><strong>Merchandise subtotal:</strong> ${escapeHtml(formatMoneyFromCents(order.merchandiseSubtotal, order.currency))}${order.discountAmount ? `<br><strong>Discount (${escapeHtml(order.promotionCode)}):</strong> -${escapeHtml(formatMoneyFromCents(order.discountAmount, order.currency))}` : ''}<br><strong>Personalisation:</strong> ${escapeHtml(formatMoneyFromCents(order.personalisationAmount, order.currency))}<br><strong>${escapeHtml(shippingLabel)}:</strong> ${escapeHtml(shippingValue)}${order.paymentSurchargeEnabled ? `<br><strong>${escapeHtml(order.paymentSurchargeLabel)}:</strong> ${escapeHtml(formatMoneyFromCents(order.paymentSurchargeAmount, order.currency))}` : ''}</p>
    <p><strong>Total paid:</strong> ${escapeHtml(formatMoneyFromCents(order.totalPaid, order.currency))} NZD</p>
    ${order.paymentSurchargeEnabled ? '<p>The card processing surcharge helps cover the cost of processing your payment.</p>' : ''}
    <p><strong>Fulfilment method:</strong> ${escapeHtml(order.shippingMethod)}</p>
    ${fulfilmentHtml}
    <p>We will be in touch with any order updates.</p><p>Questions? Contact <a href="mailto:info@ptgactivewear.co.nz">info@ptgactivewear.co.nz</a>.</p>
  `;

  return {
    subject: `PTG Activewear order confirmation ${order.orderNumber}`,
    text,
    html
  };
}

async function sendOrderEmails(env, session, providedLineItems = null, event = null) {
  const toEmail = cleanText(env.CONTACT_TO_EMAIL, MAX_FIELD_LENGTHS.email);
  const fromEmail = cleanText(env.CONTACT_FROM_EMAIL, MAX_FIELD_LENGTHS.email);

  if (!toEmail || !fromEmail || !env.EMAIL_API_KEY) {
    throw new Error('Order email service is not configured.');
  }

  const lineItems = providedLineItems || await fetchStripeLineItems(env, session.id);
  const order = buildOrderEmailData(session, lineItems);
  const storedOrder = env.DB ? await env.DB.prepare('SELECT order_number, child_name, created_at, stripe_event_id, stripe_payment_intent_id FROM orders WHERE stripe_checkout_session_id = ?').bind(session.id).first() : null;
  order.orderNumber = storedOrder?.order_number || 'PTG order pending';
  order.orderDate = new Date(storedOrder?.created_at || Date.now()).toLocaleDateString('en-NZ', { dateStyle: 'long', timeZone: 'Pacific/Auckland' });
  order.eventId = storedOrder?.stripe_event_id || event?.id || '';
  order.paymentIntentId = storedOrder?.stripe_payment_intent_id || order.paymentIntentId;
  order.childName = storedOrder?.child_name || order.childName;
  const businessEmail = buildBusinessOrderEmail(order);
  const emailIdempotencyKey = String(session.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 180);
  if (!emailIdempotencyKey) throw new Error('Checkout session identifier is invalid.');

  await sendWithResend(
    { ...env, CONTACT_FROM_EMAIL: fromEmail },
    {
      ...businessEmail,
      to: toEmail,
      replyTo: order.customerEmail || undefined,
      idempotencyKey: `ptg-order-business-${emailIdempotencyKey}`
    }
  );

  if (order.customerEmail) {
    const customerEmail = buildCustomerOrderEmail(order);
    await sendWithResend(
      { ...env, CONTACT_FROM_EMAIL: fromEmail },
      {
        ...customerEmail,
        to: order.customerEmail,
        replyTo: toEmail,
        idempotencyKey: `ptg-order-customer-${emailIdempotencyKey}`
      }
    );
  }
}

async function handleSuccessfulCheckoutEvent(env, event) {
  const session = event.data?.object;

  if (!session?.id) {
    throw new Error('Webhook session is missing.');
  }

  if (session.payment_status && session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    if (env.DB && String(env.INVENTORY_ENFORCEMENT || '').toLowerCase() === 'd1') {
      await markCheckoutReservationPaymentPending(env.DB, session);
    }
    return;
  }

  const useD1Inventory = Boolean(env.DB) && String(env.INVENTORY_ENFORCEMENT || '').toLowerCase() === 'd1';

  if (useD1Inventory) {
    if (!env.ORDER_EVENT_STORE) {
      throw new Error('ORDER_EVENT_STORE KV binding is required for webhook idempotency.');
    }

    const kvState = await env.ORDER_EVENT_STORE.get(event.id);
    if (kvState === 'processed') return;

    await env.ORDER_EVENT_STORE.put(event.id, 'processing', { expirationTtl: 60 * 60 * 24 * 90 });
    const lineItems = await fetchStripeLineItems(env, session.id);
    const result = await commitPaidOrder(env, event, session, lineItems);
    await env.ORDER_EVENT_STORE.put(event.id, 'inventory_committed', { expirationTtl: 60 * 60 * 24 * 90 });

    if (result.emailStatus !== 'sent') {
      try {
        await sendOrderEmails(env, session, lineItems, event);
        await markOrderEmailResult(env, result.orderId, event.id, true);
      } catch (error) {
        await markOrderEmailResult(env, result.orderId, event.id, false, error.message);
        throw error;
      }
    }

    await markWebhookEventProcessed(env, event.id);
    return;
  }

  const reserved = await reserveWebhookEvent(env, event.id);
  if (!reserved) return;

  try {
    await sendOrderEmails(env, session);
    await markWebhookEventProcessed(env, event.id);
  } catch (error) {
    await releaseWebhookEvent(env, event.id);
    throw error;
  }
}

async function handleReleasedCheckoutEvent(env, event, reason) {
  if (!env.DB || String(env.INVENTORY_ENFORCEMENT || '').toLowerCase() !== 'd1') return;
  const reserved = await reserveWebhookEvent(env, event.id);
  if (!reserved) return;
  try {
    const session = event.data?.object || {};
    const bySession = session.id
      ? await releaseCheckoutInventory(env, { sessionId: session.id, reason })
      : { released: false };
    if (!bySession.released && session.metadata?.checkout_request_id) {
      await releaseCheckoutInventory(env, { reservationId: session.metadata.checkout_request_id, reason });
    }
    await markWebhookEventProcessed(env, event.id);
  } catch (error) {
    await releaseWebhookEvent(env, event.id);
    throw error;
  }
}

async function handleStripeWebhook(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return jsonResponse({ ok: false, error: 'Webhook is not configured.' }, 503);
  }

  const parsedBody = await readLimitedText(request, STRIPE_WEBHOOK_BODY_BYTES);
  if (parsedBody.error) {
    return jsonResponse({ ok: false, error: parsedBody.error, code: parsedBody.code }, parsedBody.status);
  }
  const rawBody = parsedBody.text;
  const signatureHeader = request.headers.get('stripe-signature') || '';
  const isValid = await verifyStripeWebhookSignature(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET);

  if (!isValid) {
    return jsonResponse({ ok: false, error: 'Invalid webhook signature.' }, 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (error) {
    return jsonResponse({ ok: false, error: 'Invalid webhook payload.' }, 400);
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      await handleSuccessfulCheckoutEvent(env, event);
    } else if (event.type === 'checkout.session.async_payment_failed') {
      await handleReleasedCheckoutEvent(env, event, 'async_payment_failed');
    } else if (event.type === 'checkout.session.expired') {
      await handleReleasedCheckoutEvent(env, event, 'expired');
    } else if (event.type === 'charge.refunded') {
      const reserved = await reserveWebhookEvent(env, event.id);
      if (reserved) {
        try {
          if (env.DB) await recordStripeRefund(env, event, event.data?.object || {});
          await markWebhookEventProcessed(env, event.id);
        } catch (error) {
          await releaseWebhookEvent(env, event.id);
          throw error;
        }
      }
    }
  } catch (error) {
    console.error('Stripe webhook handling failed', event?.type, event?.id, error.message);
    return jsonResponse({ ok: false, error: 'Webhook handling failed.' }, 503);
  }

  return jsonResponse({ received: true });
}

function secureAssetResponse(response, { admin = false } = {}) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', admin ? 'same-origin' : 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://cloudflareinsights.com"
  ].join('; '));
  if (admin) {
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function serveAsset(request, env) {
  try {
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status === 500) {
      return new Response('Not found', { status: 404 });
    }

    return secureAssetResponse(assetResponse);
  } catch (error) {
    return new Response('Not found', { status: 404 });
  }
}

async function handlePublicProducts(request, env, slug = '') {
  if (request.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  }
  if (!isD1CatalogueEnabled(env)) {
    return jsonResponse({ ok: false, error: 'Database catalogue is not active.' }, 503);
  }

  try {
    if (slug) {
      const product = await getPublicProductBySlug(env, slug);
      return product
        ? jsonResponse({ ok: true, product })
        : jsonResponse({ ok: false, error: 'Product not found.' }, 404);
    }
    return jsonResponse({ ok: true, products: await getPublicProducts(env) });
  } catch (error) {
    console.error('Public catalogue request failed', { message: error.message });
    return jsonResponse({ ok: false, error: 'Products are temporarily unavailable.' }, 503);
  }
}

function unauthorisedAdminResponse(isApi) {
  if (isApi) return jsonResponse({ ok: false, error: 'Authentication is required.' }, 401);
  return new Response('Admin authentication is required.', {
    status: 401,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function serveAdminAsset(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/admin' || url.pathname === '/admin/pictures' || url.pathname === '/admin/orders'
    || url.pathname === '/admin/reports' || url.pathname === '/admin/promotions') {
    url.pathname = '/admin/';
    request = new Request(url.toString(), request);
  }
  const response = await env.ASSETS.fetch(request);
  return secureAssetResponse(response, { admin: true });
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[<>&"']/g, character => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
  }[character]));
}

function absoluteSiteUrl(value, env) {
  const base = String(env.SITE_URL || SITE_ORIGIN).replace(/\/$/, '');
  try { return new URL(String(value || ''), `${base}/`).href; } catch { return `${base}/`; }
}

async function servePublicProductPage(request, env, slug) {
  if (!isD1CatalogueEnabled(env)) return new Response('Product unavailable', { status: 503 });
  const product = await getPublicProductBySlug(env, slug);
  if (!product) return new Response('Product not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  // Cloudflare Assets serves clean HTML paths and redirects explicit .html URLs.
  const templateUrl = new URL('/product', request.url);
  const templateResponse = await env.ASSETS.fetch(new Request(templateUrl, request));
  if (!templateResponse.ok) return new Response('Product page unavailable', { status: 503 });
  const productUrl = absoluteSiteUrl(`/products/${encodeURIComponent(product.slug)}`, env);
  const productImage = absoluteSiteUrl(product.image, env);
  const title = product.seoTitle || `${product.name} | PTG Activewear`;
  const description = product.metaDescription || product.description;
  const sku = product.inventoryVariants?.[0]?.sku || product.id;
  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Product', name: product.name, description, image: product.gallery.map(image => absoluteSiteUrl(image, env)),
        sku, brand: { '@type': 'Brand', name: 'PTG Activewear' }, url: productUrl,
        offers: { '@type': 'Offer', url: productUrl, priceCurrency: product.currency, price: product.price.toFixed(2),
          availability: product.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', itemCondition: 'https://schema.org/NewCondition' }
      },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteSiteUrl('/', env) },
        { '@type': 'ListItem', position: 2, name: 'Shop', item: absoluteSiteUrl('/shop', env) },
        { '@type': 'ListItem', position: 3, name: product.name, item: productUrl }
      ] }
    ]
  }).replace(/</g, '\\u003c');
  const replacements = {
    '__PRODUCT_TITLE__': escapeHtml(title),
    '__PRODUCT_DESCRIPTION__': escapeHtml(description),
    '__PRODUCT_URL__': escapeHtml(productUrl),
    '__PRODUCT_IMAGE__': escapeHtml(productImage),
    '__PRODUCT_NAME__': escapeHtml(product.name),
    '__PRODUCT_SLUG__': escapeHtml(product.slug),
    '__PRODUCT_SCHEMA__': schema
  };
  let html = await templateResponse.text();
  for (const [placeholder, value] of Object.entries(replacements)) html = html.split(placeholder).join(value);
  return secureAssetResponse(new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } }));
}

async function merchantFeed(env) {
  if (!isD1CatalogueEnabled(env)) return new Response('Catalogue unavailable', { status: 503 });
  const products = await getPublicProducts(env);
  const items = products.map(product => `<item>
    <g:id>${xmlEscape(product.id)}</g:id>
    <title>${xmlEscape(product.name)}</title>
    <description>${xmlEscape(product.description)}</description>
    <link>${xmlEscape(absoluteSiteUrl(`/products/${encodeURIComponent(product.slug)}`, env))}</link>
    <g:image_link>${xmlEscape(absoluteSiteUrl(product.image, env))}</g:image_link>
    <g:availability>${product.available ? 'in stock' : 'out of stock'}</g:availability>
    <g:price>${product.price.toFixed(2)} ${xmlEscape(product.currency)}</g:price>
    <g:brand>PTG Activewear</g:brand>
    <g:condition>new</g:condition>
    <g:identifier_exists>no</g:identifier_exists>
  </item>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>PTG Activewear Products</title><link>${xmlEscape(absoluteSiteUrl('/shop', env))}</link><description>PTG Activewear product catalogue</description>${items}</channel></rss>`;
  return secureAssetResponse(new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=900' } }));
}

async function dynamicSitemap(env) {
  const products = isD1CatalogueEnabled(env) ? await getPublicProducts(env) : [];
  const urls = ['/', '/shop', '/about', '/contact', ...products.map(product => `/products/${encodeURIComponent(product.slug)}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(path => `<url><loc>${xmlEscape(absoluteSiteUrl(path, env))}</loc></url>`).join('')}</urlset>`;
  return secureAssetResponse(new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=900' } }));
}

function isAdminPicturesPath(pathname) {
  const path = String(pathname || '').replace(/^\/api\/admin\/?/, '');
  const segments = path.split('/').filter(Boolean);
  return segments[0] === 'pictures'
    || (segments[0] === 'products' && segments.length >= 3 && segments[2] === 'pictures');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const localDevelopmentHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const productionRequest = String(env.ENVIRONMENT || '').trim().toLowerCase() === 'production';
    if (productionRequest && url.protocol === 'http:' && !localDevelopmentHost) {
      url.protocol = 'https:';
      if (url.hostname.toLowerCase() === 'www.ptgactivewear.co.nz') url.hostname = 'ptgactivewear.co.nz';
      return Response.redirect(url, 308);
    }

    if (url.hostname.toLowerCase() === 'www.ptgactivewear.co.nz') {
      url.hostname = 'ptgactivewear.co.nz';
      return Response.redirect(url, 308);
    }

    if (url.pathname === '/api/admin/login'
      || url.pathname === '/api/admin/logout'
      || url.pathname === '/api/admin/session'
      || url.pathname.startsWith('/api/admin-auth/')) {
      return handleAdminAuth(request, env);
    }

    const publicAdminAssets = new Set([
      '/admin/login',
      '/admin/login.html',
      '/admin/login.js',
      '/admin/admin.css'
    ]);
    if (publicAdminAssets.has(url.pathname)) {
      if (url.pathname === '/admin/login' || url.pathname === '/admin/login.html') {
        let identity = null;
        try { identity = await getAdminIdentity(request, env); } catch {}
        if (identity) return Response.redirect(new URL('/admin', request.url), 302);
      }
      return serveAdminAsset(request, env);
    }

    if (url.pathname === '/api/products') {
      return handlePublicProducts(request, env);
    }

    if (url.pathname.startsWith('/api/products/')) {
      return handlePublicProducts(request, env, decodeURIComponent(url.pathname.slice('/api/products/'.length)));
    }

    if (url.pathname.startsWith('/products/') && ['GET', 'HEAD'].includes(request.method.toUpperCase())) {
      return servePublicProductPage(request, env, decodeURIComponent(url.pathname.slice('/products/'.length)));
    }

    if (url.pathname === '/product.html' || url.pathname === '/product') return Response.redirect(new URL('/shop', request.url), 302);
    if (url.pathname === '/merchant-feed.xml') return merchantFeed(env);
    if (url.pathname === '/sitemap.xml') return dynamicSitemap(env);

    if (/^\/product-images\/\d+(?:\/thumbnail)?$/.test(url.pathname) && ['GET', 'HEAD'].includes(request.method.toUpperCase())) {
      const parts = url.pathname.split('/').filter(Boolean);
      return serveProductPicture(request, env, Number(parts[1]), parts[2] === 'thumbnail');
    }

    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      let identity = null;
      try { identity = await getAdminIdentity(request, env); } catch (error) { console.error('Admin authentication failed', { message: error.message }); }
      if (identity) return serveAdminAsset(request, env);
      console.warn(JSON.stringify({ scope: 'admin_authorisation', requestId: crypto.randomUUID(), action: 'admin_page', status: 'denied', reason: 'missing_or_invalid_identity' }));
      return Response.redirect(new URL('/admin/login', request.url), 302);
    }

    if (url.pathname === '/api/admin' || url.pathname.startsWith('/api/admin/')) {
      let identity = null;
      try { identity = await getAdminIdentity(request, env); } catch (error) { console.error('Admin authentication failed', { message: error.message }); }
      if (!identity) {
        console.warn(JSON.stringify({ scope: 'admin_authorisation', requestId: crypto.randomUUID(), action: 'admin_api', status: 'denied', reason: 'missing_or_invalid_identity' }));
        return unauthorisedAdminResponse(true);
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase()) && !isAdminMutationAllowed(request, identity)) {
        return jsonResponse({ ok: false, error: 'Admin request verification failed.' }, 403);
      }
      if (isAdminPicturesPath(url.pathname)) {
        return handlePicturesApi(request, env, identity);
      }
      return handleAdminApi(request, env, identity);
    }

    if (url.pathname === '/api/contact') {
      return handleEmailRequest(request, env, 'contact');
    }

    if (url.pathname === '/api/newsletter') {
      return handleEmailRequest(request, env, 'newsletter');
    }

    if (url.pathname === '/api/training-kit-number-eligibility') {
      return handleTrainingKitNumberEligibility(request, env);
    }

    if (url.pathname === '/api/create-checkout-session') {
      return handleCreateCheckoutSession(request, env);
    }

    if (url.pathname === '/api/checkout-summary') {
      return handleCheckoutSummary(request, env);
    }

    if (url.pathname === '/api/checkout-status') {
      return handleCheckoutStatus(request, env);
    }

    if (url.pathname === '/api/stripe-webhook') {
      return handleStripeWebhook(request, env);
    }

    return serveAsset(request, env);
  }
};
