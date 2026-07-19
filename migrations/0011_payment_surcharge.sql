PRAGMA foreign_keys = ON;

ALTER TABLE orders ADD COLUMN payment_surcharge_cents INTEGER NOT NULL DEFAULT 0 CHECK (payment_surcharge_cents >= 0);
ALTER TABLE orders ADD COLUMN payment_surcharge_percent TEXT NOT NULL DEFAULT '0';
ALTER TABLE orders ADD COLUMN payment_surcharge_fixed_cents INTEGER NOT NULL DEFAULT 0 CHECK (payment_surcharge_fixed_cents >= 0);
ALTER TABLE orders ADD COLUMN payment_surcharge_label TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN payment_surcharge_description TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0);
ALTER TABLE orders ADD COLUMN payment_surcharge_refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (payment_surcharge_refunded_cents >= 0);

CREATE INDEX IF NOT EXISTS idx_orders_refund_status ON orders(refund_status, created_at DESC);
