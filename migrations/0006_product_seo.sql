PRAGMA foreign_keys = ON;

ALTER TABLE products ADD COLUMN seo_title TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN meta_description TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_products_slug_public
  ON products(slug, active, archived);
