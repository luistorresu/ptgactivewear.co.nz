const MAX_ITEM_QUANTITY = 20;

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

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
      return { error: 'A cart item has an invalid quantity.' };
    }
    if (!Number.isInteger(variantId) || variantId < 1) {
      return { error: 'Please refresh the shop and choose an available product option.' };
    }

    const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first();
    if (!product || !product.active || !product.available_for_sale) {
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
    if (!product.allow_player_name && playerName) return { error: `${product.name} does not support player names.` };
    if (!product.allow_player_number && playerNumber) return { error: `${product.name} does not support player numbers.` };
    if (!playerNameIsValid(playerName)) return { error: `The player name for ${product.name} contains unsupported characters.` };
    if (!playerNumberIsValid(playerNumber)) return { error: `Please enter a player number from 0 to 99 for ${product.name}.` };

    const nameAddOn = product.allow_player_name && playerName ? product.player_name_price_cents : 0;
    const numberAddOn = product.allow_player_number && playerNumber ? product.player_number_price_cents : 0;
    checkedItems.push({
      productId,
      variantId,
      quantity,
      size: variant.size,
      variant: [variant.colour, variant.style].filter(Boolean).join(' / '),
      playerName,
      playerNumber,
      nameAddOn,
      numberAddOn,
      cartItemKey: crypto.randomUUID(),
      product: {
        id: product.id,
        name: product.name,
        unitAmountNzdCents: product.price_cents,
        personalisable: Boolean(product.allow_player_name || product.allow_player_number)
      },
      sku: variant.sku,
      stockStatus: product.track_inventory && variant.stock_quantity <= threshold ? 'low_stock' : 'in_stock'
    });
  }

  return { items: checkedItems };
}

function lineMetadata(lineItem) {
  return lineItem?.price?.product?.metadata || {};
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

function sessionAddress(session) {
  const shipping = session.shipping_details || session.collected_information?.shipping_details || {};
  return shipping.address || session.customer_details?.address || {};
}

async function existingOrder(db, sessionId) {
  return db.prepare('SELECT id, email_status FROM orders WHERE stripe_checkout_session_id = ?').bind(sessionId).first();
}

export async function commitPaidOrder(env, event, session, lineItems) {
  const existing = await existingOrder(env.DB, session.id);
  if (existing) return { orderId: existing.id, duplicate: true, emailStatus: existing.email_status };

  const groups = groupStripeItems(lineItems);
  if (!groups.length) throw new Error('Paid order has no recognised inventory line items.');

  const catalogue = [];
  for (const group of groups) {
    const row = await env.DB.prepare(`
      SELECT p.id AS product_id, p.name, p.price_cents, p.active AS product_active,
             p.available_for_sale, p.track_inventory,
             v.id AS variant_id, v.sku, v.stock_quantity, v.active AS variant_active
      FROM products p JOIN product_variants v ON v.product_id = p.id
      WHERE p.id = ? AND v.id = ?
    `).bind(group.productId, group.variantId).first();
    if (!row) throw new Error(`Order inventory record is missing for ${group.productId}.`);
    catalogue.push({ ...group, ...row });
  }

  const customer = session.customer_details || {};
  const personalisationCents = catalogue.reduce((sum, item) => sum + item.customisationAmountTotal, 0);
  const statements = [
    env.DB.prepare(`
      INSERT INTO stripe_events (event_id, event_type, stripe_checkout_session_id, status)
      VALUES (?, ?, ?, 'processing')
    `).bind(event.id, event.type, session.id),
    env.DB.prepare(`
      INSERT INTO orders (
        stripe_checkout_session_id, stripe_payment_intent_id, stripe_event_id,
        customer_name, customer_email, customer_phone, shipping_address_json,
        subtotal_cents, shipping_cents, total_cents, currency, payment_status,
        fulfilment_status, email_status, billing_address_json, payment_date,
        personalisation_cents, discount_cents, tax_cents, refund_status, payment_method_label
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', 'pending', ?, CURRENT_TIMESTAMP, ?, ?, ?, 'not_refunded', ?)
    `).bind(
      session.id,
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
      event.id,
      cleanText(customer.name || session.shipping_details?.name, 200),
      cleanText(customer.email || session.customer_email, 254),
      cleanText(customer.phone, 50),
      JSON.stringify(sessionAddress(session)),
      Number(session.amount_subtotal || 0),
      Number(session.total_details?.amount_shipping || 0),
      Number(session.amount_total || 0),
      String(session.currency || 'nzd').toUpperCase(),
      cleanText(session.payment_status || 'paid', 30),
      JSON.stringify(customer.address || {}),
      personalisationCents,
      Number(session.total_details?.amount_discount || 0),
      Number(session.total_details?.amount_tax || 0),
      cleanText(Array.isArray(session.payment_method_types) ? session.payment_method_types.join(', ') : '', 100)
    )
  ];

  for (const item of catalogue) {
    const operationId = `${event.id}:${item.key}`.slice(0, 240);
    const unitPrice = Math.round(item.baseAmountTotal / item.quantity);
    const customisationPerUnit = Math.round(item.customisationAmountTotal / item.quantity);
    statements.push(
      env.DB.prepare(`
        INSERT INTO order_items (
          order_id, product_id, variant_id, product_name, sku, quantity,
          unit_price_cents, player_name, player_number, customisation_total_cents, item_total_cents,
          size, colour, style
        )
        SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM orders WHERE stripe_checkout_session_id = ?
      `).bind(
        item.productId, item.variantId, item.name, item.sku, item.quantity,
        unitPrice, item.playerName, item.playerNumber,
        customisationPerUnit, item.baseAmountTotal + item.customisationAmountTotal,
        item.size, item.colour, item.style, session.id
      )
    );

    if (item.track_inventory) {
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
  return { orderId: order.id, duplicate: false, emailStatus: order.email_status };
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
