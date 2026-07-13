PRAGMA foreign_keys = ON;

ALTER TABLE orders ADD COLUMN order_number TEXT;
ALTER TABLE orders ADD COLUMN billing_address_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE orders ADD COLUMN payment_date TEXT;
ALTER TABLE orders ADD COLUMN personalisation_cents INTEGER NOT NULL DEFAULT 0 CHECK (personalisation_cents >= 0);
ALTER TABLE orders ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0);
ALTER TABLE orders ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0);
ALTER TABLE orders ADD COLUMN customer_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN internal_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN refund_status TEXT NOT NULL DEFAULT 'not_refunded';
ALTER TABLE orders ADD COLUMN restocked_at TEXT;
ALTER TABLE orders ADD COLUMN invoice_number TEXT;
ALTER TABLE orders ADD COLUMN invoice_created_at TEXT;
ALTER TABLE orders ADD COLUMN payment_method_label TEXT NOT NULL DEFAULT '';

ALTER TABLE order_items ADD COLUMN size TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items ADD COLUMN colour TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items ADD COLUMN style TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number) WHERE order_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_number ON orders(invoice_number) WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_fulfilment ON orders(fulfilment_status, created_at DESC);

CREATE TABLE IF NOT EXISTS invoice_sequence (
  year INTEGER PRIMARY KEY,
  next_value INTEGER NOT NULL CHECK (next_value > 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fulfilment_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fulfilment_history_order ON fulfilment_history(order_id, created_at DESC);
