import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = String(process.env.PTG_ADMIN_BASE_URL || 'http://127.0.0.1:8790').replace(/\/$/, '');
const username = process.env.PTG_ADMIN_USERNAME || 'ptg-local-admin';
const password = process.env.PTG_ADMIN_PASSWORD || '';
const live = !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(baseUrl);
if (!password) throw new Error('PTG_ADMIN_PASSWORD is required.');
if (live && process.env.PTG_ALLOW_LIVE_MUTATIONS !== '1') throw new Error('Set PTG_ALLOW_LIVE_MUTATIONS=1 for an authorised live mutation test.');

const origin = new URL(baseUrl).origin;
const suffix = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
const productId = `codex-admin-test-${suffix}`;
const unusedId = `codex-delete-test-${suffix}`;
let cookie = '';
let csrfToken = '';
const report = [];

function pass(name, details = '') {
  report.push({ name, status: 'passed', details });
}

async function responseJson(response) {
  return response.json().catch(() => ({}));
}

async function request(path, options = {}, expected = 200) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (cookie) headers.set('Cookie', cookie);
  if (!['GET', 'HEAD'].includes(method)) {
    headers.set('Origin', origin);
    headers.set('X-PTG-Admin-Request', '1');
    headers.set('X-CSRF-Token', csrfToken);
    if (options.body !== undefined && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${baseUrl}${path}`, { ...options, method, headers, redirect: 'manual' });
  const data = await responseJson(response);
  assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, received ${response.status}: ${JSON.stringify(data)}`);
  return { response, data };
}

function productPayload({ id, publish = false, stock = 0 } = {}) {
  return {
    name: `Codex Admin Test ${suffix}`,
    slug: id,
    description: 'Temporary admin integration test product.',
    category: 'Test',
    productType: 'Jersey',
    badge: '',
    priceCents: 12345,
    currency: 'NZD',
    seoTitle: '',
    metaDescription: '',
    active: publish,
    availableForSale: publish,
    featured: false,
    trackInventory: true,
    allowPlayerName: true,
    allowPlayerNumber: true,
    playerNamePriceCents: 2000,
    playerNumberPriceCents: 2000,
    version: 1,
    variants: [{
      sku: `CODEX-${suffix.toUpperCase()}-S`,
      size: 'S',
      colour: 'Black',
      style: 'Test',
      stockQuantity: stock,
      active: true,
      allowPlayerName: null,
      allowPlayerNumber: null
    }]
  };
}

async function upload(product, path, type, name, requestId = crypto.randomUUID(), expected = 201, bytes = null) {
  const form = new FormData();
  const contents = bytes || await readFile(resolve(path));
  form.append('file', new Blob([contents], { type }), name);
  form.append('requestId', requestId);
  form.append('altText', `Test ${name}`);
  form.append('variantStyle', name);
  return request(`/api/admin/products/${encodeURIComponent(product)}/pictures`, {
    method: 'POST',
    body: form,
    headers: { 'X-Upload-Request-ID': requestId, 'X-Request-ID': requestId }
  }, expected);
}

async function cleanup(product) {
  if (!product) return;
  await request(`/api/admin/products/${encodeURIComponent(product)}/unpublish`, { method: 'POST', body: '{}' }, 200).catch(() => {});
  await request(`/api/admin/products/${encodeURIComponent(product)}/archive`, { method: 'POST', body: '{}' }, 200).catch(() => {});
  const pictures = await request(`/api/admin/products/${encodeURIComponent(product)}/pictures`, {}, 200).catch(() => null);
  for (const picture of pictures?.data?.pictures || []) {
    await request(`/api/admin/pictures/${picture.id}`, { method: 'DELETE' }, 200).catch(() => {});
  }
  await request(`/api/admin/products/${encodeURIComponent(product)}`, { method: 'DELETE' }, 200).catch(() => {});
}

