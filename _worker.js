import { getAdminIdentity, handleAdminAuth, isAdminMutationAllowed } from './worker/auth.js';
import { handleAdminApi } from './worker/admin-api.js';
import { getPublicProductBySlug, getPublicProducts, isD1CatalogueEnabled } from './worker/catalog.js';
import { commitPaidOrder, markOrderEmailResult, validateD1CheckoutPayload } from './worker/inventory.js';
import { handlePicturesApi, serveProductPicture } from './worker/pictures.js';

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

// Temporary test-mode shipping setup. Change this amount when final NZ shipping is approved.
const NZ_SHIPPING_RATE = {
  displayName: 'New Zealand shipping (test)',
  amountNzdCents: 0
};

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
  'X-Content-Type-Options': 'nosniff'
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders
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
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.EMAIL_API_KEY}`,
      'Content-Type': 'application/json'
    },
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
    const body = await response.text();
    throw new Error(`Resend failed with ${response.status}: ${body}`);
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (error) {
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

  const payload = await readJson(request);
  if (!payload) {
    return jsonResponse({ ok: false, error: 'Invalid JSON payload.' }, 400);
  }

  const validation = type === 'contact'
    ? validateContactPayload(payload)
    : validateNewsletterPayload(payload);

  if (validation.error) {
    return jsonResponse({ ok: false, error: validation.error }, 400);
  }

  const provider = String(env.EMAIL_PROVIDER || 'resend').toLowerCase();
  const toEmail = cleanText(env.CONTACT_TO_EMAIL, MAX_FIELD_LENGTHS.email);
  const fromEmail = cleanText(env.CONTACT_FROM_EMAIL, MAX_FIELD_LENGTHS.email);

  if (!toEmail || !fromEmail || !env.EMAIL_API_KEY) {
    return jsonResponse({ ok: false, error: 'Email service is not configured.' }, 503);
  }

  const emailData = type === 'contact'
    ? buildContactEmail(validation, toEmail)
    : buildNewsletterEmail(validation, toEmail);

  try {
    if (provider === 'resend') {
      await sendWithResend({ ...env, CONTACT_FROM_EMAIL: fromEmail }, emailData);
    } else {
      return jsonResponse({ ok: false, error: `Unsupported email provider: ${provider}` }, 503);
    }
  } catch (error) {
    console.error(`${type} email send failed`, error.message);
    return jsonResponse({ ok: false, error: 'Email could not be sent.' }, 502);
  }

  return jsonResponse({ ok: true });
}

function requireJsonRequest(request) {
  const contentType = request.headers.get('content-type') || '';
  return contentType.toLowerCase().includes('application/json');
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

  return { productId, quantity, size, variant, playerName, playerNumber, variantId: null, cartItemKey: '' };
}

function validateCheckoutPayload(payload) {
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

    if (item.playerName && !/^[A-Za-z0-9 .'-]{1,20}$/.test(item.playerName)) {
      return { error: `Please use letters, numbers, spaces, apostrophes, hyphens, or full stops for the player name on ${product.name}.` };
    }

    if (item.playerNumber && !/^(?:0|00|[1-9][0-9]?)$/.test(item.playerNumber)) {
      return { error: `Please enter a player number from 0 to 99 for ${product.name}.` };
    }

    const nameAddOn = product.personalisable && item.playerName ? PERSONALISATION_ADDON_NZD_CENTS : 0;
    const numberAddOn = product.personalisable && item.playerNumber ? PERSONALISATION_ADDON_NZD_CENTS : 0;

    checkedItems.push({
      ...item,
      product,
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
  if (item.playerNumber) details.push(`Player number: ${item.playerNumber}`);
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

function buildStripeLineItems(validatedItems) {
  const lines = [];

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
      item_kind: 'base_product'
    };

    lines.push({
      name: item.product.name,
      description: optionDescription,
      unitAmount: item.product.unitAmountNzdCents,
      quantity: item.quantity,
      metadata: baseMetadata
    });

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
        name: `${item.product.name} - Player Number Add-on`,
        description: `Player number: ${item.playerNumber}`,
        unitAmount: item.numberAddOn,
        quantity: item.quantity,
        metadata: { ...baseMetadata, item_kind: 'player_number_addon' }
      });
    }
  });

  return lines;
}

async function createStripeCheckoutSession(env, sessionParams) {
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_API_VERSION
    },
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
    throw new Error('Stripe session creation failed.');
  }

  return body;
}

async function handleCreateCheckoutSession(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: jsonHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  }

  if (!requireJsonRequest(request)) {
    return jsonResponse({ ok: false, error: 'JSON content type is required.' }, 415);
  }

  if (String(env.CHECKOUT_ENABLED || 'true').toLowerCase() !== 'true') {
    return jsonResponse({ ok: false, error: 'Checkout is temporarily unavailable.' }, 503);
  }

  const payload = await readJson(request);
  const useD1Inventory = Boolean(env.DB) && String(env.INVENTORY_ENFORCEMENT || '').toLowerCase() === 'd1';
  const validation = useD1Inventory
    ? await validateD1CheckoutPayload(payload, env)
    : validateCheckoutPayload(payload);

  if (validation.error) {
    return jsonResponse({ ok: false, error: validation.error }, 400);
  }

  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({ ok: false, error: 'Checkout is not configured yet.' }, 503);
  }

  const siteUrl = getApprovedSiteUrl(request, env);
  const lineItems = buildStripeLineItems(validation.items);
  const params = new URLSearchParams();

  params.append('mode', 'payment');
  params.append('success_url', `${siteUrl}/order-success?session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${siteUrl}/cart?checkout=cancelled`);
  params.append('billing_address_collection', 'required');
  params.append('customer_creation', 'if_required');
  params.append('phone_number_collection[enabled]', 'true');
  params.append('shipping_address_collection[allowed_countries][0]', 'NZ');
  params.append('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
  params.append('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(NZ_SHIPPING_RATE.amountNzdCents));
  params.append('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'nzd');
  params.append('shipping_options[0][shipping_rate_data][display_name]', NZ_SHIPPING_RATE.displayName);
  params.append('metadata[source]', 'ptgactivewear.co.nz');
  params.append('metadata[shipping_setup]', `${NZ_SHIPPING_RATE.displayName}: ${NZ_SHIPPING_RATE.amountNzdCents}`);

  lineItems.forEach((line, index) => appendStripeLineItem(params, index, line));

  try {
    const session = await createStripeCheckoutSession(env, params);
    return jsonResponse({ ok: true, url: session.url });
  } catch (error) {
    return jsonResponse({ ok: false, error: 'Checkout could not be started. Please try again.' }, 502);
  }
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
  if (metadata.player_number) details.push(`Player number: ${metadata.player_number}`);
  if (metadata.item_kind && metadata.item_kind !== 'base_product') details.push(`Charge: ${metadata.item_kind.replace(/_/g, ' ')}`);

  return {
    name: item.description || product.name || 'PTG Activewear item',
    quantity: item.quantity || 1,
    amountTotal: item.amount_total || 0,
    details
  };
}

function buildOrderEmailData(session, lineItems) {
  const customer = session.customer_details || {};
  const shipping = session.shipping_details || {};
  const shippingAddress = shipping.address || customer.address || {};
  const items = lineItems.map(describeStripeLineItem);

  return {
    sessionId: session.id,
    paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || '',
    paymentStatus: session.payment_status,
    customerName: customer.name || shipping.name || 'Not provided',
    customerEmail: customer.email || session.customer_email || '',
    phone: customer.phone || '',
    shippingAddress: formatStripeAddress(shippingAddress),
    items,
    shippingAmount: session.total_details?.amount_shipping || 0,
    totalPaid: session.amount_total || 0,
    currency: session.currency || 'nzd'
  };
}

function buildBusinessOrderEmail(order) {
  const itemLines = order.items.map(item => [
    `${item.quantity} x ${item.name} - ${formatMoneyFromCents(item.amountTotal, order.currency)}`,
    ...item.details.map(detail => `  - ${detail}`)
  ].join('\n')).join('\n\n');

  const text = [
    'New paid PTG Activewear order',
    '',
    `Order number: ${order.orderNumber}`,
    `Payment status: ${order.paymentStatus}`,
    `Customer name: ${order.customerName}`,
    `Customer email: ${order.customerEmail}`,
    `Phone: ${order.phone || 'Not provided'}`,
    `Shipping address: ${order.shippingAddress || 'Not provided'}`,
    '',
    'Items:',
    itemLines,
    '',
    `Shipping: ${formatMoneyFromCents(order.shippingAmount, order.currency)}`,
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
    <p><strong>Customer email:</strong> ${escapeHtml(order.customerEmail)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(order.phone || 'Not provided')}</p>
    <p><strong>Shipping address:</strong> ${escapeHtml(order.shippingAddress || 'Not provided')}</p>
    <h3>Items</h3>
    <ul>${htmlItems}</ul>
    <p><strong>Shipping:</strong> ${escapeHtml(formatMoneyFromCents(order.shippingAmount, order.currency))}</p>
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

function buildCustomerOrderEmail(order) {
  const itemLines = order.items.map(item => [
    `${item.quantity} x ${item.name}`,
    ...item.details.map(detail => `  - ${detail}`)
  ].join('\n')).join('\n\n');

  const text = [
    `Thank you for your order${order.customerName && order.customerName !== 'Not provided' ? `, ${order.customerName}` : ''}.`,
    '',
    'Your order number is:',
    order.orderNumber,
    'Please keep this order number in case you need to contact us.',
    `Order date: ${order.orderDate}`,
    `Payment status: Paid`,
    `Total paid: ${formatMoneyFromCents(order.totalPaid, order.currency)}`,
    '',
    'Items:',
    itemLines,
    '',
    `Shipping: ${formatMoneyFromCents(order.shippingAmount, order.currency)}`,
    `Shipping address: ${order.shippingAddress || 'Not provided'}`,
    '',
    'We have received your payment and will be in touch with any order updates.',
    'Support: info@ptgactivewear.co.nz'
  ].join('\n');

  const html = `
    <h2>Thank you for your order</h2>
    <p>We have received your payment.</p>
    <p><strong>Your order number is:</strong><br><span style="font-size:20px">${escapeHtml(order.orderNumber)}</span></p>
    <p>Please keep this order number in case you need to contact us.</p>
    <p><strong>Order date:</strong> ${escapeHtml(order.orderDate)}<br><strong>Payment status:</strong> Paid</p>
    <h3>Items</h3><ul>${order.items.map(item => `<li><strong>${escapeHtml(String(item.quantity))} x ${escapeHtml(item.name)}</strong>${item.details.length ? `<ul>${item.details.map(detail => `<li>${escapeHtml(detail)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>
    <p><strong>Shipping:</strong> ${escapeHtml(formatMoneyFromCents(order.shippingAmount, order.currency))}<br><strong>Shipping address:</strong> ${escapeHtml(order.shippingAddress || 'Not provided')}</p>
    <p><strong>Total paid:</strong> ${escapeHtml(formatMoneyFromCents(order.totalPaid, order.currency))}</p>
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
  const storedOrder = env.DB ? await env.DB.prepare('SELECT order_number, created_at, stripe_event_id, stripe_payment_intent_id FROM orders WHERE stripe_checkout_session_id = ?').bind(session.id).first() : null;
  order.orderNumber = storedOrder?.order_number || 'PTG order pending';
  order.orderDate = new Date(storedOrder?.created_at || Date.now()).toLocaleDateString('en-NZ', { dateStyle: 'long', timeZone: 'Pacific/Auckland' });
  order.eventId = storedOrder?.stripe_event_id || event?.id || '';
  order.paymentIntentId = storedOrder?.stripe_payment_intent_id || order.paymentIntentId;
  const businessEmail = buildBusinessOrderEmail(order);

  await sendWithResend(
    { ...env, CONTACT_FROM_EMAIL: fromEmail },
    { ...businessEmail, to: toEmail, replyTo: order.customerEmail || undefined }
  );

  if (order.customerEmail) {
    const customerEmail = buildCustomerOrderEmail(order);
    await sendWithResend(
      { ...env, CONTACT_FROM_EMAIL: fromEmail },
      { ...customerEmail, to: order.customerEmail, replyTo: toEmail }
    );
  }
}

async function handleSuccessfulCheckoutEvent(env, event) {
  const session = event.data?.object;

  if (!session?.id) {
    throw new Error('Webhook session is missing.');
  }

  if (session.payment_status && session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
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

async function handleStripeWebhook(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return jsonResponse({ ok: false, error: 'Webhook is not configured.' }, 503);
  }

  const rawBody = await request.text();
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
      console.log('Stripe async payment failed', event.id);
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
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'"
  ].join('; '));
  if (admin) headers.set('Cache-Control', 'no-store');
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
  if (url.pathname === '/admin' || url.pathname === '/admin/pictures') {
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

    if (url.pathname.startsWith('/api/admin-auth/')) {
      return handleAdminAuth(request, env);
    }

    const publicAdminAssets = new Set([
      '/admin/login',
      '/admin/login.html',
      '/admin/login.js',
      '/admin/admin.css'
    ]);
    if (publicAdminAssets.has(url.pathname)) {
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
      return identity ? serveAdminAsset(request, env) : Response.redirect(new URL('/admin/login', request.url), 302);
    }

    if (url.pathname === '/api/admin' || url.pathname.startsWith('/api/admin/')) {
      let identity = null;
      try { identity = await getAdminIdentity(request, env); } catch (error) { console.error('Admin authentication failed', { message: error.message }); }
      if (!identity) return unauthorisedAdminResponse(true);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase()) && !isAdminMutationAllowed(request)) {
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

    if (url.pathname === '/api/create-checkout-session') {
      return handleCreateCheckoutSession(request, env);
    }

    if (url.pathname === '/api/stripe-webhook') {
      return handleStripeWebhook(request, env);
    }

    return serveAsset(request, env);
  }
};
