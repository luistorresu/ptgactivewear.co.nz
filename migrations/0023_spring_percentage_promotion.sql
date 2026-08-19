PRAGMA foreign_keys = OFF;

-- The existing table limited promotion types to fixed values. Rebuild only this
-- configuration table so percentage promotions are also validated by D1.
CREATE TABLE promotions_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('fixed', 'percentage')),
  value_cents INTEGER NOT NULL CHECK (value_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  starts_at TEXT,
  ends_at TEXT,
  usage_limit INTEGER CHECK (usage_limit IS NULL OR usage_limit > 0),
  per_customer_limit INTEGER CHECK (per_customer_limit IS NULL OR per_customer_limit > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO promotions_next (id, code, type, value_cents, active, starts_at, ends_at, usage_limit, per_customer_limit, created_at, updated_at)
SELECT id, code, type, value_cents, active, starts_at, ends_at, usage_limit, per_customer_limit, created_at, updated_at
FROM promotions;

DROP TABLE promotions;
ALTER TABLE promotions_next RENAME TO promotions;

CREATE INDEX IF NOT EXISTS idx_promotions_active_dates ON promotions(active, starts_at, ends_at);

-- Percentage values use whole percentage points. SPRING is therefore 20%.
UPDATE promotions
SET type = 'percentage', value_cents = 20, updated_at = CURRENT_TIMESTAMP
WHERE code = 'SPRING';

-- Reassert the explicit eligibility mapping after the local catalogue bootstrap.
INSERT OR IGNORE INTO promotion_products (promotion_id, product_id)
SELECT id, 'patagonia-fc-performance-tracksuit'
FROM promotions WHERE code = 'SPRING';

INSERT INTO admin_audit_log (admin_email, action, entity_type, entity_id, summary)
SELECT 'system:migration', 'update_promotion', 'promotion', CAST(id AS TEXT),
  'Changed SPRING to 20 percent off Patagonia FC Performance Tracksuit only'
FROM promotions WHERE code = 'SPRING';

PRAGMA foreign_keys = ON;
