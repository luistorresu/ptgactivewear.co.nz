const PRODUCT_FIELDS = new Set([
  'slug', 'name', 'description', 'category', 'productType', 'badge', 'priceCents', 'currency', 'seoTitle', 'metaDescription', 'active',
  'availableForSale', 'featured', 'trackInventory', 'allowPlayerName',
  'allowPlayerNumber', 'playerNamePriceCents', 'playerNumberPriceCents', 'version'
]);
const CREATE_PRODUCT_FIELDS = new Set([...PRODUCT_FIELDS, 'variants']);
const VARIANT_FIELDS = new Set(['sku', 'size', 'colour', 'style', 'active', 'allowPlayerName', 'allowPlayerNumber', 'version']);
const FULFILMENT_STATUSES = new Set(['unfulfilled', 'paid', 'processing', 'ready_for_collection', 'shipped', 'completed', 'cancelled', 'refunded']);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function csvCell(value) {
  let text = String(value ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvResponse(filename, headers, rows) {
  const csv = `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  return new Response(csv, { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  } });
}

function exportDate() {
  return new Date().toISOString().slice(0, 10);
}

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function booleanInteger(value) {
  return value === true || value === 1 ? 1 : value === false || value === 0 ? 0 : null;
}

function rejectUnknownFields(body, allowed) {
  return Object.keys(body).find(key => !allowed.has(key));
}

async function readBody(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 64 * 1024) return { error: 'Request body is too large.' };
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'A JSON object is required.' };
    return { body };
  } catch (error) {
    return { error: 'Invalid JSON payload.' };
  }
}

function mapProduct(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    productType: row.product_type,
    badge: row.badge,
    priceCents: row.price_cents,
    currency: row.currency,
    seoTitle: row.seo_title || '',
    metaDescription: row.meta_description || '',
    active: Boolean(row.active),
    availableForSale: Boolean(row.available_for_sale),
    featured: Boolean(row.featured),
    archived: Boolean(row.archived),
    trackInventory: Boolean(row.track_inventory),
    allowPlayerName: Boolean(row.allow_player_name),
    allowPlayerNumber: Boolean(row.allow_player_number),
    playerNamePriceCents: row.player_name_price_cents,
    playerNumberPriceCents: row.player_number_price_cents,
    version: row.version,
    totalStock: Number(row.total_stock || 0),
    variantCount: Number(row.variant_count || 0),
    primaryImage: row.primary_image || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapVariant(row) {
  return {
    id: row.id,
    productId: row.product_id,
    sku: row.sku,
    size: row.size,
    colour: row.colour,
    style: row.style,
    stockQuantity: row.stock_quantity,
    active: Boolean(row.active),
    allowPlayerName: row.allow_player_name === null || row.allow_player_name === undefined ? null : Boolean(row.allow_player_name),
    allowPlayerNumber: row.allow_player_number === null || row.allow_player_number === undefined ? null : Boolean(row.allow_player_number),
    version: row.version,
    updatedAt: row.updated_at
  };
}

async function audit(db, identity, action, entityType, entityId, summary = '') {
  await db.prepare(`
    INSERT INTO admin_audit_log (admin_email, action, entity_type, entity_id, summary)
    VALUES (?, ?, ?, ?, ?)
  `).bind(identity.email, action, entityType, String(entityId), cleanText(summary, 500)).run();
}

async function listProducts(db) {
  const result = await db.prepare(`
    SELECT p.*,
      COALESCE(SUM(CASE WHEN v.active = 1 THEN v.stock_quantity ELSE 0 END), 0) AS total_stock,
      COUNT(v.id) AS variant_count,
      (SELECT COALESCE(NULLIF(delivery_url, ''), path) FROM product_images WHERE product_id = p.id AND active = 1 ORDER BY is_primary DESC, sort_order, id LIMIT 1) AS primary_image
    FROM products p
    LEFT JOIN product_variants v ON v.product_id = p.id
    GROUP BY p.id
    ORDER BY p.name
  `).all();
  return (result.results || []).map(mapProduct);
}

async function getProduct(db, productId) {
  const row = await db.prepare(`
    SELECT p.*,
      COALESCE(SUM(CASE WHEN v.active = 1 THEN v.stock_quantity ELSE 0 END), 0) AS total_stock,
      COUNT(v.id) AS variant_count,
      (SELECT COALESCE(NULLIF(delivery_url, ''), path) FROM product_images WHERE product_id = p.id AND active = 1 ORDER BY is_primary DESC, sort_order, id LIMIT 1) AS primary_image
    FROM products p
    LEFT JOIN product_variants v ON v.product_id = p.id
    WHERE p.id = ?
    GROUP BY p.id
  `).bind(productId).first();
  if (!row) return null;

  const [variantResult, imageResult] = await Promise.all([
    db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY id').bind(productId).all(),
    db.prepare("SELECT id, COALESCE(NULLIF(delivery_url, ''), path) AS path, alt_text, sort_order, is_primary, variant_style FROM product_images WHERE product_id = ? AND active = 1 ORDER BY is_primary DESC, sort_order, id").bind(productId).all()
  ]);
  return {
    ...mapProduct(row),
    variants: (variantResult.results || []).map(mapVariant),
    images: (imageResult.results || []).map(image => ({
      id: image.id,
      path: image.path,
      altText: image.alt_text,
      sortOrder: image.sort_order,
      isPrimary: Boolean(image.is_primary),
      variantStyle: image.variant_style || ''
    }))
  };
}

async function dashboard(db, threshold) {
  const [summary, orders, movements] = await Promise.all([
    db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM products WHERE active = 1) AS active_products,
        (SELECT COUNT(*) FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.active = 1 AND p.track_inventory = 1 AND v.active = 1 AND v.stock_quantity BETWEEN 1 AND ?) AS low_stock_variants,
        (SELECT COUNT(*) FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.active = 1 AND p.track_inventory = 1 AND v.active = 1 AND v.stock_quantity <= 0) AS out_of_stock_variants,
        (SELECT COUNT(*) FROM orders WHERE payment_status = 'paid') AS paid_orders,
        (SELECT COALESCE(SUM(total_cents), 0) FROM orders WHERE payment_status = 'paid' AND date(payment_date, 'localtime') = date('now', 'localtime')) AS sales_today,
        (SELECT COALESCE(SUM(total_cents), 0) FROM orders WHERE payment_status = 'paid' AND strftime('%Y-%m', payment_date) = strftime('%Y-%m', 'now')) AS sales_month,
        (SELECT COUNT(*) FROM orders WHERE payment_status = 'paid' AND fulfilment_status NOT IN ('completed', 'cancelled', 'refunded')) AS awaiting_fulfilment
    `).bind(threshold).first(),
    db.prepare('SELECT id, order_number, stripe_checkout_session_id, customer_name, customer_email, total_cents, currency, payment_status, fulfilment_status, invoice_number, created_at FROM orders ORDER BY created_at DESC LIMIT 6').all(),
    db.prepare(`
      SELECT sm.id, sm.change_quantity, sm.quantity_before, sm.quantity_after, sm.reason, sm.changed_by, sm.created_at,
             pv.sku, p.name AS product_name
      FROM stock_movements sm
      JOIN product_variants pv ON pv.id = sm.product_variant_id
      JOIN products p ON p.id = pv.product_id
      ORDER BY sm.created_at DESC, sm.id DESC LIMIT 8
    `).all()
  ]);
  return {
    summary: {
      activeProducts: Number(summary?.active_products || 0),
      lowStockVariants: Number(summary?.low_stock_variants || 0),
      outOfStockVariants: Number(summary?.out_of_stock_variants || 0),
      paidOrders: Number(summary?.paid_orders || 0)
      ,salesTodayCents: Number(summary?.sales_today || 0)
      ,salesMonthCents: Number(summary?.sales_month || 0)
      ,awaitingFulfilment: Number(summary?.awaiting_fulfilment || 0)
    },
    recentOrders: orders.results || [],
    recentMovements: movements.results || []
  };
}

