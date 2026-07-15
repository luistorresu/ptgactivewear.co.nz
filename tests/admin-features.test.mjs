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

test('admin can create an inactive draft product before adding variants and pictures', async () => {
  const [html, script, api] = await Promise.all([
    readFile(new URL('admin/index.html', root), 'utf8'),
    readFile(new URL('admin/admin.js', root), 'utf8'),
    readFile(new URL('worker/admin-api.js', root), 'utf8')
  ]);
  assert.match(html, /data-new-product/);
  assert.match(script, /method: isCreating \? 'POST' : 'PUT'/);
  assert.match(api, /INSERT INTO products/);
  assert.match(api, /VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, 'NZD', 0, 0, 0/);
  assert.match(api, /method === 'POST'.*segments\[0\] === 'products'/s);
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
