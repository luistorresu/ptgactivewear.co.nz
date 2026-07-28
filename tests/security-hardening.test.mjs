import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import worker from '../_worker.js';
import { authInternals, getAdminIdentity, handleAdminAuth, isAdminMutationAllowed } from '../worker/auth.js';
import { checkKvRateLimit, readLimitedJson } from '../worker/request-security.js';

function memoryKv() {
  const values = new Map();
  return {
    async get(key) { return values.get(key) ?? null; },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); }
  };
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });
const issuer = 'https://ptg-security-test.cloudflareaccess.com';
const audience = 'ptg-admin-audience';
const approvedEmails = 'first@example.com,second@example.com,third@example.com';
const accessEnv = {
  ADMIN_AUTH_MODE: 'access',
  ADMIN_ALLOWED_EMAILS: approvedEmails,
  CF_ACCESS_TEAM_DOMAIN: issuer,
  CF_ACCESS_AUD: audience
};

function accessToken(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = encode({ alg: 'RS256', typ: 'JWT', kid: 'test-key' });
  const encodedPayload = encode({
    iss: issuer,
    aud: audience,
    exp: now + 300,
    iat: now,
    sub: 'access-user-id',
    email: 'first@example.com',
    ...overrides
  });
  const signature = sign('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedPayload}`), privateKey).toString('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function accessRequest(path = '/api/admin/me', token = accessToken(), options = {}) {
  return new Request(`https://ptgactivewear.co.nz${path}`, {
    ...options,
    headers: {
      'Cf-Access-Jwt-Assertion': token,
      ...(options.headers || {})
    }
  });
}

test('Cloudflare Access identity validates signature, issuer, audience, expiry and approved email', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), `${issuer}/cdn-cgi/access/certs`);
    return Response.json({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] });
  };
  try {
    const valid = await getAdminIdentity(accessRequest(), accessEnv);
    assert.equal(valid.email, 'first@example.com');
    assert.equal(valid.authMethod, 'cloudflare-access');
    const validWithMultipleConfiguredAudiences = await getAdminIdentity(accessRequest(), {
      ...accessEnv,
      CF_ACCESS_AUD: `another-application,${audience}`
    });
    assert.equal(validWithMultipleConfiguredAudiences.email, 'first@example.com');

    assert.equal(await getAdminIdentity(accessRequest('/api/admin/me', accessToken({ aud: 'wrong' })), accessEnv), null);
    assert.equal(await getAdminIdentity(accessRequest('/api/admin/me', accessToken({ iss: 'https://wrong.cloudflareaccess.com' })), accessEnv), null);
    assert.equal(await getAdminIdentity(accessRequest('/api/admin/me', accessToken({ exp: Math.floor(Date.now() / 1000) - 1 })), accessEnv), null);
    assert.equal(await getAdminIdentity(accessRequest('/api/admin/me', accessToken({ email: 'unapproved@example.com' })), accessEnv), null);
    assert.equal(await getAdminIdentity(accessRequest('/api/admin/me', `${accessToken()}x`), accessEnv), null);
    assert.equal(await getAdminIdentity(accessRequest(), {
      ...accessEnv,
      ADMIN_ALLOWED_EMAILS: `${approvedEmails},fourth@example.com`
    }), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Access mode fails closed and Access mutations require same origin plus the admin header', async () => {
  assert.equal(await getAdminIdentity(new Request('https://ptgactivewear.co.nz/api/admin/me'), accessEnv), null);
  const identity = { authMethod: 'cloudflare-access', email: 'first@example.com' };
  const valid = new Request('https://ptgactivewear.co.nz/api/admin/products/test', {
    method: 'PUT',
    headers: {
      Origin: 'https://ptgactivewear.co.nz',
      'Content-Type': 'application/json',
      'X-PTG-Admin-Request': '1'
    },
    body: '{}'
  });
  const wrongOrigin = new Request(valid, { headers: { ...Object.fromEntries(valid.headers), Origin: 'https://evil.example' } });
  assert.equal(isAdminMutationAllowed(valid, identity), true);
  assert.equal(isAdminMutationAllowed(wrongOrigin, identity), false);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] });
  try {
    const logout = await handleAdminAuth(accessRequest('/api/admin/logout', accessToken(), {
      method: 'POST',
      headers: { Origin: 'https://ptgactivewear.co.nz', 'Content-Type': 'application/json' },
      body: '{}'
    }), accessEnv);
    assert.equal(logout.status, 200);
    assert.equal((await logout.json()).logoutUrl, '/cdn-cgi/access/logout');
    assert.equal(logout.headers.get('x-frame-options'), 'DENY');
    assert.equal(logout.headers.get('strict-transport-security'), 'max-age=31536000');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('legacy transition login enforces a streamed request-body limit', async () => {
  const response = await handleAdminAuth(new Request('https://ptgactivewear.co.nz/api/admin/login', {
    method: 'POST',
    headers: {
      Origin: 'https://ptgactivewear.co.nz',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username: 'admin', password: 'x'.repeat(5000) })
  }), {
    ADMIN_AUTH_MODE: 'legacy',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD_HASH: 'pbkdf2-sha256$100000$abcdefghijklmnop$abcdefghijklmnopqrstuvwxyz012345',
    SESSION_SECRET: 'a'.repeat(32),
    ORDER_EVENT_STORE: memoryKv()
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, 'REQUEST_TOO_LARGE');
});

test('bounded readers reject oversized chunked JSON and invalid UTF-8', async () => {
  const oversized = await readLimitedJson(new Request('https://example.com/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"1234567890"}'));
        controller.close();
      }
    }),
    duplex: 'half'
  }), 8);
  assert.equal(oversized.status, 413);
  assert.equal(oversized.code, 'REQUEST_TOO_LARGE');

  const invalid = await readLimitedJson(new Request('https://example.com/api', {
    method: 'POST',
    body: new Uint8Array([0xff, 0xfe])
  }), 8);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.code, 'INVALID_REQUEST_ENCODING');
});

