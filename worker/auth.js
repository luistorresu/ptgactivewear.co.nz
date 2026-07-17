let cachedKeys = null;
let cachedKeysExpiresAt = 0;

function base64UrlToBytes(value) {
  const normalised = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

function getAllowedEmails(env) {
  return String(env.ADMIN_ALLOWED_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

function cookieValue(request, name) {
  const cookies = String(request.headers.get('cookie') || '').split(';');
  const match = cookies.map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function authJson(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

async function sessionIdentity(request, env) {
  if (!env.ORDER_EVENT_STORE) return null;
  const token = cookieValue(request, 'ptg_admin_session');
  if (!token) return null;
  const session = await env.ORDER_EVENT_STORE.get(`admin:session:${await digest(token)}`, 'json');
  if (!session?.email || !getAllowedEmails(env).includes(session.email)) return null;
  return { email: session.email, subject: 'email-code-session', expiresAt: session.expiresAt };
}

function isLocalDevelopment(request, env) {
  const hostname = new URL(request.url).hostname;
  return String(env.ENVIRONMENT || '').toLowerCase() === 'development'
    && (hostname === 'localhost' || hostname === '127.0.0.1');
}

async function getAccessKeys(env) {
  const now = Date.now();
  if (cachedKeys && cachedKeysExpiresAt > now) return cachedKeys;

  const teamDomain = String(env.ACCESS_TEAM_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!teamDomain) throw new Error('Cloudflare Access team domain is not configured.');

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) throw new Error('Cloudflare Access signing keys could not be loaded.');

  const body = await response.json();
  cachedKeys = Array.isArray(body.keys) ? body.keys : [];
  cachedKeysExpiresAt = now + (60 * 60 * 1000);
  return cachedKeys;
}

async function verifyAccessJwt(token, env) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;

  let header;
  let payload;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch (error) {
    return null;
  }

  if (header.alg !== 'RS256' || !header.kid) return null;

  const keys = await getAccessKeys(env);
  const jwk = keys.find(key => key.kid === header.kid);
  if (!jwk) return null;

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );

  if (!verified) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now || (payload.nbf && payload.nbf > now)) return null;

  const requiredAudiences = String(env.ACCESS_AUD || '').split(',').map(value => value.trim()).filter(Boolean);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!requiredAudiences.length || !requiredAudiences.some(audience => audiences.includes(audience))) return null;

  const email = String(payload.email || payload.sub || '').trim().toLowerCase();
  if (!email) return null;

  return { email, subject: String(payload.sub || ''), expiresAt: payload.exp };
}

export async function getAdminIdentity(request, env) {
  if (isLocalDevelopment(request, env)) {
    const email = String(env.LOCAL_ADMIN_EMAIL || '').trim().toLowerCase();
    if (!email) return null;
    return { email, subject: 'local-development', expiresAt: null, local: true };
  }

  const session = await sessionIdentity(request, env);
  if (session) return session;

  const assertion = request.headers.get('cf-access-jwt-assertion') || '';
  if (!assertion) return null;
  const identity = await verifyAccessJwt(assertion, env);
  if (!identity) return null;

  const allowedEmails = getAllowedEmails(env);
  if (!allowedEmails.length || !allowedEmails.includes(identity.email)) return null;

  return identity;
}

export async function handleAdminAuth(request, env) {
  if (!env.ORDER_EVENT_STORE) return authJson({ ok: false, error: 'Admin authentication is not configured.' }, 503);
  const url = new URL(request.url);

  if (url.pathname.endsWith('/logout')) {
    const token = cookieValue(request, 'ptg_admin_session');
    if (token) await env.ORDER_EVENT_STORE.delete(`admin:session:${await digest(token)}`);
    return new Response(null, { status: 302, headers: {
      Location: '/admin/login',
      'Set-Cookie': 'ptg_admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
      'Cache-Control': 'no-store'
    } });
  }

  if (request.method !== 'POST') return authJson({ ok: false, error: 'Method not allowed.' }, 405);
  let body;
  try { body = await request.json(); } catch { return authJson({ ok: false, error: 'Invalid request.' }, 400); }
  const email = String(body.email || '').trim().toLowerCase();
  if (!getAllowedEmails(env).includes(email)) return authJson({ ok: false, error: 'This email is not authorised.' }, 403);

  if (url.pathname.endsWith('/request-code')) {
    const rateKey = `admin:rate:${email}`;
    if (await env.ORDER_EVENT_STORE.get(rateKey)) return authJson({ ok: false, error: 'Please wait before requesting another code.' }, 429);
    if (!env.EMAIL_API_KEY || !env.CONTACT_FROM_EMAIL) return authJson({ ok: false, error: 'Email delivery is not configured.' }, 503);
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
    await env.ORDER_EVENT_STORE.put(`admin:code:${email}`, await digest(`${email}:${code}`), { expirationTtl: 600 });
    await env.ORDER_EVENT_STORE.put(rateKey, '1', { expirationTtl: 60 });
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: {
      Authorization: `Bearer ${env.EMAIL_API_KEY}`, 'Content-Type': 'application/json'
    }, body: JSON.stringify({ from: env.CONTACT_FROM_EMAIL, to: [email], subject: 'Your PTG Activewear admin sign-in code',
      text: `Your PTG Activewear admin sign-in code is ${code}. It expires in 10 minutes.` }) });
    if (!response.ok) return authJson({ ok: false, error: 'The sign-in code could not be sent.' }, 502);
    return authJson({ ok: true });
  }

  if (url.pathname.endsWith('/verify-code')) {
    const code = String(body.code || '').trim();
    const stored = await env.ORDER_EVENT_STORE.get(`admin:code:${email}`);
    if (!/^\d{6}$/.test(code) || !stored || stored !== await digest(`${email}:${code}`)) {
      return authJson({ ok: false, error: 'The code is invalid or has expired.' }, 401);
    }
    await env.ORDER_EVENT_STORE.delete(`admin:code:${email}`);
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = [...tokenBytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const maxAge = 60 * 60 * 8;
    await env.ORDER_EVENT_STORE.put(`admin:session:${await digest(token)}`, JSON.stringify({ email, expiresAt: Date.now() + maxAge * 1000 }), { expirationTtl: maxAge });
    return authJson({ ok: true }, 200, { 'Set-Cookie': `ptg_admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}` });
  }

  return authJson({ ok: false, error: 'Not found.' }, 404);
}

export function isAdminMutationAllowed(request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('origin');
  const contentType = request.headers.get('content-type') || '';
  const adminHeader = request.headers.get('x-ptg-admin-request');
  const bodylessDelete = request.method.toUpperCase() === 'DELETE' && !contentType;

  const safeContentType = contentType.toLowerCase().includes('application/json')
    || contentType.toLowerCase().startsWith('multipart/form-data;')
    || bodylessDelete;
  return origin === requestUrl.origin
    && safeContentType
    && adminHeader === '1';
}
