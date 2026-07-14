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

test('customer order email uses friendly order number without technical references', async () => {
  const worker = await readFile(new URL('_worker.js', root), 'utf8');
  const start = worker.indexOf('function buildCustomerOrderEmail');
  const end = worker.indexOf('async function sendOrderEmails', start);
  const customerTemplate = worker.slice(start, end);
  assert.match(customerTemplate, /order\.orderNumber/);
  assert.doesNotMatch(customerTemplate, /order\.sessionId|paymentIntentId|eventId/);
});
