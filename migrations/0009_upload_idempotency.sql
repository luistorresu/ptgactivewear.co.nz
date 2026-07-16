PRAGMA foreign_keys = ON;

ALTER TABLE product_images ADD COLUMN upload_request_id TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_upload_request
  ON product_images(upload_request_id) WHERE upload_request_id != '';
