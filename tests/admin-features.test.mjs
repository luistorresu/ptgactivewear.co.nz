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
