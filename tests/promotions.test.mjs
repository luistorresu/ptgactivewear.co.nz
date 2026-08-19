import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildStripeLineItems, buildBusinessOrderEmail, buildCustomerOrderEmail } from '../_worker.js';
import { verifyStripeCheckoutSnapshot } from '../worker/inventory.js';
import { calculatePromotion, normalisePromotionCode, resolvePromotion } from '../worker/promotions.js';
import { buildTrustedOrderSummary } from '../worker/surcharge.js';

const TRACKSUIT_ID = 'patagonia-fc-performance-tracksuit';
const TRAINING_KIT_ID = 'patagonia-fc-training-kit';

function item(productId, unitAmountNzdCents, quantity = 1) {
  return {
    productId,
    variantId: productId === TRACKSUIT_ID ? 101 : 202,
    cartItemKey: `${productId}:item`,
    quantity,
    size: 'M',
    variant: '',
    playerName: '',
    playerNumber: '',
    nameAddOn: 0,
    numberAddOn: 0,
    sku: productId === TRACKSUIT_ID ? 'TRACK-M' : 'KIT-M',
    product: { id: productId, name: productId === TRACKSUIT_ID ? 'Patagonia FC Performance Tracksuit' : 'Patagonia FC Training Kit', unitAmountNzdCents }
  };
}

const springRow = { id: 1, code: 'SPRING', type: 'percentage', value_cents: 20, active: 1, starts_at: null, ends_at: null, usage_limit: null, per_customer_limit: null };

function promotionDb({ promotion = springRow, products = [TRACKSUIT_ID] } = {}) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() { return /FROM promotions/.test(sql) && values[0] === 'SPRING' ? promotion : null; },
            async all() { return /FROM promotion_products/.test(sql) ? { results: products.map(product_id => ({ product_id })) } : { results: [] }; }
          };
        }
      };
    }
  };
}

test('SPRING normalises case and applies 20 percent only to the explicit tracksuit ID', async () => {
  for (const supplied of ['SPRING', 'spring', 'Spring', '  SpRiNg  ']) {
    assert.equal(normalisePromotionCode(supplied), 'SPRING');
    const result = await resolvePromotion(promotionDb(), supplied, [item(TRACKSUIT_ID, 11500), item(TRAINING_KIT_ID, 9500)]);
    assert.deepEqual({ code: result.promotion.code, eligible: result.promotion.eligibleSubtotalCents, discount: result.promotion.discountCents }, { code: 'SPRING', eligible: 11500, discount: 2300 });
  }
});

test('SPRING rejects ineligible carts and unsafe code shapes with generic messages', async () => {
  const ineligible = await resolvePromotion(promotionDb(), 'SPRING', [item(TRAINING_KIT_ID, 9500)]);
  assert.match(ineligible.error, /selected tracksuit products only/i);
  for (const code of ['NOPE', '<script>alert(1)</script>', "' OR 1=1 --", [], {}, 'X'.repeat(65)]) {
    const result = await resolvePromotion(promotionDb(), code, [item(TRACKSUIT_ID, 11500)]);
    assert.match(result.error, /not valid/i);
  }
});

test('percentage promotion excludes personalisation and unrelated merchandise', () => {
  const eligible = item(TRACKSUIT_ID, 1500);
  eligible.nameAddOn = 2000;
  const snapshot = calculatePromotion([eligible, item(TRAINING_KIT_ID, 9500)], springRow, new Set([TRACKSUIT_ID]));
  assert.equal(snapshot.eligibleSubtotalCents, 1500);
  assert.equal(snapshot.discountCents, 300);
  const summary = buildTrustedOrderSummary([eligible, item(TRAINING_KIT_ID, 9500)], 500, { PAYMENT_SURCHARGE_ENABLED: 'false' }, snapshot);
  assert.deepEqual([summary.merchandiseSubtotalCents, summary.discountCents, summary.personalisationCents, summary.shippingCents, summary.totalCents], [11000, 300, 2000, 500, 13200]);
});

test('surcharge is recalculated after the merchandise discount using integer cents', () => {
  const cart = [item(TRACKSUIT_ID, 11500), item(TRAINING_KIT_ID, 9500)];
  const promotion = calculatePromotion(cart, springRow, new Set([TRACKSUIT_ID]));
  const summary = buildTrustedOrderSummary(cart, 500, {
    PAYMENT_SURCHARGE_ENABLED: 'true', PAYMENT_SURCHARGE_PERCENT: '2.65', PAYMENT_SURCHARGE_FIXED_CENTS: '30'
  }, promotion);
  assert.deepEqual([summary.merchandiseSubtotalCents, summary.discountCents, summary.paymentSurchargeCents, summary.totalCents], [21000, 2300, 526, 19726]);
});

test('Stripe line pricing allocates the discount once and leaves ineligible products unchanged', () => {
  const cart = [item(TRACKSUIT_ID, 11500, 2), item(TRAINING_KIT_ID, 9500)];
  const promotion = calculatePromotion(cart, springRow, new Set([TRACKSUIT_ID]));
  const summary = buildTrustedOrderSummary(cart, 0, { PAYMENT_SURCHARGE_ENABLED: 'false' }, promotion);
  const lines = buildStripeLineItems(cart, summary, { type: 'pickup' });
  const base = lines.filter(line => line.metadata.item_kind === 'base_product');
  assert.deepEqual(base.map(line => [line.metadata.product_id, line.unitAmount, line.quantity]), [
    [TRACKSUIT_ID, 6900, 1], [TRACKSUIT_ID, 11500, 1], [TRAINING_KIT_ID, 9500, 1]
  ]);
  assert.equal(base.reduce((sum, line) => sum + line.unitAmount * line.quantity, 0), 27900);
  assert.equal(summary.merchandiseSubtotalCents - summary.discountCents, 27900);
});

