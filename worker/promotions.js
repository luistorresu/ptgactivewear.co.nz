const MAX_CODE_LENGTH = 64;

function cleanCode(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').trim().toUpperCase().slice(0, MAX_CODE_LENGTH);
}

function integerCents(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function normalisePromotionCode(value) {
  return cleanCode(value);
}

export function calculatePromotion(items, promotion, eligibleProductIds) {
  if (!promotion) return {
    code: '', type: '', valueCents: 0, eligibleSubtotalCents: 0,
    discountCents: 0, eligibleProductIds: []
  };
  if (!Array.isArray(items) || !(eligibleProductIds instanceof Set)) {
    throw new Error('Promotion inputs are invalid.');
  }
  const valueCents = integerCents(promotion.value_cents);
  if (promotion.type !== 'fixed' || valueCents === null) {
    throw new Error('Promotion configuration is invalid.');
  }
  let eligibleSubtotalCents = 0;
  for (const item of items) {
    if (!eligibleProductIds.has(item.product?.id)) continue;
    const quantity = Number(item.quantity);
    const unitAmount = Number(item.product?.unitAmountNzdCents);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(unitAmount) || unitAmount < 0) {
      throw new Error('Promotion item values are invalid.');
    }
    eligibleSubtotalCents += unitAmount * quantity;
  }
  if (!Number.isSafeInteger(eligibleSubtotalCents)) throw new Error('Promotion subtotal is outside the supported range.');
  const discountCents = Math.min(valueCents, eligibleSubtotalCents);
  return {
    code: cleanCode(promotion.code),
    type: promotion.type,
    valueCents,
    eligibleSubtotalCents,
    discountCents,
    eligibleProductIds: [...eligibleProductIds]
  };
}

export async function resolvePromotion(db, suppliedCode, items, now = new Date()) {
  if (suppliedCode === undefined || suppliedCode === null || suppliedCode === '') {
    return { promotion: null };
  }
  if (typeof suppliedCode !== 'string' || suppliedCode.length > MAX_CODE_LENGTH) {
    return { error: 'This discount code is not valid.' };
  }
  const code = cleanCode(suppliedCode);
  if (!code) return { error: 'Please enter a discount code.' };
  if (!db) return { error: 'Discount codes are temporarily unavailable.', configurationError: true };

  const promotion = await db.prepare(`SELECT id, code, type, value_cents, active, starts_at, ends_at,
      usage_limit, per_customer_limit
    FROM promotions WHERE code = ? COLLATE NOCASE LIMIT 1`).bind(code).first();
  if (!promotion || !promotion.active) return { error: 'This discount code is not valid.' };

  const nowMs = now.getTime();
  const startsMs = promotion.starts_at ? Date.parse(`${String(promotion.starts_at).replace(' ', 'T')}Z`) : NaN;
  const endsMs = promotion.ends_at ? Date.parse(`${String(promotion.ends_at).replace(' ', 'T')}Z`) : NaN;
  if ((promotion.starts_at && !Number.isFinite(startsMs)) || (promotion.ends_at && !Number.isFinite(endsMs))) {
    return { error: 'Discount codes are temporarily unavailable.', configurationError: true };
  }
  if ((Number.isFinite(startsMs) && nowMs < startsMs) || (Number.isFinite(endsMs) && nowMs >= endsMs)) {
    return { error: 'This discount code is not valid.' };
  }

  const eligibility = await db.prepare('SELECT product_id FROM promotion_products WHERE promotion_id = ? ORDER BY product_id')
    .bind(promotion.id).all();
  const eligibleProductIds = new Set((eligibility.results || []).map(row => String(row.product_id)));
  const snapshot = calculatePromotion(items, promotion, eligibleProductIds);
  if (!snapshot.discountCents) {
    return { error: `${snapshot.code} is valid for selected tracksuit products only.` };
  }
  return { promotion: snapshot };
}