try {
  const unauthorised = await fetch(`${baseUrl}/api/admin/products`, { headers: { Accept: 'application/json' } });
  assert.equal(unauthorised.status, 401);
  pass('Unauthenticated API is rejected');

  const wrongLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `${username}-wrong`, password: 'wrong-password' })
  });
  assert.equal(wrongLogin.status, 401);
  pass('Incorrect credentials are rejected');

  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(login.status, 200, JSON.stringify(await responseJson(login)));
  cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  pass('Correct credentials create an HttpOnly session');

  const session = await request('/api/admin/session');
  csrfToken = session.data.csrfToken;
  assert.ok(csrfToken);
  pass('Session returns an in-memory CSRF token');

  const adminPage = await fetch(`${baseUrl}/admin`, { headers: { Cookie: cookie } });
  const adminHtml = await adminPage.text();
  assert.equal(adminPage.status, 200);
  assert.match(adminHtml, /data-view-target="products"/);
  assert.match(adminHtml, /data-view-target="pictures"/);
  const picturesPage = await fetch(`${baseUrl}/admin/pictures`, { headers: { Cookie: cookie } });
  assert.equal(picturesPage.status, 200);
  pass('Authenticated Products and Pictures screens load');

  const invalidCsrf = await fetch(`${baseUrl}/api/admin/products`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-PTG-Admin-Request': '1', 'X-CSRF-Token': 'wrong' },
    body: '{}'
  });
  assert.equal(invalidCsrf.status, 403);
  pass('Invalid CSRF token is rejected');

  const invalidPrice = productPayload({ id: `${productId}-bad-price` });
  invalidPrice.priceCents = -1;
  await request('/api/admin/products', { method: 'POST', body: JSON.stringify(invalidPrice) }, 400);
  const invalidStock = productPayload({ id: `${productId}-bad-stock` });
  invalidStock.variants[0].stockQuantity = -1;
  await request('/api/admin/products', { method: 'POST', body: JSON.stringify(invalidStock) }, 400);
  pass('Invalid price and negative stock are rejected');

  const created = await request('/api/admin/products', { method: 'POST', body: JSON.stringify(productPayload({ id: productId, publish: true })) }, 201);
  assert.equal(created.data.product.active, false);
  assert.equal(created.data.publishRequested, true);
  await request('/api/admin/products', { method: 'POST', body: JSON.stringify(productPayload({ id: productId })) }, 409);
  pass('Product creation is recoverable and duplicate slugs are rejected');

  const invalidSignature = new TextEncoder().encode('not really an image');
  await upload(productId, '', 'image/jpeg', 'invalid.jpg', crypto.randomUUID(), 400, invalidSignature);
  await upload(productId, '', 'text/plain', 'unsupported.txt', crypto.randomUUID(), 400, invalidSignature);
  await upload(productId, '', 'image/png', 'oversized.png', crypto.randomUUID(), 400, new Uint8Array(8 * 1024 * 1024 + 1));
  pass('Invalid, unsupported and oversized uploads are rejected');

  const jpeg = await upload(productId, 'photos/logo/logo.jpeg', 'image/jpeg', 'same-name.jpg');
  const png = await upload(productId, 'photos/logo-white-bg.png', 'image/png', 'same-name.png');
  const webpRequestId = crypto.randomUUID();
  const webp = await upload(productId, 'photos/ptg-logo-dark-transparent.webp', 'image/webp', 'same-name.webp', webpRequestId);
  const retry = await upload(productId, 'photos/ptg-logo-dark-transparent.webp', 'image/webp', 'same-name.webp', webpRequestId, 200);
  assert.equal(retry.data.idempotent, true);
  assert.equal(webp.data.pictures.length, 3);
  pass('JPEG, PNG and WebP upload repeatedly with server-generated names and idempotent retry');

  const pictureIds = webp.data.pictures.map(picture => picture.id);
  await request(`/api/admin/pictures/${pictureIds.at(-1)}/set-primary`, { method: 'POST', body: '{}' });
  await request(`/api/admin/products/${encodeURIComponent(productId)}/pictures/reorder`, {
    method: 'POST', body: JSON.stringify({ pictureIds: [...pictureIds].reverse() })
  });
  const replaceId = jpeg.data.pictures[0].id;
  const replacementForm = new FormData();
  const replacementBytes = await readFile(resolve('photos/logo-header-dark.png'));
  const replacementRequestId = crypto.randomUUID();
  replacementForm.append('file', new Blob([replacementBytes], { type: 'image/png' }), 'replacement.png');
  replacementForm.append('requestId', replacementRequestId);
  replacementForm.append('altText', 'Replacement picture');
  replacementForm.append('variantStyle', 'Replacement');
  replacementForm.append('replacePictureId', String(replaceId));
  await request(`/api/admin/products/${encodeURIComponent(productId)}/pictures`, {
    method: 'POST', body: replacementForm, headers: { 'X-Upload-Request-ID': replacementRequestId }
  });
  await request(`/api/admin/pictures/${png.data.pictures.find(picture => picture.id !== replaceId).id}`, { method: 'DELETE' });
  pass('Main picture, reorder, replace and delete operations succeed');

  const published = await request(`/api/admin/products/${encodeURIComponent(productId)}/publish`, { method: 'POST', body: '{}' });
  assert.equal(published.data.product.active, true);
  const publicProduct = await fetch(`${baseUrl}/api/products/${encodeURIComponent(productId)}`);
  assert.equal(publicProduct.status, 200);
  pass('A valid product publishes and appears in the public catalogue');

  const current = (await request(`/api/admin/products/${encodeURIComponent(productId)}`)).data.product;
  const updatedPayload = {
    ...productPayload({ id: productId }),
    name: `${current.name} Updated`,
    priceCents: 13000,
    active: current.active,
    availableForSale: current.availableForSale,
    version: current.version
  };
  delete updatedPayload.variants;
  const updated = await request(`/api/admin/products/${encodeURIComponent(productId)}`, { method: 'PUT', body: JSON.stringify(updatedPayload) });
  assert.equal(updated.data.product.priceCents, 13000);
  pass('Product name and price edit successfully');

  const firstVariant = updated.data.product.variants[0];
  const variantUpdate = await request(`/api/admin/variants/${firstVariant.id}`, { method: 'PUT', body: JSON.stringify({
    sku: firstVariant.sku,
    size: 'M',
    colour: 'Navy',
    style: 'Test',
    active: true,
    allowPlayerName: firstVariant.allowPlayerName,
    allowPlayerNumber: firstVariant.allowPlayerNumber,
    version: firstVariant.version
  }) });
  const secondSku = `CODEX-${suffix.toUpperCase()}-L`;
  await request(`/api/admin/products/${encodeURIComponent(productId)}/variants`, { method: 'POST', body: JSON.stringify({
    sku: secondSku,
    size: 'L',
    colour: 'Navy',
    style: 'Test',
    active: true,
    allowPlayerName: null,
    allowPlayerNumber: null
  }) }, 201);
  await request(`/api/admin/products/${encodeURIComponent(productId)}/variants`, { method: 'POST', body: JSON.stringify({
    sku: secondSku,
    size: 'XL',
    colour: 'Navy',
    style: 'Test',
    active: true,
    allowPlayerName: null,
    allowPlayerNumber: null
  }) }, 409);
  pass('Variant editing, multiple sizes and duplicate SKU rejection work');

  if (!live) {
    const stock = await request(`/api/admin/variants/${firstVariant.id}/adjust-stock`, { method: 'POST', body: JSON.stringify({
      type: 'set', quantity: 4, reason: 'Local integration stock test', version: variantUpdate.data.variant.version
    }) });
    assert.equal(stock.data.variant.stockQuantity, 4);
    pass('Stock update is recorded locally');
  }

  await request(`/api/admin/products/${encodeURIComponent(productId)}/unpublish`, { method: 'POST', body: '{}' });
  await request(`/api/admin/products/${encodeURIComponent(productId)}/archive`, { method: 'POST', body: '{}' });
  const restored = await request(`/api/admin/products/${encodeURIComponent(productId)}/restore`, { method: 'POST', body: '{}' });
  assert.equal(restored.data.product.archived, false);
  assert.equal(restored.data.product.active, false);
  pass('Unpublish, archive and restore lifecycle operations succeed');

  if (!live) {
    await request(`/api/admin/products/${encodeURIComponent(productId)}/archive`, { method: 'POST', body: '{}' });
    const currentPictures = await request(`/api/admin/products/${encodeURIComponent(productId)}/pictures`);
    for (const picture of currentPictures.data.pictures) await request(`/api/admin/pictures/${picture.id}`, { method: 'DELETE' });
    const blockedDelete = await request(`/api/admin/products/${encodeURIComponent(productId)}`, { method: 'DELETE' }, 409);
    assert.equal(blockedDelete.data.code, 'HISTORICAL_REFERENCES');
    pass('Permanent deletion is rejected when stock history exists');
  }

  const unusedPayload = productPayload({ id: unusedId });
  unusedPayload.name = `Unused Delete Test ${suffix}`;
  unusedPayload.variants = [];
  await request('/api/admin/products', { method: 'POST', body: JSON.stringify(unusedPayload) }, 201);
  await request(`/api/admin/products/${encodeURIComponent(unusedId)}/archive`, { method: 'POST', body: '{}' });
  await request(`/api/admin/products/${encodeURIComponent(unusedId)}`, { method: 'DELETE' });
  await request(`/api/admin/products/${encodeURIComponent(unusedId)}`, {}, 404);
  pass('Unused archived draft can be permanently deleted');

  for (const publicPath of ['/', '/shop', '/contact', '/api/products']) {
    const response = await fetch(`${baseUrl}${publicPath}`);
    assert.equal(response.status, 200, publicPath);
  }
  pass('Homepage, shop, contact and public catalogue still respond');

  if (live) await cleanup(productId);
  const logout = await request('/api/admin/logout', { method: 'POST', body: '{}' });
  assert.equal(logout.data.ok, true);
  const expiredSession = await fetch(`${baseUrl}/api/admin/session`, { headers: { Cookie: cookie, Accept: 'application/json' } });
  assert.equal(expiredSession.status, 401);
  pass('Logout invalidates the session');
  cookie = '';
  csrfToken = '';
} finally {
  await cleanup(productId).catch(() => {});
  await cleanup(unusedId).catch(() => {});
  if (cookie && csrfToken) {
    await request('/api/admin/logout', { method: 'POST', body: '{}' }).catch(() => {});
  }
}

console.log(JSON.stringify({ ok: true, baseUrl, live, checks: report }, null, 2));