test('paid Stripe snapshot rejects browser or metadata discount manipulation down to one cent', () => {
  const lineItems = [{ quantity: 1, amount_total: 9200, price: { product: { metadata: {
    item_kind: 'base_product', product_id: TRACKSUIT_ID, variant_id: '101', cart_item_key: 'track:1', original_unit_amount_cents: '11500'
  } } } }];
  const session = {
    amount_subtotal: 9200, amount_total: 9200,
    total_details: { amount_shipping: 0, amount_discount: 0 },
    metadata: {
      subtotal_cents: '11500', personalisation_cents: '0', discount_cents: '2300',
      promotion_code: 'SPRING', promotion_type: 'percentage', promotion_value_cents: '20', promotion_eligible_subtotal_cents: '11500',
      shipping_cents: '0', payment_surcharge_cents: '0', payment_surcharge_enabled: '0', payment_surcharge_fixed_cents: '30',
      fulfilment_type: 'pickup', shipping_method: 'Pick up from Training Centre', total_cents: '9200'
    }
  };
  assert.equal(verifyStripeCheckoutSnapshot(session, lineItems, 0).discountCents, 2300);
  assert.throws(() => verifyStripeCheckoutSnapshot({ ...session, metadata: { ...session.metadata, discount_cents: '2301' } }, lineItems, 0), /promotion/i);
  assert.throws(() => verifyStripeCheckoutSnapshot({ ...session, amount_total: 9199 }, lineItems, 0), /paid total/i);
});

test('customer and business emails disclose the exact promotion snapshot', () => {
  const order = {
    orderNumber: 'PTG-ORD-2026-000099', orderDate: '17 August 2026', customerName: 'Test Customer', childName: 'Test Child',
    customerEmail: 'customer@example.com', phone: '', paymentStatus: 'paid', fulfilmentType: 'pickup', shippingMethod: 'Pickup',
    pickupLocation: 'Training Centre', pickupAddress: '', pickupInstructions: 'We will contact you.', shippingAddress: '', shippingRural: false,
    items: [{ quantity: 1, name: 'Patagonia FC Performance Tracksuit', amountTotal: 11500, details: [] }],
    merchandiseSubtotal: 11500, personalisationAmount: 0, promotionCode: 'SPRING', promotionEligibleSubtotal: 11500,
    discountAmount: 2300, shippingAmount: 0, paymentSurchargeEnabled: false, paymentSurchargeAmount: 0,
    totalPaid: 9200, currency: 'nzd', sessionId: 'cs_test', paymentIntentId: 'pi_test', eventId: 'evt_test'
  };
  for (const email of [buildCustomerOrderEmail(order), buildBusinessOrderEmail(order)]) {
    assert.match(email.text, /Discount \(SPRING\): -NZD \$23\.00/);
    assert.match(email.text, /Total paid: NZD \$92\.00/);
  }
});

test('promotion migrations retain tracksuit-only eligibility and convert SPRING to 20 percent', async () => {
  const [initialSql, percentageSql] = await Promise.all([
    readFile(new URL('../migrations/0022_spring_tracksuit_promotion.sql', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0023_spring_percentage_promotion.sql', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(initialSql, /^\s*(?:DROP|DELETE|TRUNCATE)\b/im);
  assert.match(percentageSql, /type IN \('fixed', 'percentage'\)/);
  assert.match(percentageSql, /type = 'percentage', value_cents = 20/);
  assert.match(initialSql, /'patagonia-fc-performance-tracksuit'/);
  assert.doesNotMatch(initialSql, /patagonia-fc-training-kit/);
  assert.match(initialSql, /promotion_code TEXT NOT NULL DEFAULT ''/);
  assert.match(percentageSql, /PRAGMA foreign_keys = OFF/);
  assert.match(percentageSql, /PRAGMA foreign_keys = ON/);
});

test('cart UI provides accessible Apply and Remove controls and clears promotion after payment', async () => {
  const [main, success] = await Promise.all([
    readFile(new URL('../js/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../order-success.html', import.meta.url), 'utf8')
  ]);
  assert.match(main, /Discount code/);
  assert.match(main, /data-promotion-apply/);
  assert.match(main, /data-promotion-remove/);
  assert.match(main, /aria-live="polite"/);
  assert.match(success, /removeItem\('ptg-checkout-promotion'\)/);
});

test('authenticated admin has read-only promotion configuration visibility', async () => {
  const [adminHtml, adminJs, adminApi, worker] = await Promise.all([
    readFile(new URL('../admin/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../admin/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../worker/admin-api.js', import.meta.url), 'utf8'),
    readFile(new URL('../_worker.js', import.meta.url), 'utf8')
  ]);
  assert.match(adminHtml, /data-view="promotions"/);
  assert.match(adminJs, /api\('\/api\/admin\/promotions'\)/);
  assert.match(adminApi, /async function listPromotions/);
  assert.doesNotMatch(adminApi, /method === 'POST' && segments\[0\] === 'promotions'/);
  assert.match(worker, /url\.pathname === '\/admin\/promotions'/);
});
