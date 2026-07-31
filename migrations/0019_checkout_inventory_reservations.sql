CREATE TABLE IF NOT EXISTS checkout_inventory_reservations (
  id TEXT PRIMARY KEY,
  cart_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'session_created', 'payment_pending', 'committed', 'released', 'expired')),
  stripe_checkout_session_id TEXT UNIQUE,
  checkout_url TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  release_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS checkout_inventory_reservation_items (
  reservation_id TEXT NOT NULL REFERENCES checkout_inventory_reservations(id) ON DELETE CASCADE,
  product_variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  committed_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reservation_id, product_variant_id)
);

CREATE INDEX IF NOT EXISTS idx_checkout_reservations_session
  ON checkout_inventory_reservations(stripe_checkout_session_id);

CREATE INDEX IF NOT EXISTS idx_checkout_reservations_expiry
  ON checkout_inventory_reservations(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_checkout_reservation_items_variant
  ON checkout_inventory_reservation_items(product_variant_id);
