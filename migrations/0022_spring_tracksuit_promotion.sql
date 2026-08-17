PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('fixed')),
  value_cents INTEGER NOT NULL CHECK (value_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  starts_at TEXT,
  ends_at TEXT,
  usage_limit INTEGER CHECK (usage_limit IS NULL OR usage_limit > 0),
  per_customer_limit INTEGER CHECK (per_customer_limit IS NULL OR per_customer_limit > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS promotion_products (
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (promotion_id, product_id)
);

ALTER TABLE orders ADD COLUMN promotion_code TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN promotion_type TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN promotion_value_cents INTEGER NOT NULL DEFAULT 0 CHECK (promotion_value_cents >= 0);
ALTER TABLE orders ADD COLUMN promotion_eligible_subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (promotion_eligible_subtotal_cents >= 0);

ALTER TABLE invoices ADD COLUMN promotion_code TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN promotion_type TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN promotion_value_cents INTEGER NOT NULL DEFAULT 0 CHECK (promotion_value_cents >= 0);
ALTER TABLE invoices ADD COLUMN promotion_eligible_subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (promotion_eligible_subtotal_cents >= 0);

INSERT OR IGNORE INTO promotions (code, type, value_cents, active)
VALUES ('SPRING', 'fixed', 2000, 1);

INSERT OR IGNORE INTO promotion_products (promotion_id, product_id)
SELECT id, 'patagonia-fc-performance-tracksuit' FROM promotions WHERE code = 'SPRING';

INSERT INTO admin_audit_log (admin_email, action, entity_type, entity_id, summary)
SELECT 'system:migration', 'create_promotion', 'promotion', CAST(id AS TEXT),
  'Created SPRING fixed NZD 20.00 promotion for Patagonia FC Performance Tracksuit'
FROM promotions WHERE code = 'SPRING';

CREATE INDEX IF NOT EXISTS idx_promotions_active_dates ON promotions(active, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_promotion_products_product ON promotion_products(product_id, promotion_id);
