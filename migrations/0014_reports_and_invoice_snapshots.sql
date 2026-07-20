PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  invoice_number TEXT NOT NULL UNIQUE,
  issue_date TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  billing_details_json TEXT NOT NULL DEFAULT '{}',
  fulfilment_details_json TEXT NOT NULL DEFAULT '{}',
  items_json TEXT NOT NULL DEFAULT '[]',
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  personalisation_cents INTEGER NOT NULL DEFAULT 0 CHECK (personalisation_cents >= 0),
  shipping_cents INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  processing_surcharge_cents INTEGER NOT NULL DEFAULT 0 CHECK (processing_surcharge_cents >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'NZD' CHECK (length(currency) = 3),
  status TEXT NOT NULL DEFAULT 'issued',
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id, order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_sku ON order_items(sku, order_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment_fulfilment ON orders(payment_status, fulfilment_status, created_at DESC);