test('public browser actions reject cross-origin requests and enforce hard body limits', async () => {
  const crossOrigin = await worker.fetch(new Request('https://ptgactivewear.co.nz/api/checkout-summary', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: '{"items":[]}'
  }), {});
  assert.equal(crossOrigin.status, 403);

  const oversized = await worker.fetch(new Request('https://ptgactivewear.co.nz/api/contact', {
    method: 'POST',
    headers: { Origin: 'https://ptgactivewear.co.nz', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test', email: 'test@example.com', message: 'x'.repeat(20 * 1024) })
  }), {});
  assert.equal(oversized.status, 413);
});

test('public email failures do not log the Resend response body', async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logged = [];
  globalThis.fetch = async () => new Response('private-provider-diagnostic', { status: 422 });
  console.error = (...values) => logged.push(values);
  try {
    const response = await worker.fetch(new Request('https://ptgactivewear.co.nz/api/contact', {
      method: 'POST',
      headers: { Origin: 'https://ptgactivewear.co.nz', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'test@example.com', message: 'Hello', website: '' })
    }), {
      EMAIL_PROVIDER: 'resend',
      EMAIL_API_KEY: 'test-key',
      CONTACT_TO_EMAIL: 'info@example.com',
      CONTACT_FROM_EMAIL: 'info@example.com',
      ORDER_EVENT_STORE: memoryKv()
    });
    assert.equal(response.status, 502);
    assert.doesNotMatch(JSON.stringify(logged), /private-provider-diagnostic/);
    assert.match(JSON.stringify(logged), /RESEND_HTTP_422/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test('public email retries send a stable provider idempotency key', async () => {
  const originalFetch = globalThis.fetch;
  const keys = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    keys.push(options.headers['Idempotency-Key']);
    return Response.json({ id: 'email-test' });
  };
  try {
    const env = {
      EMAIL_PROVIDER: 'resend',
      EMAIL_API_KEY: 'test-key',
      CONTACT_TO_EMAIL: 'info@example.com',
      CONTACT_FROM_EMAIL: 'info@example.com',
      ORDER_EVENT_STORE: memoryKv()
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await worker.fetch(new Request('https://ptgactivewear.co.nz/api/contact', {
        method: 'POST',
        headers: {
          Origin: 'https://ptgactivewear.co.nz',
          'Content-Type': 'application/json',
          'X-Request-ID': 'contact-retry-1234',
          'CF-Connecting-IP': '192.0.2.20'
        },
        body: JSON.stringify({ name: 'Test', email: 'test@example.com', message: 'Hello', website: '' })
      }), env);
      assert.equal(response.status, 200);
    }
    assert.deepEqual(keys, ['ptg-contact-contact-retry-1234', 'ptg-contact-contact-retry-1234']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('KV rate limiter returns a retry interval after the configured allowance', async () => {
  const env = { ORDER_EVENT_STORE: memoryKv() };
  const request = new Request('https://ptgactivewear.co.nz/api/contact', {
    headers: { 'CF-Connecting-IP': '192.0.2.1' }
  });
  assert.equal((await checkKvRateLimit(env, request, 'test', { limit: 2, windowSeconds: 60 })).allowed, true);
  assert.equal((await checkKvRateLimit(env, request, 'test', { limit: 2, windowSeconds: 60 })).allowed, true);
  const blocked = await checkKvRateLimit(env, request, 'test', { limit: 2, windowSeconds: 60 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter >= 1 && blocked.retryAfter <= 60);
});

test('HTTP requests redirect to the canonical HTTPS hostname before routing', async () => {
  const response = await worker.fetch(new Request('http://www.ptgactivewear.co.nz/admin?view=orders'), {
    ENVIRONMENT: 'production'
  });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), 'https://ptgactivewear.co.nz/admin?view=orders');
});

test('local HTTP development remains available without an HTTPS redirect', async () => {
  const response = await worker.fetch(new Request('http://127.0.0.1:8787/'), {
    ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }) }
  });
  assert.equal(response.status, 200);
});

test('asset security headers avoid unverified HSTS subdomain scope', async () => {
  const response = await worker.fetch(new Request('https://ptgactivewear.co.nz/'), {
    ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }) }
  });
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.doesNotMatch(response.headers.get('strict-transport-security'), /includeSubDomains/i);
});

test('Access configuration requires exactly three approved addresses', () => {
  assert.equal(authInternals.accessConfigured(accessEnv), true);
  assert.equal(authInternals.accessConfigured({ ...accessEnv, ADMIN_ALLOWED_EMAILS: 'first@example.com,second@example.com' }), false);
  assert.equal(authInternals.accessConfigured({ ...accessEnv, CF_ACCESS_AUD: '' }), false);
});

test('business and customer order emails use stable checkout-session idempotency keys', async () => {
  const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
  assert.match(source, /idempotencyKey: `ptg-order-business-\$\{emailIdempotencyKey\}`/);
  assert.match(source, /idempotencyKey: `ptg-order-customer-\$\{emailIdempotencyKey\}`/);
  assert.match(source, /String\(session\.id \|\| ''\)/);
});
