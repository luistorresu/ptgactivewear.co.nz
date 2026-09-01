PRAGMA foreign_keys = ON;

-- Local-only deterministic raffle states. This file is never part of a
-- production migration or deployment command.
UPDATE raffle_numbers
SET status = 'available', reservation_token = NULL, reserved_at = NULL,
    reservation_expires_at = NULL, stripe_checkout_session_id = NULL,
    raffle_order_id = NULL, sold_at = NULL, updated_at = CURRENT_TIMESTAMP
WHERE raffle_id = 'patagonia-fc-tournament-2026' AND number BETWEEN 1 AND 6;

DELETE FROM raffle_orders WHERE stripe_checkout_session_id = 'cs_test_raffle_local_seed';
DELETE FROM raffle_reservations WHERE id IN ('local-test-reserved-4', 'local-test-sold-5-6');

INSERT INTO raffle_reservations (
  id, raffle_id, request_fingerprint, reservation_token, numbers_json,
  ticket_count, status, expires_at
) VALUES (
  'local-test-reserved-4', 'patagonia-fc-tournament-2026',
  'local-test-fingerprint-reserved', 'local-test-token-reserved-4', '[4]',
  1, 'reserved', '2099-01-01 00:00:00'
);

UPDATE raffle_numbers
SET status = 'reserved', reservation_token = 'local-test-token-reserved-4',
    reserved_at = CURRENT_TIMESTAMP, reservation_expires_at = '2099-01-01 00:00:00',
    updated_at = CURRENT_TIMESTAMP
WHERE raffle_id = 'patagonia-fc-tournament-2026' AND number = 4;

INSERT INTO raffle_reservations (
  id, raffle_id, request_fingerprint, reservation_token, numbers_json,
  ticket_count, status, stripe_checkout_session_id, checkout_url, expires_at
) VALUES (
  'local-test-sold-5-6', 'patagonia-fc-tournament-2026',
  'local-test-fingerprint-sold', 'local-test-token-sold-5-6', '[5,6]',
  2, 'session_created', 'cs_test_raffle_local_seed',
  'https://checkout.stripe.test/local-raffle-seed', '2099-01-01 00:00:00'
);

UPDATE raffle_numbers
SET status = 'reserved', reservation_token = 'local-test-token-sold-5-6',
    reserved_at = CURRENT_TIMESTAMP, reservation_expires_at = '2099-01-01 00:00:00',
    stripe_checkout_session_id = 'cs_test_raffle_local_seed', updated_at = CURRENT_TIMESTAMP
WHERE raffle_id = 'patagonia-fc-tournament-2026' AND number IN (5, 6);

INSERT INTO raffle_orders (
  order_number, raffle_id, raffle_name, prize_name, ticket_price_cents,
  ticket_count, numbers_json, reservation_token, stripe_checkout_session_id,
  stripe_payment_intent_id, stripe_event_id, customer_name, child_name,
  customer_email, customer_phone, subtotal_cents, payment_surcharge_cents,
  payment_surcharge_enabled, payment_surcharge_percent,
  payment_surcharge_fixed_cents, payment_surcharge_label, total_cents,
  currency, payment_status, payment_method_label, email_status
) VALUES (
  'PTG-RAF-TEST-000001', 'patagonia-fc-tournament-2026',
  'Patagonia FC Tournament Fundraising Prize Drawing', 'DJI Neo Drone', 2000,
  2, '[5,6]', 'local-test-token-sold-5-6', 'cs_test_raffle_local_seed',
  'pi_test_raffle_local_seed', 'evt_test_raffle_local_seed', 'Local Test Customer',
  'Local Test Player', 'raffle-test@example.invalid', '0210000000', 4000,
  0, 0, '0', 0, 'Card processing surcharge', 4000, 'NZD', 'paid',
  'card', 'sent'
);
