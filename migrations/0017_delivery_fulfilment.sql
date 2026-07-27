ALTER TABLE orders ADD COLUMN out_for_delivery_at TEXT;
ALTER TABLE orders ADD COLUMN out_for_delivery_email_sent_at TEXT;
ALTER TABLE orders ADD COLUMN out_for_delivery_email_status TEXT NOT NULL DEFAULT 'not_sent';
ALTER TABLE orders ADD COLUMN out_for_delivery_email_id TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN out_for_delivery_email_error TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN out_for_delivery_email_lock_token TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN out_for_delivery_email_lock_at TEXT;
ALTER TABLE orders ADD COLUMN completed_at TEXT;
ALTER TABLE orders ADD COLUMN completed_by_admin TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN delivery_request_id TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS delivery_email_attempts (
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

CREATE INDEX IF NOT EXISTS idx_delivery_email_attempts_order
  ON delivery_email_attempts(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_email
  ON orders(fulfilment_type, fulfilment_status, out_for_delivery_email_status, created_at DESC);