function validateProduct(body, requireVersion = true, allowedFields = PRODUCT_FIELDS) {
  const unknown = rejectUnknownFields(body, allowedFields);
  if (unknown) return { error: `Unknown field: ${unknown}.` };
  const version = Number(body.version);
  const priceCents = Number(body.priceCents);
  const slug = productSlug(body.slug || body.name);
  const currency = cleanText(body.currency || 'NZD', 3).toUpperCase();
  if (requireVersion && (!Number.isInteger(version) || version < 1)) return { error: 'A valid product version is required.' };
  if (!cleanText(body.name, 140)) return { error: 'Product name is required.' };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { error: 'Slug must use lowercase letters, numbers, and single hyphens.' };
  if (currency !== 'NZD') return { error: 'Currency must be NZD for the current checkout configuration.' };
  if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 100000000) return { error: 'Price must be a valid amount in cents.' };

  const booleans = ['active', 'availableForSale', 'featured', 'trackInventory', 'allowPlayerName', 'allowPlayerNumber'];
  const mappedBooleans = {};
  for (const field of booleans) {
    const value = booleanInteger(body[field]);
    if (value === null) return { error: `${field} must be true or false.` };
    mappedBooleans[field] = value;
  }

  const namePrice = Number(body.playerNamePriceCents);
  const numberPrice = Number(body.playerNumberPriceCents);
  if (!Number.isInteger(namePrice) || namePrice < 0) return { error: 'Player name price is invalid.' };
  if (!Number.isInteger(numberPrice) || numberPrice < 0) return { error: 'Player number price is invalid.' };

  return {
    value: {
      name: cleanText(body.name, 140),
      slug,
      description: cleanText(body.description, 4000),
      category: cleanText(body.category, 80),
      productType: cleanText(body.productType, 80),
      badge: cleanText(body.badge, 60),
      priceCents,
      currency,
      seoTitle: cleanText(body.seoTitle, 160),
      metaDescription: cleanText(body.metaDescription, 320),
      version: requireVersion ? version : 1,
      playerNamePriceCents: namePrice,
      playerNumberPriceCents: numberPrice,
      ...mappedBooleans
    }
  };
}

function productSlug(value) {
  const slug = cleanText(value, 140)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '');
  return slug || `product-${crypto.randomUUID().slice(0, 8)}`;
}

