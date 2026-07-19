PRAGMA foreign_keys = ON;

ALTER TABLE orders ADD COLUMN payment_surcharge_enabled INTEGER NOT NULL DEFAULT 0 CHECK (payment_surcharge_enabled IN (0, 1));
