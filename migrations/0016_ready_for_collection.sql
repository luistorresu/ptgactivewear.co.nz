ALTER TABLE orders ADD COLUMN ready_for_collection_at TEXT;
ALTER TABLE orders ADD COLUMN ready_for_collection_email_sent_at TEXT;
ALTER TABLE orders ADD COLUMN ready_for_collection_email_status TEXT NOT NULL DEFAULT 'not_sent';
ALTER TABLE orders ADD COLUMN ready_for_collection_email_id TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN ready_for_collection_email_error TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN ready_for_collection_email_lock_token TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN ready_for_collection_email_lock_at TEXT;
ALTER TABLE orders ADD COLUMN collected_at TEXT;
ALTER TABLE orders ADD COLUMN collected_by_admin TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN collection_request_id TEXT NOT NULL DEFAULT '';

ALTER TABLE order_items ADD COLUMN restricted_number INTEGER NOT NULL DEFAULT 0 CHECK (restricted_number IN (0, 1));
ALTER TABLE order_items ADD COLUMN restricted_number_verified INTEGER NOT NULL DEFAULT 0 CHECK (restricted_number_verified IN (0, 1));
ALTER TABLE order_items ADD COLUMN number_subject_to_availability INTEGER NOT NULL DEFAULT 0 CHECK (number_subject_to_availability IN (0, 1));

CREATE TABLE IF NOT EXISTS ready_collection_email_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  request_id TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL CHECK (action IN ('initial', 'resend')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'blocked')),
  provider_email_id TEXT NOT NULL DEFAULT '',
  safe_error_code TEXT NOT NULL DEFAULT '',
  admin_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ready_collection_attempts_order
  ON ready_collection_email_attempts(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_collection_email
  ON orders(fulfilment_type, fulfilment_status, ready_for_collection_email_status, created_at DESC);