async function availableProductId(db, name) {
  const base = productSlug(name);
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const existing = await db.prepare('SELECT id FROM products WHERE id = ? OR slug = ?').bind(candidate, candidate).first();
    if (!existing) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

async function createProduct(db, body, identity) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const validation = validateProduct(body, false, CREATE_PRODUCT_FIELDS);
  if (validation.error) return json({ ok: false, error: validation.error }, 400);
  const value = validation.value;
  const variants = Array.isArray(body.variants) ? body.variants : [];
  if (variants.length > 100) return json({ ok: false, error: 'A product can have no more than 100 variants.' }, 400);
  if (value.active && value.availableForSale && !variants.length) return json({ ok: false, error: 'Add at least one variant before publishing a new product.' }, 400);
  const validatedVariants = [];
  const seenSkus = new Set();
  const seenOptions = new Set();
  for (const [index, variant] of variants.entries()) {
    if (!variant || typeof variant !== 'object' || Array.isArray(variant)) return json({ ok: false, error: `Variant ${index + 1} is invalid.` }, 400);
    const unknown = rejectUnknownFields(variant, new Set([...VARIANT_FIELDS, 'stockQuantity']));
    if (unknown) return json({ ok: false, error: `Variant ${index + 1} has an unknown field: ${unknown}.` }, 400);
    const { stockQuantity: ignoredStockQuantity, ...variantFields } = variant;
    const validationResult = validateVariant(variantFields, false);
    if (validationResult.error) return json({ ok: false, error: `Variant ${index + 1}: ${validationResult.error}` }, 400);
    const stockQuantity = Number(variant.stockQuantity || 0);
    if (!Number.isInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 1000000) return json({ ok: false, error: `Variant ${index + 1}: starting stock must be a non-negative whole number.` }, 400);
    const optionKey = [validationResult.value.size, validationResult.value.colour, validationResult.value.style].join('\u0000').toLowerCase();
    if (seenSkus.has(validationResult.value.sku)) return json({ ok: false, error: `Duplicate SKU in this product: ${validationResult.value.sku}.` }, 409);
    if (seenOptions.has(optionKey)) return json({ ok: false, error: `Variant ${index + 1} duplicates another size, colour, and style combination.` }, 409);
    seenSkus.add(validationResult.value.sku);
    seenOptions.add(optionKey);
    validatedVariants.push({ ...validationResult.value, stockQuantity });
  }
  const productId = value.slug;
  const existing = await db.prepare('SELECT id FROM products WHERE id = ? OR slug = ?').bind(productId, value.slug).first();
  if (existing) return json({ ok: false, error: 'That product slug is already in use.' }, 409);
  if (seenSkus.size) {
    const placeholders = [...seenSkus].map(() => '?').join(', ');
    const duplicate = await db.prepare(`SELECT sku FROM product_variants WHERE sku IN (${placeholders}) LIMIT 1`).bind(...seenSkus).first();
    if (duplicate) return json({ ok: false, error: `SKU already exists: ${duplicate.sku}.` }, 409);
  }

  try {
    const statements = [
      db.prepare(`
        INSERT INTO products (
          id, slug, name, description, category, product_type, badge, price_cents, currency,
          active, available_for_sale, featured, track_inventory,
          allow_player_name, allow_player_number, player_name_price_cents, player_number_price_cents,
          seo_title, meta_description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        productId, value.slug, value.name, value.description, value.category, value.productType,
        value.badge, value.priceCents, value.currency, value.featured, value.trackInventory, value.allowPlayerName,
        value.allowPlayerNumber, value.playerNamePriceCents, value.playerNumberPriceCents, value.seoTitle, value.metaDescription
      )
    ];
    for (const variant of validatedVariants) {
      statements.push(db.prepare(`INSERT INTO product_variants
        (product_id, sku, size, colour, style, stock_quantity, active, allow_player_name, allow_player_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(productId, variant.sku, variant.size, variant.colour, variant.style, variant.stockQuantity,
          variant.active, variant.allowPlayerName, variant.allowPlayerNumber));
      if (variant.stockQuantity > 0) statements.push(db.prepare(`INSERT INTO stock_movements
        (product_variant_id, change_quantity, quantity_before, quantity_after, reason, reference_type, reference_id, changed_by)
        SELECT id, ?, 0, ?, 'Initial stock', 'product_create', ?, ? FROM product_variants WHERE product_id = ? AND sku = ?`)
        .bind(variant.stockQuantity, variant.stockQuantity, productId, identity.email, productId, variant.sku));
    }
    statements.push(
      db.prepare(`
        INSERT INTO admin_audit_log (admin_email, action, entity_type, entity_id, summary)
        VALUES (?, 'create', 'product', ?, ?)
      `).bind(identity.email, productId, `Created draft product with ${validatedVariants.length} variant(s): ${value.name}`)
    );
    await db.batch(statements);
    console.log(JSON.stringify({ scope: 'admin_product', requestId, admin: identity.email, productId, action: 'create', status: 'succeeded', variants: validatedVariants.length, publishRequested: Boolean(value.active && value.availableForSale), durationMs: Date.now() - startedAt }));
    return json({ ok: true, product: await getProduct(db, productId), publishRequested: Boolean(value.active && value.availableForSale) }, 201);
  } catch (error) {
    console.log(JSON.stringify({ scope: 'admin_product', requestId, admin: identity.email, productId, action: 'create', status: 'failed', errorCode: 'DATABASE_WRITE_FAILED', durationMs: Date.now() - startedAt }));
    return json({ ok: false, error: 'A product with that name or URL already exists. Try a more specific name.' }, 409);
  }
}

async function productLifecycle(db, productId, body, identity) {
  const requestId = identity.requestId || crypto.randomUUID();
  const startedAt = Date.now();
  const unknown = rejectUnknownFields(body, new Set(['action']));
  if (unknown) return json({ ok: false, error: `Unknown field: ${unknown}.` }, 400);
  const action = cleanText(body.action, 20).toLowerCase();
  if (!['enable', 'disable', 'archive', 'restore', 'delete'].includes(action)) {
    return json({ ok: false, error: 'Choose enable, disable, archive, restore, or delete.' }, 400);
  }
  const product = await db.prepare('SELECT id, name FROM products WHERE id = ?').bind(productId).first();
  if (!product) return json({ ok: false, error: 'Product not found.' }, 404);

  if (action === 'enable') {
    const readiness = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM product_variants WHERE product_id = ? AND active = 1) AS variants,
      (SELECT COUNT(*) FROM product_images WHERE product_id = ? AND active = 1) AS pictures
    `).bind(productId, productId).first();
    if (!Number(readiness?.variants) || !Number(readiness?.pictures)) {
      return json({ ok: false, error: 'Add at least one active variant and one picture before enabling this product.' }, 409);
    }
  }

  const lifecycle = action === 'enable'
    ? { archived: 0, active: 1, available: 1, label: 'enabled' }
    : action === 'restore'
      ? { archived: 0, active: 0, available: 0, label: 'restored as a draft' }
      : action === 'disable'
        ? { archived: 0, active: 0, available: 0, label: 'disabled' }
        : { archived: 1, active: 0, available: 0, label: 'archived' };

  await db.batch([
    db.prepare(`UPDATE products SET archived = ?, active = ?, available_for_sale = ?, version = version + 1,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(lifecycle.archived, lifecycle.active, lifecycle.available, productId),
    db.prepare(`INSERT INTO admin_audit_log (admin_email, action, entity_type, entity_id, summary)
      VALUES (?, ?, 'product', ?, ?)`).bind(identity.email, action === 'delete' ? 'archive' : action, productId, `${product.name} ${lifecycle.label}`)
  ]);
  console.log(JSON.stringify({ scope: 'admin_product', requestId, admin: identity.email, productId, action, status: 'succeeded', durationMs: Date.now() - startedAt }));
  return json({ ok: true, product: await getProduct(db, productId), message: `${product.name} ${lifecycle.label}.` });
}

