ALTER TABLE orders ADD COLUMN child_name TEXT;
ALTER TABLE invoices ADD COLUMN child_name TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_child_name ON orders(child_name, created_at DESC);
