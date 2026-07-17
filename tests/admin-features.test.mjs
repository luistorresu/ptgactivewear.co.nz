import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('order and invoice migration is additive and preserves existing tables', async () => {
  const sql = await readFile(new URL('migrations/0002_orders_invoices_exports.sql', root), 'utf8');
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS invoice_sequence/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fulfilment_history/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_number/i);
});

test('admin theme respects system preference and persists only theme state', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('admin/index.html', root), 'utf8'),
    readFile(new URL('admin/admin.js', root), 'utf8')
  ]);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(script, /localStorage\.setItem\('ptg-admin-theme'/);
  assert.doesNotMatch(script, /localStorage\.setItem\([^)]*(?:order|customer|token)/i);
});

test('invoice and CSV routes remain under authenticated admin API paths', async () => {
  const [worker, api] = await Promise.all([
    readFile(new URL('_worker.js', root), 'utf8'),
    readFile(new URL('worker/admin-api.js', root), 'utf8')
  ]);
  assert.match(worker, /startsWith\('\/api\/admin\/'\)/);
  assert.match(api, /segments\[2\] === 'invoice'/);
  assert.match(api, /segments\[0\] === 'exports'/);
  assert.match(api, /if \(\/\^\[=\+\\-@\\t\\r\]\//);
});

test('ordinary product updates reject raw image paths', async () => {
  const [html, script, api] = await Promise.all([
    readFile(new URL('admin/index.html', root), 'utf8'),
    readFile(new URL('admin/admin.js', root), 'utf8'),
    readFile(new URL('worker/admin-api.js', root), 'utf8')
  ]);
  assert.doesNotMatch(html, /Image paths|name="images"/i);
  assert.doesNotMatch(script, /form\.elements\.images/);
  assert.doesNotMatch(api, /'version', 'images'/);
});

test('admin creates a safe product and initial variants in one validated batch', async () => {
  const [html, script, api] = await Promise.all([
    readFile(new URL('admin/index.html', root), 'utf8'),
    readFile(new URL('admin/admin.js', root), 'utf8'),
    readFile(new URL('worker/admin-api.js', root), 'utf8')
  ]);
  assert.match(html, /data-new-product/);
  assert.match(html, /data-draft-variant-list/);
  assert.match(html, /name="initialPictures"[^>]*multiple/);
  assert.match(script, /method: isCreating \? 'POST' : 'PUT'/);
  assert.match(script, /collectDraftVariants/);
  assert.match(script, /uploadInitialPicture/);
  assert.match(api, /INSERT INTO products/);
  assert.match(api, /CREATE_PRODUCT_FIELDS/);
  assert.match(api, /INSERT INTO product_variants/);
  assert.match(api, /'Initial stock', 'product_create'/);
  assert.match(api, /await db\.batch\(statements\)/);
  assert.match(api, /method === 'POST'.*segments\[0\] === 'products'/s);
});

test('product creation rejects duplicate slugs, SKUs, bad stock and unsupported currency', async () => {
  const api = await readFile(new URL('worker/admin-api.js', root), 'utf8');
  assert.match(api, /That product slug is already in use/);
  assert.match(api, /Duplicate SKU in this product/);
  assert.match(api, /SKU already exists/);
  assert.match(api, /starting stock must be a non-negative whole number/);
  assert.match(api, /Currency must be NZD/);
  assert.match(api, /rejectUnknownFields\(variant/);
});

test('product SEO pages, structured data, sitemap and merchant feed use D1 catalogue data', async () => {
  const [worker, template, catalogue, migration] = await Promise.all([
    readFile(new URL('_worker.js', root), 'utf8'),
    readFile(new URL('product.html', root), 'utf8'),
    readFile(new URL('worker/catalog.js', root), 'utf8'),
    readFile(new URL('migrations/0006_product_seo.sql', root), 'utf8')
  ]);
  assert.match(worker, /servePublicProductPage/);
  assert.match(worker, /merchantFeed/);
  assert.match(worker, /dynamicSitemap/);
  assert.match(worker, /'@type': 'Product'/);
  assert.match(template, /__PRODUCT_SCHEMA__/);
  assert.match(template, /data-product-slug="__PRODUCT_SLUG__"/);
  assert.match(catalogue, /seoTitle/);
  assert.match(migration, /ADD COLUMN seo_title/);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
});

test('beanie exposes pom pom styles with matching image galleries', async () => {
  const [products, seed, migration] = await Promise.all([
    readFile(new URL('js/products.js', root), 'utf8'),
    readFile(new URL('seed/seed-products.sql', root), 'utf8'),
    readFile(new URL('migrations/0004_beanie_pom_pom.sql', root), 'utf8')
  ]);
  for (const source of [products, seed, migration]) {
    assert.match(source, /binnie 1\.jpeg/);
    assert.match(source, /binnie PomPom\.jpeg/);
    assert.match(source, /Without Pom Pom/);
    assert.match(source, /With Pom Pom/);
  }
  assert.match(products, /PTG-PFC-BEANIE-POMPOM/);
  assert.match(migration, /INSERT OR IGNORE INTO product_variants/);
});

test('windbreaker remains one NZD 95 product with the four active sizes and three images', async () => {
  const [products, seed, migration, updateMigration] = await Promise.all([
    readFile(new URL('js/products.js', root), 'utf8'),
    readFile(new URL('seed/seed-products.sql', root), 'utf8'),
    readFile(new URL('migrations/0007_add_windbreaker_jacket.sql', root), 'utf8'),
    readFile(new URL('migrations/0010_training_kit_and_windbreaker_sizes.sql', root), 'utf8')
  ]);
  for (const source of [products, seed, migration]) {
    assert.match(source, /patagonia-fc-windbreaker-jacket/);
    assert.match(source, /Windbreaker\.jpeg/);
    assert.match(source, /WindBreaker 2\.png/);
    assert.match(source, /Windbreaker 1\.png/);
  }
  assert.match(products, /price: 95/);
  assert.match(products, /sizes: \['8', '10', '12', 'XS'\]/);
  assert.match(updateMigration, /price_cents = 9500/);
  assert.match(updateMigration, /PTG-PFC-WINDBREAKER-(?:8|10|12)/);
  assert.doesNotMatch(updateMigration, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
});

test('training kit is one NZD 95 personalisable product with a complete kit gallery', async () => {
  const [products, seed, migration] = await Promise.all([
    readFile(new URL('js/products.js', root), 'utf8'),
    readFile(new URL('seed/seed-products.sql', root), 'utf8'),
    readFile(new URL('migrations/0010_training_kit_and_windbreaker_sizes.sql', root), 'utf8')
  ]);
  for (const source of [products, seed, migration]) {
    assert.match(source, /patagonia-fc-training-kit/);
    assert.match(source, /Patagonia FC Training Kit/);
  }
  for (const source of [seed, migration]) {
    assert.match(source, /PTG-PFC-TRAINING-KIT-8/);
    assert.match(source, /PTG-PFC-TRAINING-KIT-10/);
    assert.match(source, /PTG-PFC-TRAINING-KIT-12/);
    assert.match(source, /PTG-PFC-TRAINING-KIT-XS/);
  }
  assert.match(products, /Includes shirt, shorts and socks/);
  assert.match(migration, /player_name_price_cents = 2000/);
  assert.match(migration, /Patagonia FC Training Shorts and Socks/);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
});

test('mug styles use the new style-specific images', async () => {
  const [products, seed, migration] = await Promise.all([
    readFile(new URL('js/products.js', root), 'utf8'),
    readFile(new URL('seed/seed-products.sql', root), 'utf8'),
    readFile(new URL('migrations/0008_update_mug_style_images.sql', root), 'utf8')
  ]);
  for (const source of [products, seed, migration]) {
    assert.match(source, /Mug style 1  new \.jpeg/);
    assert.match(source, /Mug Style 2 New\.jpeg/);
  }
  assert.match(products, /Mug style 1  new \.jpeg', style: 'Style 1'/);
  assert.match(products, /Mug Style 2 New\.jpeg', style: 'Style 2'/);
  assert.match(migration, /SET active = 0, is_primary = 0/);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
});

test('pictures API validates uploads and never accepts browser object keys', async () => {
  const [pictures, worker, configText] = await Promise.all([
    readFile(new URL('worker/pictures.js', root), 'utf8'),
    readFile(new URL('_worker.js', root), 'utf8'),
    readFile(new URL('wrangler.jsonc', root), 'utf8')
  ]);
  const config = JSON.parse(configText);
  assert.match(pictures, /MAX_UPLOAD_BYTES = 8 \* 1024 \* 1024/);
  assert.match(pictures, /signatureMatches/);
  assert.match(pictures, /crypto\.randomUUID\(\)/);
  assert.doesNotMatch(pictures, /form\.get\(['"]objectKey/);
  assert.match(worker, /function isAdminPicturesPath/);
  assert.match(worker, /segments\[0\] === 'products'.*segments\[2\] === 'pictures'/s);
  assert.deepEqual(config.r2_buckets, [{ binding: 'PRODUCT_IMAGES', bucket_name: 'ptgactivewear-product-images' }]);
});

test('product lifecycle is soft-delete based and requires sellable content before enablement', async () => {
  const [api, catalog, inventory, migration] = await Promise.all([
    readFile(new URL('worker/admin-api.js', root), 'utf8'),
    readFile(new URL('worker/catalog.js', root), 'utf8'),
    readFile(new URL('worker/inventory.js', root), 'utf8'),
    readFile(new URL('migrations/0005_product_lifecycle_and_thumbnails.sql', root), 'utf8')
  ]);
  assert.match(api, /action === 'delete' \? 'archive' : action/);
  assert.match(api, /archived: 1, active: 0, available: 0/);
  assert.match(api, /readiness\?\.variants.*readiness\?\.pictures/);
  assert.match(api, /async function duplicateProduct/);
  assert.match(api, /segments\[2\] === 'duplicate'/);
  assert.match(catalog, /active = 1 AND archived = 0/);
  assert.match(inventory, /product\.archived/);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
});

test('picture uploads create owned thumbnails and remove both R2 objects together', async () => {
  const [pictures, adminScript, migration] = await Promise.all([
    readFile(new URL('worker/pictures.js', root), 'utf8'),
    readFile(new URL('admin/admin.js', root), 'utf8'),
    readFile(new URL('migrations/0005_product_lifecycle_and_thumbnails.sql', root), 'utf8')
  ]);
  assert.match(pictures, /form\.get\('thumbnail'\)/);
  assert.match(pictures, /thumbnail_object_key/);
  assert.match(pictures, /PRODUCT_IMAGES\.delete\(picture\.thumbnail_object_key\)/);
  assert.match(adminScript, /optimisePicture/);
  assert.match(adminScript, /image\/webp/);
  assert.match(adminScript, /draggable/);
  assert.match(migration, /thumbnail_delivery_url/);
});

test('public pages include discoverability metadata and Worker assets use security headers', async () => {
  const [home, shop, robots, sitemap, worker] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('shop.html', root), 'utf8'),
    readFile(new URL('robots.txt', root), 'utf8'),
    readFile(new URL('sitemap.xml', root), 'utf8'),
    readFile(new URL('_worker.js', root), 'utf8')
  ]);
  for (const page of [home, shop]) {
    assert.match(page, /rel="canonical"/);
    assert.match(page, /property="og:title"/);
    assert.match(page, /application\/ld\+json/);
  }
  assert.match(robots, /Sitemap: https:\/\/ptgactivewear\.co\.nz\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/ptgactivewear\.co\.nz\/shop<\/loc>/);
  assert.match(worker, /Content-Security-Policy/);
  assert.match(worker, /Strict-Transport-Security/);
});

test('customer order email uses friendly order number without technical references', async () => {
  const worker = await readFile(new URL('_worker.js', root), 'utf8');
  const start = worker.indexOf('function buildCustomerOrderEmail');
  const end = worker.indexOf('async function sendOrderEmails', start);
  const customerTemplate = worker.slice(start, end);
  assert.match(customerTemplate, /order\.orderNumber/);
  assert.doesNotMatch(customerTemplate, /order\.sessionId|paymentIntentId|eventId/);
});

test('homepage carousel uses D1 saleable products and accessible motion controls', async () => {
  const [home, script, styles] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('js/main.js', root), 'utf8'),
    readFile(new URL('css/style.css', root), 'utf8')
  ]);
  assert.match(home, /data-home-product-carousel/);
  assert.match(script, /PTG_PRODUCTS_SOURCE = 'd1'/);
  assert.match(script, /filter\(product => product\.available === true/);
  assert.match(script, /visibilitychange/);
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(script, /pointerStart/);
  assert.match(styles, /home-carousel-slide/);
});

test('picture uploads are retry-safe and surface precise client errors', async () => {
  const [pictures, admin, migration] = await Promise.all([
    readFile(new URL('worker/pictures.js', root), 'utf8'),
    readFile(new URL('admin/admin.js', root), 'utf8'),
    readFile(new URL('migrations/0009_upload_idempotency.sql', root), 'utf8')
  ]);
  assert.match(pictures, /upload_request_id/);
  assert.match(pictures, /REQUEST_ID_CONFLICT/);
  assert.match(pictures, /DATABASE_COMMIT_FAILED/);
  assert.match(admin, /X-Upload-Request-ID/);
  assert.match(admin, /xhr\.timeout = 90000/);
  assert.match(admin, /pendingPicturePromise/);
  assert.match(migration, /CREATE UNIQUE INDEX/);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
});

test('new product form makes Draft and Active an explicit choice', async () => {
  const [html, admin] = await Promise.all([
    readFile(new URL('admin/index.html', root), 'utf8'),
    readFile(new URL('admin/admin.js', root), 'utf8')
  ]);
  assert.match(html, /name="createStatus"/);
  assert.match(html, /Draft \(hidden\)/);
  assert.match(html, /Active \(publish\)/);
  assert.match(admin, /publishRequested/);
  assert.match(admin, /Choose at least one product image before publishing/);
});
