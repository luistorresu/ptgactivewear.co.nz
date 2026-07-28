export const TRAINING_KIT_ID = 'patagonia-fc-training-kit';
export const RESTRICTED_SHIRT_NUMBERS = new Set(['1', '7', '9', '10']);

const PROOF_VERSION = 1;
const PROOF_LIFETIME_MS = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

function base64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function signingKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(`ptg-training-kit-shirt-number:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function proofSecret(env) {
  return String(env.SHIRT_NUMBER_PROOF_SECRET || env.SESSION_SECRET || '');
}

export function trainingKitPlayerNameIsValid(value) {
  return !value || /^[\p{L} '’-]{1,20}$/u.test(value);
}

export function trainingKitShirtNumberIsValid(value) {
  return !value || /^(?:[1-9]|[1-9][0-9])$/.test(value);
}

export function restrictedShirtNumberError(number) {
  return `Shirt number ${number} is only available to players born on the ${number}${number === '1' ? 'st' : number === '7' ? 'th' : number === '9' ? 'th' : 'th'} day of the month. Please enter the correct day or choose another number.`;
}

export async function issueTrainingKitEligibilityProof(numberValue, birthDayValue, env, now = Date.now()) {
  const number = String(numberValue ?? '').trim();
  const birthDay = String(birthDayValue ?? '').trim();
  if (!RESTRICTED_SHIRT_NUMBERS.has(number)) return { error: 'This shirt number does not require birth-day validation.' };
  if (birthDay !== number) return { error: restrictedShirtNumberError(number) };
  const secret = proofSecret(env);
  if (!secret) return { error: 'Shirt-number validation is temporarily unavailable.', configurationError: true };

  const payload = base64Url(encoder.encode(JSON.stringify({
    v: PROOF_VERSION,
    p: TRAINING_KIT_ID,
    n: number,
    verified: true,
    exp: now + PROOF_LIFETIME_MS
  })));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload));
  return { token: `${payload}.${base64Url(signature)}`, expiresAt: now + PROOF_LIFETIME_MS };
}

export async function verifyTrainingKitEligibilityProof(tokenValue, numberValue, env, now = Date.now()) {
  const token = String(tokenValue ?? '').trim();
  const number = String(numberValue ?? '').trim();
  if (!RESTRICTED_SHIRT_NUMBERS.has(number)) return true;
  const secret = proofSecret(env);
  if (!token || !secret) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;

  try {
    const validSignature = await crypto.subtle.verify(
      'HMAC',
      await signingKey(secret),
      decodeBase64Url(signature),
      encoder.encode(payload)
    );
    if (!validSignature) return false;
    const proof = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    return proof.v === PROOF_VERSION
      && proof.p === TRAINING_KIT_ID
      && proof.n === number
      && proof.verified === true
      && Number.isFinite(proof.exp)
      && proof.exp > now;
  } catch {
    return false;
  }
}
