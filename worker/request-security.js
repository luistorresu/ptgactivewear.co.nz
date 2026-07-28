const encoder = new TextEncoder();

function bodyLength(request) {
  const value = String(request.headers.get('content-length') || '').trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}

export async function readLimitedBytes(request, maxBytes) {
  const declaredLength = bodyLength(request);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('A positive request body limit is required.');
  }
  if (Number.isNaN(declaredLength) || declaredLength > maxBytes) {
    return { error: 'Request body is too large.', code: 'REQUEST_TOO_LARGE', status: 413 };
  }
  if (!request.body) return { bytes: new Uint8Array() };

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { error: 'Request body is too large.', code: 'REQUEST_TOO_LARGE', status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { error: 'The request body could not be read.', code: 'INVALID_REQUEST_BODY', status: 400 };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

export async function readLimitedText(request, maxBytes) {
  const result = await readLimitedBytes(request, maxBytes);
  if (result.error) return result;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(result.bytes) };
  } catch {
    return { error: 'The request body must use UTF-8.', code: 'INVALID_REQUEST_ENCODING', status: 400 };
  }
}

export async function readLimitedJson(request, maxBytes) {
  const result = await readLimitedText(request, maxBytes);
  if (result.error) return result;
  try {
    return { body: JSON.parse(result.text) };
  } catch {
    return { error: 'Invalid JSON payload.', code: 'INVALID_JSON', status: 400 };
  }
}

export function isJsonRequest(request) {
  const type = String(request.headers.get('content-type') || '').toLowerCase().split(';', 1)[0].trim();
  return type === 'application/json' || type.endsWith('+json');
}

export function isSameOriginRequest(request) {
  let requestOrigin;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }
  return request.headers.get('origin') === requestOrigin;
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(String(value || '')));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function checkKvRateLimit(env, request, scope, {
  limit,
  windowSeconds,
  discriminator = ''
}) {
  if (!env.ORDER_EVENT_STORE) return { allowed: true, unavailable: true };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSeconds / windowSeconds);
  const address = String(request.headers.get('cf-connecting-ip') || 'unknown').slice(0, 80);
  const key = `rate:${scope}:${await digest(`${address}|${String(discriminator).toLowerCase()}|${bucket}`)}`;
  const current = Number(await env.ORDER_EVENT_STORE.get(key) || 0);
  const retryAfter = Math.max(1, ((bucket + 1) * windowSeconds) - nowSeconds);
  if (Number.isFinite(current) && current >= limit) {
    return { allowed: false, retryAfter };
  }
  await env.ORDER_EVENT_STORE.put(key, String((Number.isFinite(current) ? current : 0) + 1), {
    expirationTtl: windowSeconds + 60
  });
  return { allowed: true, retryAfter };
}
