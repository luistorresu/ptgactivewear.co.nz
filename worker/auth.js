const SESSION_COOKIE = 'ptg_admin_session';
const SESSION_SECONDS = 60 * 60 * 8;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_FAILURES = 5;
const PASSWORD_HASH_PATTERN = /^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

function base64UrlToBytes(value) {
  const normalised = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function cookieValue(request, name) {
  const cookies = String(request.headers.get('cookie') || '').split(';');
  const match = cookies.map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return bytesToBase64Url(new Uint8Array(bytes));
}

function safeEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

function authJson(body, status = 200, requestId = '', headers = {}) {
  return new Response(JSON.stringify({ ...body, requestId }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-ID': requestId,
      ...headers
    }
  });
}

function configured(env) {
  return Boolean(
    String(env.ADMIN_USERNAME || '').trim()
    && String(env.ADMIN_PASSWORD_HASH || '').trim()
    && String(env.SESSION_SECRET || '').length >= 32
    && env.ORDER_EVENT_STORE
  );
}

function cookieAttributes(request, maxAge) {
  const url = new URL(request.url);
  const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  return `Path=/; HttpOnly; ${isLocalHttp ? '' : 'Secure; '}SameSite=Strict; Max-Age=${maxAge}`;
}

function validSameOrigin(request) {
  const url = new URL(request.url);
  return request.headers.get('origin') === url.origin;
}

async function verifyPassword(password, storedHash) {
  const match = PASSWORD_HASH_PATTERN.exec(String(storedHash || '').trim());
  if (!match) return false;
  const iterations = Number(match[1]);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) return false;
  let salt;
  let expected;
  try {
    salt = base64UrlToBytes(match[2]);
    expected = base64UrlToBytes(match[3]);
  } catch {
    return false;
  }
  if (salt.length < 16 || expected.length < 32) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password || '')), 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    expected.length * 8
  ));
  return safeEqual(derived, expected);
}

async function rateKey(request, username) {
  const address = String(request.headers.get('cf-connecting-ip') || 'unknown').slice(0, 80);
  return `admin:login-rate:${await digest(`${String(username || '').toLowerCase()}|${address}`)}`;
}

async function loginRateState(env, key) {
  return (await env.ORDER_EVENT_STORE.get(key, 'json')) || { failures: 0, lockedUntil: 0 };
}

async function registerFailure(env, key, state) {
  const failures = Number(state.failures || 0) + 1;
  const lockedUntil = failures >= LOGIN_MAX_FAILURES ? Date.now() + LOGIN_WINDOW_SECONDS * 1000 : 0;
  await env.ORDER_EVENT_STORE.put(key, JSON.stringify({ failures, lockedUntil }), { expirationTtl: LOGIN_WINDOW_SECONDS });
  return { failures, lockedUntil };
}

async function createSession(request, env, username) {
  const payload = {
    sub: username,
    jti: crypto.randomUUID(),
    csrf: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24))),
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  };
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(encoded, env.SESSION_SECRET);
  await env.ORDER_EVENT_STORE.put(
    `admin:session:${await digest(payload.jti)}`,
    JSON.stringify({ username, expiresAt: payload.exp * 1000 }),
    { expirationTtl: SESSION_SECONDS }
  );
  return { token: `${encoded}.${signature}`, payload };
}

async function signedSessionIdentity(request, env) {
  if (!configured(env)) return null;
  const token = cookieValue(request, SESSION_COOKIE);
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return null;
  const expectedSignature = await hmac(encoded, env.SESSION_SECRET);
  if (!safeEqual(new TextEncoder().encode(signature), new TextEncoder().encode(expectedSignature))) return null;

  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded))); }
  catch { return null; }
  if (!payload?.sub || !payload?.jti || !payload?.csrf || !Number.isInteger(payload.exp)) return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  const username = String(env.ADMIN_USERNAME || '').trim();
  if (payload.sub !== username) return null;
  const stored = await env.ORDER_EVENT_STORE.get(`admin:session:${await digest(payload.jti)}`, 'json');
  if (!stored || stored.username !== username || Number(stored.expiresAt || 0) <= Date.now()) return null;
  return {
    username,
    email: username,
    subject: 'password-session',
    csrfToken: payload.csrf,
    sessionId: payload.jti,
    expiresAt: payload.exp * 1000
  };
}

export async function getAdminIdentity(request, env) {
  return signedSessionIdentity(request, env);
}

