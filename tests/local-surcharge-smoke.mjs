import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const root = new URL('../', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1').replace(/\//g, '\\');
const port = Number(process.env.PORT || 8791);
const baseUrl = `http://127.0.0.1:${port}`;
const powershell = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const server = spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'dev.ps1'), '-Port', String(port)], {
  cwd: root,
  env: process.env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
server.stdout.on('data', chunk => { output += chunk; });
server.stderr.on('data', chunk => { output += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const response = await fetch(`${baseUrl}/api/products`);
      if (response.ok) return response.json();
    } catch {}
  }
  throw new Error(`Local Worker did not start.\n${output.slice(-4000)}`);
}

function stopServer() {
  if (server.pid) spawnSync('taskkill.exe', ['/pid', String(server.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
}

try {
  const catalogue = await waitForServer();
  const product = catalogue.products.find(candidate => candidate.available && candidate.inventoryVariants?.length);
  assert.ok(product, 'A saleable local product is required.');
  const variant = product.inventoryVariants.find(candidate => candidate.available) || product.inventoryVariants[0];
  const payload = {
    items: [{ productId: product.id, variantId: variant.id, quantity: 2, personalisation: { name: '', number: '' } }],
    subtotalCents: 1,
    paymentSurchargeCents: 999999,
    totalCents: 1
  };
  const response = await fetch(`${baseUrl}/api/checkout-summary`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.summary.surcharge.enabled, false);
  assert.equal(result.summary.paymentSurchargeCents, 0);
  assert.equal(result.summary.merchandiseSubtotalCents, product.priceCents * 2);
  assert.equal(result.summary.totalCents, product.priceCents * 2);

  const require = createRequire(import.meta.url);
  const pnpmModules = join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', '.pnpm');
  const playwrightPackage = readdirSync(pnpmModules).find(name => name.startsWith('playwright@'));
  assert.ok(playwrightPackage, 'Bundled Playwright is required for visual smoke tests.');
  const { chromium } = require(join(pnpmModules, playwrightPackage, 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  try {
    for (const viewport of [{ width: 390, height: 844, name: 'mobile' }, { width: 1440, height: 1000, name: 'desktop' }]) {
      const page = await browser.newPage({ viewport });
      const cart = [{
        id: product.id, name: product.name, basePrice: product.price, price: product.price, qty: 2,
        variantId: variant.id, variant: [variant.colour, variant.style].filter(Boolean).join(' / '), size: variant.size,
        personalisation: { name: '', number: '' }, personalisationPrices: { name: 0, number: 0 }
      }];
      await page.addInitScript(value => localStorage.setItem('ptg-cart', JSON.stringify(value)), cart);
      await page.goto(`${baseUrl}/cart`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Return to Cart' }).click();
      await page.locator('[data-cart-breakdown]:not([hidden])').waitFor();
      assert.match(await page.locator('[data-cart-breakdown]').innerText(), /Merchandise subtotal[\s\S]*Shipping/);
      assert.equal(await page.locator('[data-summary-surcharge-row]').isVisible(), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

      await page.route('**/api/checkout-summary', async route => {
        const requestBody = route.request().postDataJSON();
        assert.ok(Array.isArray(requestBody.items));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, summary: {
          currency: 'NZD', merchandiseSubtotalCents: product.priceCents * 2, personalisationCents: 0,
          shippingCents: 0, paymentSurchargeCents: 216, totalCents: product.priceCents * 2 + 216,
          surcharge: { enabled: true, label: 'Card processing surcharge', description: 'Processing cost', percent: '2.65', fixedCents: 30 }
        } }) });
      });
      await page.evaluate(() => changeQty(0, 1));
      await page.locator('[data-summary-surcharge-row]:not([hidden])').waitFor();
      assert.match(await page.locator('[data-summary-surcharge-note]').innerText(), /processing surcharge/i);
      await page.screenshot({ path: join(tmpdir(), `ptg-surcharge-${viewport.name}.png`), fullPage: true });
      await page.close();
    }

    const invoicePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const invoiceOrder = {
      id: 1, invoice_number: 'PTG-2026-000001', order_number: 'PTG-ORD-2026-000001', invoice_created_at: '2026-07-19T00:00:00Z', payment_date: '2026-07-19T00:00:00Z',
      customer_name: 'Test Customer', customer_email: 'customer@example.com', shipping_address: { line1: '1 Test Street', city: 'Auckland', country: 'NZ' }, billing_address: {},
      items: [{ product_name: product.name, sku: variant.sku, quantity: 2, size: variant.size, colour: variant.colour, style: variant.style, player_name: '', player_number: '', unit_price_cents: product.priceCents, customisation_total_cents: 0, item_total_cents: product.priceCents * 2 }],
      subtotal_cents: product.priceCents * 2, personalisation_cents: 0, discount_cents: 0, shipping_cents: 0, tax_cents: 0,
      payment_surcharge_cents: 216, payment_surcharge_enabled: 1, payment_surcharge_percent: '2.65', payment_surcharge_fixed_cents: 30,
      payment_surcharge_label: 'Card processing surcharge', total_cents: product.priceCents * 2 + 216,
      refunded_cents: 0, payment_surcharge_refunded_cents: 0, currency: 'NZD', payment_status: 'paid', payment_method_label: 'card'
    };
    await invoicePage.route('**/admin/invoice.html?*', route => route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(root, 'admin', 'invoice.html')) }));
    await invoicePage.route('**/admin/invoice.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: readFileSync(join(root, 'admin', 'invoice.js')) }));
    await invoicePage.route('**/admin/invoice.css', route => route.fulfill({ status: 200, contentType: 'text/css', body: readFileSync(join(root, 'admin', 'invoice.css')) }));
    await invoicePage.route('**/api/admin/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ csrfToken: 'test-csrf' }) }));
    await invoicePage.route('**/api/admin/orders/1/invoice', route => {
      assert.equal(route.request().headers()['x-csrf-token'], 'test-csrf');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, order: invoiceOrder }) });
    });
    await invoicePage.goto(`${baseUrl}/admin/invoice.html?order=1`, { waitUntil: 'networkidle' });
    await invoicePage.getByText('Card processing surcharge', { exact: true }).waitFor();
    assert.match(await invoicePage.locator('.invoice-totals').innerText(), /Total paid[\s\S]*NZD/);
    const pdfPath = join(tmpdir(), 'ptg-surcharge-invoice.pdf');
    await invoicePage.pdf({ path: pdfPath, format: 'A4', printBackground: true });
    assert.ok(statSync(pdfPath).size > 1000);
    await invoicePage.close();
  } finally {
    await browser.close();
  }
  console.log(`Local surcharge smoke test passed at ${baseUrl}`);
  console.log(`Screenshots: ${join(tmpdir(), 'ptg-surcharge-mobile.png')} and ${join(tmpdir(), 'ptg-surcharge-desktop.png')}`);
  console.log(`Invoice PDF: ${join(tmpdir(), 'ptg-surcharge-invoice.pdf')}`);
} finally {
  stopServer();
}