async function permanentlyDeleteProduct(db, productId, identity) {
  const requestId = identity.requestId || crypto.randomUUID();
  const startedAt = Date.now();
  const product = await db.prepare('SELECT id, name, archived FROM products WHERE id = ?').bind(productId).first();
  if (!product) return json({ ok: false, error: 'Product not found.' }, 404);
  if (!product.archived) {
    return json({ ok: false, error: 'Archive this product before permanently deleting it.' }, 409);
  }
  const references = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM order_items WHERE product_id = ?) AS order_items,
    (SELECT COUNT(*) FROM stock_movements sm JOIN product_variants pv ON pv.id = sm.product_variant_id WHERE pv.product_id = ?) AS stock_movements,
    (SELECT COUNT(*) FROM product_images WHERE product_id = ? AND active = 1) AS active_pictures
  `).bind(productId, productId, productId).first();
  const orderItems = Number(references?.order_items || 0);
  const stockMovements = Number(references?.stock_movements || 0);
  const activePictures = Number(references?.active_pictures || 0);
  if (orderItems || stockMovements) {
    await audit(db, identity, 'delete_rejected', 'product', productId, 'Permanent deletion rejected because historical records exist');
    console.log(JSON.stringify({ scope: 'admin_product', requestId, admin: identity.email, productId, action: 'delete', status: 'rejected', errorCode: 'HISTORICAL_REFERENCES', durationMs: Date.now() - startedAt }));
    return json({ ok: false, code: 'HISTORICAL_REFERENCES', error: 'This product has order or stock history and cannot be permanently deleted. Keep it archived.' }, 409);
  }
  if (activePictures) {
    return json({ ok: false, code: 'ACTIVE_PICTURES', error: 'Remove this product\'s pictures before permanently deleting it.' }, 409);
  }
  const results = await db.batch([
    db.prepare('DELETE FROM product_images WHERE product_id = ?').bind(productId),
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').bind(productId),
    db.prepare('DELETE FROM products WHERE id = ? AND archived = 1').bind(productId),
    db.prepare(`INSERT INTO admin_audit_log (admin_email, action, entity_type, entity_id, summary)
      VALUES (?, 'delete', 'product', ?, ?)`).bind(identity.email, productId, `Permanently deleted unused product: ${product.name}`)
  ]);
  if (!results[2]?.meta?.changes) return json({ ok: false, error: 'The product could not be deleted.' }, 409);
  console.log(JSON.stringify({ scope: 'admin_product', requestId, admin: identity.email, productId, action: 'delete', status: 'succeeded', durationMs: Date.now() - startedAt }));
  return json({ ok: true, message: `${product.name} was permanently deleted.` });
}

async function duplicateProduct(db, productId, identity) {
  const source = await db.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first();
  if (!source) return json({ ok: false, error: 'Product not found.' }, 404);
  const copyName = `${source.name} Copy`;
  const copyId = await availableProductId(db, copyName);
  const variants = await db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY id').bind(productId).all();
  const suffix = crypto.randomUUID().slice(0, 6).toUpperCase();
  const statements = [
    db.prepare(`INSERT INTO products (
      id, slug, name, description, category, product_type, badge, price_cents, currency,
      active, available_for_sale, featured, track_inventory, allow_player_name, allow_player_number,
      player_name_price_cents, player_number_price_cents, archived, seo_title, meta_description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .bind(copyId, copyId, copyName, source.description, source.category, source.product_type, source.badge,
        source.price_cents, source.currency, source.track_inventory, source.allow_player_name,
        source.allow_player_number, source.player_name_price_cents, source.player_number_price_cents,
        source.seo_title || '', source.meta_description || '')
  ];
  for (const [index, variant] of (variants.results || []).entries()) {
    const skuBase = String(variant.sku || 'PTG-COPY').slice(0, 64);
    statements.push(db.prepare(`INSERT INTO product_variants (
      product_id, sku, size, colour, style, stock_quantity, active, allow_player_name, allow_player_number
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`)
      .bind(copyId, `${skuBase}-${suffix}-${index + 1}`, variant.size, variant.colour, variant.style,
        variant.active, variant.allow_player_name, variant.allow_player_number));
  }
  statements.push(db.prepare(`INSERT INTO admin_audit_log (admin_email, action, entity_type, entity_id, summary)
    VALUES (?, 'duplicate', 'product', ?, ?)`).bind(identity.email, copyId, `Duplicated ${source.name} as an inactive draft`));
  await db.batch(statements);
  return json({ ok: true, product: await getProduct(db, copyId), message: 'Draft duplicate created. Add pictures and review stock before enabling it.' }, 201);
}

async function updateProduct(db, productId, body, identity) {
  const requestId = identity.requestId || crypto.randomUUID();
  const startedAt = Date.now();
  const validation = validateProduct(body);
  if (validation.error) return json({ ok: false, error: validation.error }, 400);
  const value = validation.value;
  const adjustmentId = crypto.randomUUID();
  const statements = [
    db.prepare(`
      UPDATE products SET
        slug = ?, name = ?, description = ?, category = ?, product_type = ?, badge = ?, price_cents = ?, currency = ?,
        seo_title = ?, meta_description = ?,
        active = ?, available_for_sale = ?, featured = ?, track_inventory = ?,
        allow_player_name = ?, allow_player_number = ?, player_name_price_cents = ?, player_number_price_cents = ?,
        version = version + 1, last_update_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND version = ?
    `).bind(
      value.slug, value.name, value.description, value.category, value.productType, value.badge, value.priceCents, value.currency,
      value.seoTitle, value.metaDescription,
      value.active, value.availableForSale, value.featured, value.trackInventory,
      value.allowPlayerName, value.allowPlayerNumber, value.playerNamePriceCents, value.playerNumberPriceCents,
      adjustmentId, productId, value.version
    )
  ];
  statements.push(db.prepare(`
    INSERT INTO admin_audit_log (admin_email, action, entity_type, entity_id, summary)
    SELECT ?, 'update', 'product', ?, ? WHERE EXISTS (SELECT 1 FROM products WHERE id = ? AND last_update_id = ?)
  `).bind(identity.email, productId, `Product update ${adjustmentId}`, productId, adjustmentId));

  let results;
  try { results = await db.batch(statements); }
  catch (error) { return json({ ok: false, error: 'That product slug is already in use.' }, 409); }
  if (!results[0]?.meta?.changes) return json({ ok: false, error: 'This product changed in another session. Refresh and try again.' }, 409);
  console.log(JSON.stringify({ scope: 'admin_product', requestId, admin: identity.email, productId, action: 'update', status: 'succeeded', durationMs: Date.now() - startedAt }));
  return json({ ok: true, product: await getProduct(db, productId) });
}

