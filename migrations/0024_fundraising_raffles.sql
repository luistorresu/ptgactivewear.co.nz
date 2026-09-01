PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS raffles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prize_name TEXT NOT NULL,
  ticket_price_cents INTEGER NOT NULL CHECK (ticket_price_cents > 0),
  total_numbers INTEGER NOT NULL CHECK (total_numbers > 0 AND total_numbers <= 10000),
  currency TEXT NOT NULL DEFAULT 'NZD' CHECK (length(currency) = 3),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  reservation_minutes INTEGER NOT NULL DEFAULT 31 CHECK (reservation_minutes BETWEEN 30 AND 1440),
  terms_status TEXT NOT NULL DEFAULT 'pending' CHECK (terms_status IN ('pending', 'confirmed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS raffle_reservations (
  id TEXT PRIMARY KEY,
  raffle_id TEXT NOT NULL REFERENCES raffles(id) ON DELETE RESTRICT,
  request_fingerprint TEXT NOT NULL,
  reservation_token TEXT NOT NULL UNIQUE,
  numbers_json TEXT NOT NULL CHECK (json_valid(numbers_json)),
  ticket_count INTEGER NOT NULL CHECK (ticket_count > 0),
  status TEXT NOT NULL DEFAULT 'preparing'
    CHECK (status IN ('preparing', 'reserved', 'session_created', 'payment_pending', 'committed', 'released', 'expired', 'failed')),
  stripe_checkout_session_id TEXT UNIQUE,
  checkout_url TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  release_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS raffle_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT UNIQUE,
  raffle_id TEXT NOT NULL REFERENCES raffles(id) ON DELETE RESTRICT,
  raffle_name TEXT NOT NULL,
  prize_name TEXT NOT NULL,
  ticket_price_cents INTEGER NOT NULL CHECK (ticket_price_cents > 0),
  ticket_count INTEGER NOT NULL CHECK (ticket_count > 0),
  numbers_json TEXT NOT NULL CHECK (json_valid(numbers_json)),
  reservation_token TEXT NOT NULL UNIQUE,
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_event_id TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL DEFAULT '',
  child_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  payment_surcharge_cents INTEGER NOT NULL DEFAULT 0 CHECK (payment_surcharge_cents >= 0),
  payment_surcharge_enabled INTEGER NOT NULL DEFAULT 0 CHECK (payment_surcharge_enabled IN (0, 1)),
  payment_surcharge_percent TEXT NOT NULL DEFAULT '0',
  payment_surcharge_fixed_cents INTEGER NOT NULL DEFAULT 0 CHECK (payment_surcharge_fixed_cents >= 0),
  payment_surcharge_label TEXT NOT NULL DEFAULT '',
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  refund_status TEXT NOT NULL DEFAULT 'not_refunded'
    CHECK (refund_status IN ('not_refunded', 'partially_refunded', 'fully_refunded')),
  currency TEXT NOT NULL DEFAULT 'NZD' CHECK (length(currency) = 3),
  payment_status TEXT NOT NULL DEFAULT 'paid',
  payment_method_label TEXT NOT NULL DEFAULT '',
  email_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed')),
  email_attempts INTEGER NOT NULL DEFAULT 0 CHECK (email_attempts >= 0),
  email_sent_at TEXT,
  purchased_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS raffle_numbers (
  raffle_id TEXT NOT NULL REFERENCES raffles(id) ON DELETE RESTRICT,
  number INTEGER NOT NULL CHECK (number > 0),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'sold')),
  reservation_token TEXT,
  reserved_at TEXT,
  reservation_expires_at TEXT,
  stripe_checkout_session_id TEXT,
  raffle_order_id INTEGER REFERENCES raffle_orders(id) ON DELETE RESTRICT,
  sold_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (raffle_id, number)
);

CREATE INDEX IF NOT EXISTS idx_raffles_status ON raffles(status, slug);
CREATE INDEX IF NOT EXISTS idx_raffle_numbers_status ON raffle_numbers(raffle_id, status, number);
CREATE INDEX IF NOT EXISTS idx_raffle_numbers_reservation ON raffle_numbers(reservation_token, status);
CREATE INDEX IF NOT EXISTS idx_raffle_reservations_expiry ON raffle_reservations(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_raffle_orders_created ON raffle_orders(created_at DESC);

INSERT OR IGNORE INTO raffles (
  id, slug, name, description, prize_name, ticket_price_cents,
  total_numbers, currency, status, reservation_minutes, terms_status
) VALUES (
  'patagonia-fc-tournament-2026',
  'patagonia-fc-tournament-fundraising-raffle',
  'Patagonia FC Tournament Fundraising Prize Drawing',
  'Fundraising support for Patagonia FC players attending the Cambridge International Tournament and McCartney Taupo Cup 2026.',
  'DJI Neo Drone',
  2000,
  36,
  'NZD',
  'active',
  31,
  'pending'
);

WITH RECURSIVE raffle_sequence(number) AS (
  SELECT 1
  UNION ALL
  SELECT number + 1 FROM raffle_sequence WHERE number < 36
)
INSERT OR IGNORE INTO raffle_numbers (raffle_id, number)
SELECT 'patagonia-fc-tournament-2026', number FROM raffle_sequence;
