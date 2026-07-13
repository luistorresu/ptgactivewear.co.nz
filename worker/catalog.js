function asBoolean(value) {
  return Number(value) === 1;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function variantLabel(variant) {
  return [variant.size, variant.colour, variant.style].filter(Boolean).join(' / ') || variant.sku;
}

function stockStatus(product, variant, threshold) {
  if (!product.active || !product.available_for_sale || !variant.active) return 'out_of_stock';
  if (!product.track_inventory) return 'in_stock';
  if (variant.stock_quantity <= 0) return 'out_of_stock';
  if (variant.stock_quantity <= threshold) return 'low_stock';
  return 'in_stock';
}

function publicProduct(product, images, variants, threshold) {
  const publicVariants = variants.map(variant => {
    const status = stockStatus(product, variant, threshold);
    return {
      id: variant.id,
      sku: variant.sku,
      size: variant.size,
      colour: variant.colour,
      style: variant.style,
      label: variantLabel(variant),
      available: status !== 'out_of_stock',
      stockStatus: status
    };
  });
  const availableVariants = publicVariants.filter(variant => variant.available);
  const gallery = images.map(image => image.path);
  const overallStatus = !product.active || !product.available_for_sale || !availableVariants.length
    ? 'out_of_stock'
    : availableVariants.some(variant => variant.stockStatus === 'in_stock')
      ? 'in_stock'
      : 'low_stock';

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    category: product.category,
    type: product.product_type,
    badge: product.badge,
    price: product.price_cents / 100,
    priceCents: product.price_cents,
    currency: product.currency,
    featured: asBoolean(product.featured),
    personalisable: asBoolean(product.allow_player_name) || asBoolean(product.allow_player_number),
    allowPlayerName: asBoolean(product.allow_player_name),
    allowPlayerNumber: asBoolean(product.allow_player_number),
    playerNamePrice: product.player_name_price_cents / 100,
    playerNumberPrice: product.player_number_price_cents / 100,
    image: gallery[0] || '',
    gallery,
    sizes: unique(publicVariants.map(variant => variant.size)),
    inventoryVariants: publicVariants,
    stockStatus: overallStatus,
    available: overallStatus !== 'out_of_stock'
  };
}

async function loadRelatedRows(db, productIds) {
  if (!productIds.length) return { images: [], variants: [] };
  const placeholders = productIds.map(() => '?').join(', ');
  const [imageResult, variantResult] = await Promise.all([
    db.prepare(`SELECT * FROM product_images WHERE product_id IN (${placeholders}) ORDER BY product_id, is_primary DESC, sort_order, id`).bind(...productIds).all(),
    db.prepare(`SELECT * FROM product_variants WHERE product_id IN (${placeholders}) AND active = 1 ORDER BY product_id, id`).bind(...productIds).all()
  ]);
  return { images: imageResult.results || [], variants: variantResult.results || [] };
}

export function isD1CatalogueEnabled(env) {
  return Boolean(env.DB) && String(env.CATALOG_SOURCE || '').toLowerCase() === 'd1';
}

export async function getPublicProducts(env) {
  if (!env.DB) throw new Error('D1 database binding is missing.');
  const productResult = await env.DB.prepare('SELECT * FROM products WHERE active = 1 ORDER BY name').all();
  const products = productResult.results || [];
  const productIds = products.map(product => product.id);
  const related = await loadRelatedRows(env.DB, productIds);
  const threshold = Math.max(0, Number(env.LOW_STOCK_THRESHOLD || 5));

  return products.map(product => publicProduct(
    product,
    related.images.filter(image => image.product_id === product.id),
    related.variants.filter(variant => variant.product_id === product.id),
    threshold
  ));
}

export async function getPublicProductBySlug(env, slug) {
  if (!env.DB) throw new Error('D1 database binding is missing.');
  const product = await env.DB.prepare('SELECT * FROM products WHERE slug = ? AND active = 1').bind(slug).first();
  if (!product) return null;
  const related = await loadRelatedRows(env.DB, [product.id]);
  const threshold = Math.max(0, Number(env.LOW_STOCK_THRESHOLD || 5));
  return publicProduct(product, related.images, related.variants, threshold);
}

export async function getCheckoutProduct(env, productId, variantId) {
  if (!env.DB) return null;
  const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first();
  if (!product) return null;

  let variant = null;
  if (Number.isInteger(variantId) && variantId > 0) {
    variant = await env.DB.prepare('SELECT * FROM product_variants WHERE id = ? AND product_id = ?').bind(variantId, productId).first();
  }

  return { product, variant };
}

export function getVariantStockStatus(product, variant, threshold = 5) {
  return stockStatus(product, variant, threshold);
}
