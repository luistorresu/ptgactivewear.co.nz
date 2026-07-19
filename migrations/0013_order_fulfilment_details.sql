ALTER TABLE orders ADD COLUMN fulfilment_type TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN shipping_method TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN pickup_location TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN pickup_instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN shipping_name TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN shipping_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN shipping_address_line_1 TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN shipping_address_line_2 TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN shipping_suburb TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN shipping_city TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN shipping_region TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN shipping_postcode TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN shipping_country TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN shipping_rural INTEGER NOT NULL DEFAULT 0 CHECK (shipping_rural IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_orders_fulfilment_type ON orders(fulfilment_type, created_at DESC);
