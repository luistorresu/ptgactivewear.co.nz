ALTER TABLE orders ADD COLUMN prepared_at TEXT;
ALTER TABLE orders ADD COLUMN prepared_by_admin TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN prepared_email_sent_at TEXT;
ALTER TABLE orders ADD COLUMN prepared_email_status TEXT NOT NULL DEFAULT 'not_sent';
ALTER TABLE orders ADD COLUMN prepared_email_id TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN prepared_email_error TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN prepared_email_lock_token TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN prepared_email_lock_at TEXT;

CREATE TABLE IF NOT EXISTS prepared_email_attempts (
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

CREATE INDEX IF NOT EXISTS idx_prepared_email_attempts_order
  ON prepared_email_attempts(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_prepared_pickup
  ON orders(fulfilment_type, fulfilment_status, prepared_email_status, created_at DESC);

UPDATE orders
SET prepared_at = COALESCE(ready_for_collection_at, collected_at, updated_at),
    prepared_by_admin = 'historical_workflow'
WHERE fulfilment_type = 'pickup'
  AND fulfilment_status IN ('ready_for_collection', 'collected')
  AND prepared_at IS NULL;
