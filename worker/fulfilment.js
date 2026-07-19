const MAX_SHIPPING_CENTS = 100000;

function cleanText(value, maxLength = 200) {
  return String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function enabled(value, fallback = true) {
  const normalised = String(value ?? '').trim().toLowerCase();
  if (!normalised) return fallback;
  return normalised === 'true';
}

function cents(value, fallback) {
  const raw = String(value ?? fallback).trim();
  if (!/^\d+$/.test(raw)) throw new Error('Fulfilment price configuration is invalid.');
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_SHIPPING_CENTS) {
    throw new Error('Fulfilment price configuration is invalid.');
  }
  return amount;
}

export function getFulfilmentConfig(env = {}) {
  const deliveryCountry = cleanText(env.NZ_DELIVERY_COUNTRY, 2).toUpperCase() || 'NZ';
  if (deliveryCountry !== 'NZ') throw new Error('Delivery must remain restricted to New Zealand.');
  const pickupAddress = [
    cleanText(env.PICKUP_ADDRESS_LINE_1, 160),
    cleanText(env.PICKUP_ADDRESS_LINE_2, 160),
    cleanText(env.PICKUP_CITY, 100),
    cleanText(env.PICKUP_POSTCODE, 12)
  ].filter(Boolean);

  return {
    pickup: {
      enabled: enabled(env.PICKUP_ENABLED, true),
      type: 'pickup',
      label: cleanText(env.PICKUP_LABEL, 80) || 'Pick up from Training Centre',
      priceCents: cents(env.PICKUP_PRICE_CENTS, 0),
      locationName: cleanText(env.PICKUP_LOCATION_NAME, 120) || 'Training Centre',
      address: pickupAddress.join(', '),
      instructions: cleanText(env.PICKUP_INSTRUCTIONS, 300)
        || 'We will contact you when your order is ready to collect and confirm the collection details.'
    },
    delivery: {
      enabled: enabled(env.NZ_DELIVERY_ENABLED, true),
      type: 'delivery',
      label: cleanText(env.NZ_DELIVERY_LABEL, 80) || 'New Zealand Delivery',
      priceCents: cents(env.NZ_DELIVERY_PRICE_CENTS, 500),
      country: deliveryCountry
    }
  };
}

export function selectFulfilment(payload, env = {}) {
  const type = cleanText(payload?.fulfilmentType, 20).toLowerCase();
  if (!['pickup', 'delivery'].includes(type)) {
    return { error: 'Please choose free pickup or New Zealand delivery.' };
  }

  const config = getFulfilmentConfig(env);
  const method = config[type];
  if (!method.enabled) return { error: `${method.label} is currently unavailable.` };
  if (type === 'pickup' && method.priceCents !== 0) throw new Error('Pickup must remain free.');
  if (type === 'delivery' && method.country !== 'NZ') throw new Error('Delivery country configuration is invalid.');

  return {
    type,
    label: method.label,
    shippingCents: method.priceCents,
    locationName: type === 'pickup' ? method.locationName : '',
    pickupAddress: type === 'pickup' ? method.address : '',
    instructions: type === 'pickup' ? method.instructions : '',
    country: type === 'delivery' ? method.country : ''
  };
}

export function publicFulfilment(fulfilment) {
  return {
    type: fulfilment.type,
    label: fulfilment.label,
    priceCents: fulfilment.shippingCents,
    locationName: fulfilment.locationName,
    pickupAddress: fulfilment.pickupAddress,
    instructions: fulfilment.instructions,
    country: fulfilment.country
  };
}