export async function handleAdminAuth(request, env) {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const action = url.pathname.split('/').filter(Boolean).at(-1) || '';
  const startedAt = Date.now();

  if (!configured(env)) {
    return authJson({ ok: false, code: 'ADMIN_AUTH_NOT_CONFIGURED', error: 'Admin authentication is not configured.' }, 503, requestId);
  }

  if (action === 'session' && request.method === 'GET') {
    const identity = await signedSessionIdentity(request, env);
    if (!identity) return authJson({ ok: false, error: 'Authentication is required.' }, 401, requestId);
    return authJson({
      ok: true,
      identity: { username: identity.username },
      csrfToken: identity.csrfToken,
      expiresAt: identity.expiresAt
    }, 200, requestId);
  }

  if (request.method !== 'POST') return authJson({ ok: false, error: 'Method not allowed.' }, 405, requestId);
  if (!validSameOrigin(request) || !String(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    return authJson({ ok: false, error: 'Request verification failed.' }, 403, requestId);
  }

  if (action === 'logout') {
    const identity = await signedSessionIdentity(request, env);
    if (identity && request.headers.get('x-csrf-token') === identity.csrfToken) {
      await env.ORDER_EVENT_STORE.delete(`admin:session:${await digest(identity.sessionId)}`);
      console.log(JSON.stringify({ scope: 'admin_auth', requestId, admin: identity.username, action: 'logout', status: 'succeeded', durationMs: Date.now() - startedAt }));
    }
    return authJson({ ok: true }, 200, requestId, {
      'Set-Cookie': `${SESSION_COOKIE}=; ${cookieAttributes(request, 0)}`
    });
  }

  if (action !== 'login') return authJson({ ok: false, error: 'Not found.' }, 404, requestId);
  let body;
  try { body = await request.json(); }
  catch { return authJson({ ok: false, error: 'Invalid request.' }, 400, requestId); }
  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');
  if (!username || !password || username.length > 160 || password.length > 1024) {
    return authJson({ ok: false, error: 'Enter your username and password.' }, 400, requestId);
  }

  const key = await rateKey(request, username);
  const state = await loginRateState(env, key);
  if (Number(state.lockedUntil || 0) > Date.now()) {
    console.log(JSON.stringify({ scope: 'admin_auth', requestId, admin: username, action: 'login', status: 'rate_limited', errorCode: 'LOGIN_LOCKED', durationMs: Date.now() - startedAt }));
    return authJson({ ok: false, code: 'LOGIN_LOCKED', error: 'Too many attempts. Try again in 15 minutes.' }, 429, requestId);
  }

  const validPassword = await verifyPassword(password, env.ADMIN_PASSWORD_HASH);
  const validUsername = username === String(env.ADMIN_USERNAME || '').trim();
  if (!validUsername || !validPassword) {
    const failed = await registerFailure(env, key, state);
    console.log(JSON.stringify({ scope: 'admin_auth', requestId, admin: username, action: 'login', status: 'failed', errorCode: 'INVALID_CREDENTIALS', durationMs: Date.now() - startedAt }));
    const locked = failed.lockedUntil > Date.now();
    return authJson({
      ok: false,
      code: locked ? 'LOGIN_LOCKED' : 'INVALID_CREDENTIALS',
      error: locked ? 'Too many attempts. Try again in 15 minutes.' : 'The username or password is incorrect.'
    }, locked ? 429 : 401, requestId);
  }

  await env.ORDER_EVENT_STORE.delete(key);
  const session = await createSession(request, env, username);
  console.log(JSON.stringify({ scope: 'admin_auth', requestId, admin: username, action: 'login', status: 'succeeded', durationMs: Date.now() - startedAt }));
  return authJson({ ok: true }, 200, requestId, {
    'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(session.token)}; ${cookieAttributes(request, SESSION_SECONDS)}`
  });
}

export function isAdminMutationAllowed(request, identity) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('origin');
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  const bodylessDelete = request.method.toUpperCase() === 'DELETE' && !contentType;
  const safeContentType = contentType.includes('application/json')
    || contentType.startsWith('multipart/form-data;')
    || bodylessDelete;
  return Boolean(identity?.csrfToken)
    && origin === requestUrl.origin
    && safeContentType
    && request.headers.get('x-ptg-admin-request') === '1'
    && request.headers.get('x-csrf-token') === identity.csrfToken;
}

export const authInternals = {
  verifyPassword,
  safeEqual,
  cookieAttributes,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_SECONDS,
  SESSION_SECONDS
};