function validateVariant(body, requireVersion) {
  const unknown = rejectUnknownFields(body, VARIANT_FIELDS);
  if (unknown) return { error: `Unknown field: ${unknown}.` };
  const sku = cleanText(body.sku, 80).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{2,79}$/.test(sku)) return { error: 'SKU must use letters, numbers, dots, hyphens, or underscores.' };
  const active = booleanInteger(body.active);
  if (active === null) return { error: 'active must be true or false.' };
  const version = Number(body.version);
  if (requireVersion && (!Number.isInteger(version) || version < 1)) return { error: 'A valid variant version is required.' };
  const allowPlayerName = body.allowPlayerName === null || body.allowPlayerName === undefined ? null : booleanInteger(body.allowPlayerName);
  const allowPlayerNumber = body.allowPlayerNumber === null || body.allowPlayerNumber === undefined ? null : booleanInteger(body.allowPlayerNumber);
  if (allowPlayerName === null && body.allowPlayerName !== null && body.allowPlayerName !== undefined) return { error: 'allowPlayerName must be true, false, or null.' };
  if (allowPlayerNumber === null && body.allowPlayerNumber !== null && body.allowPlayerNumber !== undefined) return { error: 'allowPlayerNumber must be true, false, or null.' };
  const value = {
    sku,
    size: cleanText(body.size, 50),
    colour: cleanText(body.colour, 80),
    style: cleanText(body.style, 80),
    active,
    allowPlayerName,
    allowPlayerNumber,
    version
  };
  if (!value.size && !value.colour && !value.style) return { error: 'Add at least a size, colour, or style.' };
  return { value };
}

