PRAGMA foreign_keys = ON;

ALTER TABLE products ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1));

ALTER TABLE product_images ADD COLUMN thumbnail_object_key TEXT NOT NULL DEFAULT '';
ALTER TABLE product_images ADD COLUMN thumbnail_delivery_url TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_products_admin_status
  ON products(archived, active, available_for_sale, updated_at);

CREATE INDEX IF NOT EXISTS idx_product_images_thumbnail_object_key
  ON product_images(thumbnail_object_key) WHERE thumbnail_object_key != '';
