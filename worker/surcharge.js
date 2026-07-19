const DEFAULT_LABEL = 'Card processing surcharge';
const DEFAULT_DESCRIPTION = 'This surcharge helps cover card payment processing costs.';
const MAX_PERCENT_BASIS_POINTS = 400;
const MAX_FIXED_CENTS = 10000;

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function parseBoolean(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function parsePercentBasisPoints(value) {
  const text = String(value ?? '0').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const basisPoints = (Number(whole) * 100) + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(basisPoints) ? basisPoints : null;
}

function basisPointsToPercent(basisPoints) {
  return (basisPoints / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function parseIntegerCents(value) {
  const text = String(value ?? '0').trim();
  if (!/^\d+$/.test(text)) return null;
  const cents = Number(text);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function getPaymentSurchargeConfig(env = {}) {
  const enabled = parseBoolean(env.PAYMENT_SURCHARGE_ENABLED);
  const percentBasisPoints = parsePercentBasisPoints(env.PAYMENT_SURCHARGE_PERCENT);
  const fixedCents = parseIntegerCents(env.PAYMENT_SURCHARGE_FIXED_CENTS);
  const label = cleanText(env.PAYMENT_SURCHARGE_LABEL || DEFAULT_LABEL, 80) || DEFAULT_LABEL;
  const description = cleanText(env.PAYMENT_SURCHARGE_DESCRIPTION || DEFAULT_DESCRIPTION, 240) || DEFAULT_DESCRIPTION;
  let error = '';

  if (percentBasisPoints === null) error = 'Payment surcharge percentage is invalid.';
  else if (percentBasisPoints > MAX_PERCENT_BASIS_POINTS) error = 'Payment surcharge percentage exceeds the 4% safety limit.';
  else if (fixedCents === null || fixedCents > MAX_FIXED_CENTS) error = 'Payment surcharge fixed amount is invalid.';
  else if (enabled && percentBasisPoints === 0 && fixedCents === 0) error = 'Payment surcharge is enabled without a configured amount.';

  return {
    enabled,
    valid: !error,
    error,
    percentBasisPoints: percentBasisPoints ?? 0,
    percent: basisPointsToPercent(percentBasisPoints ?? 0),
    fixedCents: fixedCents ?? 0,
    label,
    description
  };
}

export function calculatePaymentSurcharge(eligibleSubtotalCents, config) {
  if (!Number.isSafeInteger(eligibleSubtotalCents) || eligibleSubtotalCents < 0) {
    throw new Error('Eligible subtotal must be a non-negative integer number of cents.');
  }
  if (!config?.valid) throw new Error(config?.error || 'Payment surcharge configuration is invalid.');
  if (!config.enabled || eligibleSubtotalCents === 0) return 0;
  const percentageCents = Math.round((eligibleSubtotalCents * config.percentBasisPoints) / 10000);
  const surchargeCents = percentageCents + config.fixedCents;
  if (!Number.isSafeInteger(surchargeCents) || surchargeCents < 0) throw new Error('Calculated payment surcharge is invalid.');
  return surchargeCents;
}

export function buildTrustedOrderSummary(items, shippingCents, env = {}) {
  if (!Array.isArray(items) || !items.length) throw new Error('A valid cart is required.');
  if (!Number.isSafeInteger(shippingCents) || shippingCents < 0) throw new Error('Shipping must be a non-negative integer number of cents.');

  let merchandiseSubtotalCents = 0;
  let personalisationCents = 0;
  for (const item of items) {
    const quantity = Number(item.quantity);
    const unitAmount = Number(item.product?.unitAmountNzdCents);
    const personalisationPerUnit = Number(item.nameAddOn || 0) + Number(item.numberAddOn || 0);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(unitAmount) || unitAmount < 0
      || !Number.isSafeInteger(personalisationPerUnit) || personalisationPerUnit < 0) {
      throw new Error('A cart line contains invalid money values.');
    }
    merchandiseSubtotalCents += unitAmount * quantity;
    personalisationCents += personalisationPerUnit * quantity;
  }

  const surcharge = getPaymentSurchargeConfig(env);
  const paymentSurchargeCents = calculatePaymentSurcharge(merchandiseSubtotalCents, surcharge);
  const totalCents = merchandiseSubtotalCents + personalisationCents + shippingCents + paymentSurchargeCents;
  if (![merchandiseSubtotalCents, personalisationCents, totalCents].every(Number.isSafeInteger)) {
    throw new Error('Calculated checkout total is outside the supported range.');
  }

  return {
    currency: 'NZD',
    merchandiseSubtotalCents,
    personalisationCents,
    shippingCents,
    paymentSurchargeCents,
    totalCents,
    surcharge
  };
}

export function calculateRefundBreakdown(totalPaidCents, paymentSurchargeCents, amountRefundedCents, explicitSurchargeRefundedCents = 0) {
  const values = [totalPaidCents, paymentSurchargeCents, amountRefundedCents, explicitSurchargeRefundedCents];
  if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Refund values must be non-negative integer cents.');
  const refundedCents = Math.min(amountRefundedCents, totalPaidCents);
  const fullRefund = totalPaidCents > 0 && refundedCents >= totalPaidCents;
  const paymentSurchargeRefundedCents = fullRefund
    ? paymentSurchargeCents
    : Math.min(explicitSurchargeRefundedCents, paymentSurchargeCents, refundedCents);
  return {
    refundedCents,
    paymentSurchargeRefundedCents,
    refundStatus: fullRefund ? 'fully_refunded' : refundedCents > 0 ? 'partially_refunded' : 'not_refunded'
  };
}