async function createVariant(db, productId, body, identity) {
  const validation = validateVariant(body, false);
  if (validation.error) return json({ ok: false, error: validation.error }, 400);
  const product = await db.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first();
  if (!product) return json({ ok: false, error: 'Product not found.' }, 404);
  const value = validation.value;
  try {
    const result = await db.prepare(`
      INSERT INTO product_variants (product_id, sku, size, colour, style, stock_quantity, active, allow_player_name, allow_player_number)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).bind(productId, value.sku, value.size, value.colour, value.style, value.active, value.allowPlayerName, value.allowPlayerNumber).run();
    await audit(db, identity, 'create', 'variant', result.meta.last_row_id, `Created ${value.sku}`);
    return json({ ok: true, product: await getProduct(db, productId) }, 201);
  } catch (error) {
    return json({ ok: false, error: 'That SKU or option combination already exists.' }, 409);
  }
}

async function updateVariant(db, variantId, body, identity) {
  const validation = validateVariant(body, true);
  if (validation.error) return json({ ok: false, error: validation.error }, 400);
  const value = validation.value;
  try {
    const result = await db.prepare(`
      UPDATE product_variants SET sku = ?, size = ?, colour = ?, style = ?, active = ?, allow_player_name = ?, allow_player_number = ?,
        version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND version = ?
    `).bind(value.sku, value.size, value.colour, value.style, value.active, value.allowPlayerName, value.allowPlayerNumber, variantId, value.version).run();
    if (!result.meta.changes) return json({ ok: false, error: 'Variant not found or changed in another session.' }, 409);
    await audit(db, identity, 'update', 'variant', variantId, `Updated ${value.sku}`);
    const variant = await db.prepare('SELECT * FROM product_variants WHERE id = ?').bind(variantId).first();
    return json({ ok: true, variant: mapVariant(variant) });
  } catch (error) {
    return json({ ok: false, error: 'That SKU or option combination already exists.' }, 409);
  }
}

async function adjustStock(db, variantId, body, identity) {
  const allowed = new Set(['type', 'quantity', 'reason', 'version']);
  const unknown = rejectUnknownFields(body, allowed);
  if (unknown) return json({ ok: false, error: `Unknown field: ${unknown}.` }, 400);
  const type = cleanText(body.type, 20).toLowerCase();
  const quantity = Number(body.quantity);
  const reason = cleanText(body.reason, 300);
  const version = Number(body.version);
  if (!['set', 'increase', 'decrease'].includes(type)) return json({ ok: false, error: 'Adjustment type must be set, increase, or decrease.' }, 400);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1000000) return json({ ok: false, error: 'Quantity must be a non-negative whole number.' }, 400);
  if (type !== 'set' && quantity === 0) return json({ ok: false, error: 'Increase or decrease quantity must be greater than zero.' }, 400);
  if (!reason) return json({ ok: false, error: 'A reason is required.' }, 400);
  if (!Number.isInteger(version) || version < 1) return json({ ok: false, error: 'A valid variant version is required.' }, 400);

  const current = await db.prepare('SELECT * FROM product_variants WHERE id = ?').bind(variantId).first();
  if (!current) return json({ ok: false, error: 'Variant not found.' }, 404);
  if (current.version !== version) return json({ ok: false, error: 'Stock changed in another session. Refresh and try again.' }, 409);
  const after = type === 'set' ? quantity : type === 'increase' ? current.stock_quantity + quantity : current.stock_quantity - quantity;
  if (after < 0) return json({ ok: false, error: 'Stock cannot be reduced below zero.' }, 400);
  const change = after - current.stock_quantity;
  const adjustmentId = crypto.randomUUID();

  const results = await db.batch([
    db.prepare(`
      UPDATE product_variants SET stock_quantity = ?, version = version + 1,
        last_adjustment_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND version = ?
    `).bind(after, adjustmentId, variantId, version),
    db.prepare(`
      INSERT INTO stock_movements (
        product_variant_id, change_quantity, quantity_before, quantity_after,
        reason, reference_type, reference_id, changed_by
      )
      SELECT id, ?, ?, stock_quantity, ?, 'manual', ?, ?
      FROM product_variants WHERE id = ? AND last_adjustment_id = ?
    `).bind(change, current.stock_quantity, reason, adjustmentId, identity.email, variantId, adjustmentId),
    db.prepare(`
      INSERT INTO admin_audit_log (admin_email, action, entity_type, entity_id, summary)
      SELECT ?, 'adjust_stock', 'variant', ?, ?
      WHERE EXISTS (SELECT 1 FROM product_variants WHERE id = ? AND last_adjustment_id = ?)
    `).bind(identity.email, String(variantId), `${type} stock: ${change >= 0 ? '+' : ''}${change}. ${reason}`, variantId, adjustmentId)
  ]);
  if (!results[0]?.meta?.changes || !results[1]?.meta?.changes) {
    return json({ ok: false, error: 'Stock changed in another session. Refresh and try again.' }, 409);
  }
  const variant = await db.prepare('SELECT * FROM product_variants WHERE id = ?').bind(variantId).first();
  return json({ ok: true, variant: mapVariant(variant) });
}

async function listOrders(db, url) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
  const clauses = [];
  const values = [];
  const search = cleanText(url.searchParams.get('search'), 120);
  const payment = cleanText(url.searchParams.get('payment'), 30);
  const fulfilment = cleanText(url.searchParams.get('fulfilment'), 30);
  const fulfilmentType = cleanText(url.searchParams.get('fulfilmentType'), 20).toLowerCase();
  const from = cleanText(url.searchParams.get('from'), 10);
  const to = cleanText(url.searchParams.get('to'), 10);
  if (search) { clauses.push('(order_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?)'); values.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (payment) { clauses.push('payment_status = ?'); values.push(payment); }
  if (fulfilment) { clauses.push('fulfilment_status = ?'); values.push(fulfilment); }
  if (['pickup', 'delivery'].includes(fulfilmentType)) { clauses.push('fulfilment_type = ?'); values.push(fulfilmentType); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { clauses.push('date(created_at) >= date(?)'); values.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { clauses.push('date(created_at) <= date(?)'); values.push(to); }
  values.push(limit);
  const result = await db.prepare(`
    SELECT id, order_number, stripe_checkout_session_id, stripe_payment_intent_id, customer_name, customer_email,
      subtotal_cents, personalisation_cents, shipping_cents, payment_surcharge_cents, total_cents, currency,
      fulfilment_type, shipping_method,
      payment_status, fulfilment_status, refund_status, refunded_cents, invoice_number, email_status, created_at
    FROM orders ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?
  `).bind(...values).all();
  return result.results || [];
}

async function getOrder(db, orderId) {
  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) return null;
  const [items, history, movements] = await Promise.all([
    db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').bind(orderId).all(),
    db.prepare('SELECT * FROM fulfilment_history WHERE order_id = ? ORDER BY created_at DESC, id DESC').bind(orderId).all(),
    db.prepare(`SELECT sm.*, pv.sku, p.name AS product_name FROM stock_movements sm JOIN product_variants pv ON pv.id=sm.product_variant_id JOIN products p ON p.id=pv.product_id WHERE sm.reference_id IN (?, ?) ORDER BY sm.created_at DESC`).bind(String(orderId), order.stripe_checkout_session_id).all()
  ]);
  let shipping = {}; let billing = {};
  try { shipping = JSON.parse(order.shipping_address_json || '{}'); } catch {}
  try { billing = JSON.parse(order.billing_address_json || '{}'); } catch {}
  return { ...order, shipping_address: shipping, billing_address: billing, shipping_address_json: undefined, billing_address_json: undefined, items: items.results || [], fulfilment_history: history.results || [], stock_movements: movements.results || [] };
}

async function updateOrder(db, orderId, body, identity) {
  const unknown = rejectUnknownFields(body, new Set(['fulfilmentStatus', 'reason', 'internalNotes']));
  if (unknown) return json({ ok: false, error: `Unknown field: ${unknown}.` }, 400);
  const status = cleanText(body.fulfilmentStatus, 30).toLowerCase();
  if (!FULFILMENT_STATUSES.has(status)) return json({ ok: false, error: 'Invalid fulfilment status.' }, 400);
  const current = await db.prepare('SELECT fulfilment_status, internal_notes FROM orders WHERE id = ?').bind(orderId).first();
  if (!current) return json({ ok: false, error: 'Order not found.' }, 404);
  const reason = cleanText(body.reason, 500);
  const notes = body.internalNotes === undefined ? current.internal_notes : cleanText(body.internalNotes, 4000);
  await db.batch([
    db.prepare('UPDATE orders SET fulfilment_status = ?, internal_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(status, notes, orderId),
    db.prepare('INSERT INTO fulfilment_history (order_id, previous_status, new_status, reason, changed_by) VALUES (?, ?, ?, ?, ?)').bind(orderId, current.fulfilment_status, status, reason, identity.email),
    db.prepare("INSERT INTO admin_audit_log (admin_email, action, entity_type, entity_id, summary) VALUES (?, 'update_fulfilment', 'order', ?, ?)").bind(identity.email, String(orderId), `${current.fulfilment_status} -> ${status}${reason ? `: ${reason}` : ''}`)
  ]);
  return json({ ok: true, order: await getOrder(db, orderId) });
}

async function ensureInvoice(db, orderId, identity) {
  let order = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) return null;
  if (order.payment_status !== 'paid') throw new Error('Invoices are only available for paid orders.');
  if (!order.invoice_number) {
    const year = Number(String(order.payment_date || order.created_at || new Date().toISOString()).slice(0, 4));
    const sequence = await db.prepare(`INSERT INTO invoice_sequence (year, next_value) VALUES (?, 2)
      ON CONFLICT(year) DO UPDATE SET next_value = next_value + 1, updated_at = CURRENT_TIMESTAMP
      RETURNING next_value - 1 AS value`).bind(year).first();
    const invoiceNumber = `PTG-${year}-${String(sequence.value).padStart(6, '0')}`;
    const result = await db.prepare('UPDATE orders SET invoice_number = ?, invoice_created_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND invoice_number IS NULL').bind(invoiceNumber, orderId).run();
    order = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
    if (result.meta.changes) await audit(db, identity, 'generate_invoice', 'order', orderId, `Generated ${invoiceNumber}`);
  }
  return getOrder(db, orderId);
}

async function listMovements(db, url) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
  const clauses = [];
  const values = [];
  const from = cleanText(url.searchParams.get('from'), 10);
  const to = cleanText(url.searchParams.get('to'), 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { clauses.push('date(sm.created_at) >= date(?)'); values.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { clauses.push('date(sm.created_at) <= date(?)'); values.push(to); }
  values.push(limit);
  const result = await db.prepare(`
    SELECT sm.*, pv.sku, pv.size, pv.colour, pv.style, p.name AS product_name
    FROM stock_movements sm
    JOIN product_variants pv ON pv.id = sm.product_variant_id
    JOIN products p ON p.id = pv.product_id
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY sm.created_at DESC, sm.id DESC LIMIT ?
  `).bind(...values).all();
  return result.results || [];
}

async function exportOrders(db, url, identity) {
  const orders = await listOrders(db, new URL(`${url.origin}${url.pathname}?${new URLSearchParams({ ...Object.fromEntries(url.searchParams), limit: '100' })}`));
  const ids = orders.map(order => order.id);
  let rows = [];
  for (const id of ids) {
    const order = await getOrder(db, id);
    for (const item of order.items) rows.push([order.order_number, order.created_at, order.customer_name, order.customer_email, order.customer_phone, order.fulfilment_type, order.shipping_method, order.shipping_name, order.shipping_phone, order.shipping_address_line_1, order.shipping_address_line_2, order.shipping_suburb, order.shipping_city, order.shipping_region, order.shipping_postcode, order.shipping_country, order.shipping_rural ? 'Yes' : 'No', order.pickup_location, order.pickup_instructions, item.product_name, item.sku, item.quantity, item.size, [item.colour, item.style].filter(Boolean).join(' / '), item.player_name, item.player_number, item.unit_price_cents / 100, item.customisation_total_cents / 100, order.subtotal_cents / 100, order.personalisation_cents / 100, order.shipping_cents / 100, order.payment_surcharge_cents / 100, order.total_cents / 100, order.refunded_cents / 100, order.payment_status, order.fulfilment_status, order.refund_status]);
  }
  await audit(db, identity, 'export_csv', 'orders', exportDate(), `Exported ${rows.length} order lines`);
  return csvResponse(`ptg-orders-${exportDate()}.csv`, ['Order number','Date','Customer name','Customer email','Customer phone','Fulfilment type','Shipping method','Shipping name','Shipping phone','Address line 1','Address line 2','Suburb','City','Region','Postcode','Country','Rural','Pickup location','Pickup instructions','Product','SKU','Quantity','Size','Colour/style','Player Name','Player Number','Unit price NZD','Item personalisation NZD','Merchandise subtotal NZD','Order personalisation NZD','Shipping NZD','Processing surcharge NZD','Total NZD','Refunded NZD','Payment status','Fulfilment status','Refund status'], rows);
}

async function exportInventory(db, url, identity) {
  const clauses = []; const values = [];
  const from = cleanText(url.searchParams.get('from'), 10); const to = cleanText(url.searchParams.get('to'), 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { clauses.push('date(pv.updated_at) >= date(?)'); values.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { clauses.push('date(pv.updated_at) <= date(?)'); values.push(to); }
  const result = await db.prepare(`SELECT p.name, pv.sku, pv.size, pv.colour, pv.style, pv.stock_quantity, pv.active, pv.updated_at FROM product_variants pv JOIN products p ON p.id=pv.product_id ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY p.name, pv.id`).bind(...values).all();
  const rows = (result.results || []).map(row => [row.name, [row.size,row.colour,row.style].filter(Boolean).join(' / '), row.sku, row.size, [row.colour,row.style].filter(Boolean).join(' / '), row.stock_quantity, row.active ? 'Active' : 'Inactive', row.updated_at]);
  await audit(db, identity, 'export_csv', 'inventory', exportDate(), `Exported ${rows.length} variants`);
  return csvResponse(`ptg-inventory-${exportDate()}.csv`, ['Product','Variant','SKU','Size','Colour/style','Current stock','Active status','Last updated'], rows);
}

async function exportMovements(db, url, identity) {
  const movements = await listMovements(db, url);
  const rows = movements.map(row => [row.created_at,row.product_name,[row.size,row.colour,row.style].filter(Boolean).join(' / '),row.quantity_before,row.change_quantity,row.quantity_after,row.reason,`${row.reference_type}:${row.reference_id}`,row.changed_by]);
  await audit(db, identity, 'export_csv', 'stock_movements', exportDate(), `Exported ${rows.length} movements`);
  return csvResponse(`ptg-stock-movements-${exportDate()}.csv`, ['Date','Product','Variant','Quantity before','Quantity change','Quantity after','Reason','Reference','Changed by'], rows);
}

async function routeAdminApi(request, env, identity) {
  if (!env.DB) return json({ ok: false, error: 'D1 database is not configured.' }, 503);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin\/?/, '');
  const segments = path.split('/').filter(Boolean);
  const method = request.method.toUpperCase();

  try {
    if (method === 'GET' && segments[0] === 'dashboard' && segments.length === 1) {
      return json({ ok: true, ...(await dashboard(env.DB, Math.max(0, Number(env.LOW_STOCK_THRESHOLD || 5)))) });
    }
    if (method === 'GET' && segments[0] === 'products' && segments.length === 1) {
      return json({ ok: true, products: await listProducts(env.DB) });
    }
    if (method === 'POST' && segments[0] === 'products' && segments.length === 1) {
      const parsed = await readBody(request);
      return parsed.error ? json({ ok: false, error: parsed.error }, 400) : createProduct(env.DB, parsed.body, identity);
    }
    if (method === 'GET' && segments[0] === 'products' && segments.length === 2) {
      const product = await getProduct(env.DB, segments[1]);
      return product ? json({ ok: true, product }) : json({ ok: false, error: 'Product not found.' }, 404);
    }
    if (method === 'PUT' && segments[0] === 'products' && segments.length === 2) {
      const parsed = await readBody(request);
      return parsed.error ? json({ ok: false, error: parsed.error }, 400) : updateProduct(env.DB, segments[1], parsed.body, identity);
    }
    if (method === 'POST' && segments[0] === 'products' && segments[2] === 'lifecycle' && segments.length === 3) {
      const parsed = await readBody(request);
      return parsed.error ? json({ ok: false, error: parsed.error }, 400) : productLifecycle(env.DB, segments[1], parsed.body, identity);
    }
    if (method === 'POST' && segments[0] === 'products' && segments.length === 3
      && ['publish', 'unpublish', 'archive', 'restore'].includes(segments[2])) {
      const actions = { publish: 'enable', unpublish: 'disable', archive: 'archive', restore: 'restore' };
      return productLifecycle(env.DB, segments[1], { action: actions[segments[2]] }, identity);
    }
    if (method === 'DELETE' && segments[0] === 'products' && segments.length === 2) {
      return permanentlyDeleteProduct(env.DB, segments[1], identity);
    }
    if (method === 'POST' && segments[0] === 'products' && segments[2] === 'duplicate' && segments.length === 3) {
      return duplicateProduct(env.DB, segments[1], identity);
    }
    if (method === 'GET' && segments[0] === 'products' && segments[2] === 'variants' && segments.length === 3) {
      const product = await getProduct(env.DB, segments[1]);
      return product ? json({ ok: true, variants: product.variants }) : json({ ok: false, error: 'Product not found.' }, 404);
    }
    if (method === 'POST' && segments[0] === 'products' && segments[2] === 'variants' && segments.length === 3) {
      const parsed = await readBody(request);
      return parsed.error ? json({ ok: false, error: parsed.error }, 400) : createVariant(env.DB, segments[1], parsed.body, identity);
    }
    if (method === 'PUT' && segments[0] === 'variants' && segments.length === 2) {
      const parsed = await readBody(request);
      return parsed.error ? json({ ok: false, error: parsed.error }, 400) : updateVariant(env.DB, Number(segments[1]), parsed.body, identity);
    }
    if (method === 'POST' && segments[0] === 'variants' && segments[2] === 'adjust-stock' && segments.length === 3) {
      const parsed = await readBody(request);
      return parsed.error ? json({ ok: false, error: parsed.error }, 400) : adjustStock(env.DB, Number(segments[1]), parsed.body, identity);
    }
    if (method === 'GET' && segments[0] === 'orders' && segments.length === 1) {
      return json({ ok: true, orders: await listOrders(env.DB, url) });
    }
    if (method === 'POST' && segments[0] === 'orders' && segments[2] === 'invoice' && segments.length === 3) {
      const order = await ensureInvoice(env.DB, Number(segments[1]), identity);
      return order ? json({ ok: true, order }) : json({ ok: false, error: 'Order not found.' }, 404);
    }
    if (method === 'GET' && segments[0] === 'orders' && segments.length === 2) {
      const order = await getOrder(env.DB, Number(segments[1]));
      return order ? json({ ok: true, order }) : json({ ok: false, error: 'Order not found.' }, 404);
    }
    if (method === 'PUT' && segments[0] === 'orders' && segments.length === 2) {
      const parsed = await readBody(request);
      return parsed.error ? json({ ok: false, error: parsed.error }, 400) : updateOrder(env.DB, Number(segments[1]), parsed.body, identity);
    }
    if (method === 'GET' && segments[0] === 'stock-movements' && segments.length === 1) {
      return json({ ok: true, movements: await listMovements(env.DB, url) });
    }
    if (method === 'GET' && segments[0] === 'exports' && segments[1] === 'orders') return exportOrders(env.DB, url, identity);
    if (method === 'GET' && segments[0] === 'exports' && segments[1] === 'inventory') return exportInventory(env.DB, url, identity);
    if (method === 'GET' && segments[0] === 'exports' && segments[1] === 'stock-movements') return exportMovements(env.DB, url, identity);
    if (method === 'GET' && segments[0] === 'me' && segments.length === 1) {
      return json({ ok: true, identity: { email: identity.email, local: Boolean(identity.local) } });
    }
    return json({ ok: false, error: 'Admin endpoint not found.' }, 404);
  } catch (error) {
    console.error('Admin API request failed', { method, path, message: error.message });
    return json({ ok: false, error: 'The admin request could not be completed.' }, 500);
  }
}

async function responseWithRequestId(response, requestId) {
  const headers = new Headers(response.headers);
  headers.set('X-Request-ID', requestId);
  if (!String(headers.get('content-type') || '').includes('application/json')) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const body = await response.json().catch(() => ({ ok: false, error: 'The admin response could not be read.' }));
  return new Response(JSON.stringify({ ...body, requestId: body.requestId || requestId }), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export async function handleAdminApi(request, env, identity) {
  const requestId = cleanText(request.headers.get('x-request-id'), 80) || crypto.randomUUID();
  return responseWithRequestId(await routeAdminApi(request, env, { ...identity, requestId }), requestId);
}
