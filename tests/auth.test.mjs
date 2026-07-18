import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { getAdminIdentity, handleAdminAuth } from '../worker/auth.js';

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function passwordHash(password, iterations = 100000) {
  const salt = randomBytes(16);
  return `pbkdf2-sha256$${iterations}$${base64Url(salt)}$${base64Url(pbkdf2Sync(password, salt, iterations, 32, 'sha256'))}`;
}

function memoryKv() {
  const values = new Map();
  return {
    async get(key, type) {
      const value = values.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); }
  };
}

function environment(password = 'A-secure-test-password') {
  return {
    ADMIN_USERNAME: 'ptg-admin',
    ADMIN_PASSWORD_HASH: passwordHash(password),
    SESSION_SECRET: base64Url(randomBytes(48)),
    ORDER_EVENT_STORE: memoryKv()
  };
}

function loginRequest(password, url = 'http://localhost:8787/api/admin/login', username = 'ptg-admin') {
  const origin = new URL(url).origin;
  return new Request(url, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
}

test('password login creates an HttpOnly signed session and logout invalidates it', async () => {
  const password = 'A-secure-test-password';
  const env = environment(password);
  const response = await handleAdminAuth(loginRequest(password), env);
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /^ptg_admin_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Max-Age=28800/);
  assert.doesNotMatch(setCookie, /Secure/);
  const cookie = setCookie.split(';')[0];

  const identity = await getAdminIdentity(new Request('http://localhost:8787/api/admin/products', { headers: { Cookie: cookie } }), env);
  assert.equal(identity.username, 'ptg-admin');
  assert.ok(identity.csrfToken.length >= 20);

  const session = await handleAdminAuth(new Request('http://localhost:8787/api/admin/session', { headers: { Cookie: cookie } }), env);
  assert.equal(session.status, 200);
  assert.equal((await session.json()).identity.username, 'ptg-admin');

  const logout = await handleAdminAuth(new Request('http://localhost:8787/api/admin/logout', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'http://localhost:8787', 'Content-Type': 'application/json', 'X-CSRF-Token': identity.csrfToken },
    body: '{}'
  }), env);
  assert.equal(logout.status, 200);
  assert.equal(await getAdminIdentity(new Request('http://localhost:8787/api/admin/products', { headers: { Cookie: cookie } }), env), null);
});

test('production login cookie is Secure and invalid credentials are rejected', async () => {
  const env = environment();
  const wrong = await handleAdminAuth(loginRequest('wrong-password', 'https://ptgactivewear.co.nz/api/admin/login'), env);
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).code, 'INVALID_CREDENTIALS');

  const valid = await handleAdminAuth(loginRequest('A-secure-test-password', 'https://ptgactivewear.co.nz/api/admin/login'), env);
  assert.equal(valid.status, 200);
  assert.match(valid.headers.get('set-cookie'), /Secure/);
});

test('five failed login attempts trigger a temporary lockout', async () => {
  const env = environment();
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await handleAdminAuth(loginRequest('wrong-password'), env);
    assert.equal(response.status, 401);
  }
  const locked = await handleAdminAuth(loginRequest('wrong-password'), env);
  assert.equal(locked.status, 429);
  assert.equal((await locked.json()).code, 'LOGIN_LOCKED');
  const stillLocked = await handleAdminAuth(loginRequest('A-secure-test-password'), env);
  assert.equal(stillLocked.status, 429);
});

test('admin authentication fails closed when required secrets are missing', async () => {
  const response = await handleAdminAuth(loginRequest('anything'), { ORDER_EVENT_STORE: memoryKv() });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'ADMIN_AUTH_NOT_CONFIGURED');
});
