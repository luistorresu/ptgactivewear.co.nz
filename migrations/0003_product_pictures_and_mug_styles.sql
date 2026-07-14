PRAGMA foreign_keys = ON;

ALTER TABLE product_images ADD COLUMN object_key TEXT NOT NULL DEFAULT '';
ALTER TABLE product_images ADD COLUMN delivery_url TEXT NOT NULL DEFAULT '';
ALTER TABLE product_images ADD COLUMN mime_type TEXT NOT NULL DEFAULT '';
ALTER TABLE product_images ADD COLUMN file_size INTEGER NOT NULL DEFAULT 0 CHECK (file_size >= 0);
ALTER TABLE product_images ADD COLUMN width INTEGER CHECK (width IS NULL OR width > 0);
ALTER TABLE product_images ADD COLUMN height INTEGER CHECK (height IS NULL OR height > 0);
ALTER TABLE product_images ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));
ALTER TABLE product_images ADD COLUMN uploaded_by TEXT NOT NULL DEFAULT '';
ALTER TABLE product_images ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE product_images ADD COLUMN variant_style TEXT NOT NULL DEFAULT '';

ALTER TABLE product_variants ADD COLUMN allow_player_name INTEGER CHECK (allow_player_name IS NULL OR allow_player_name IN (0, 1));
ALTER TABLE product_variants ADD COLUMN allow_player_number INTEGER CHECK (allow_player_number IS NULL OR allow_player_number IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_product_images_active
  ON product_images(product_id, active, is_primary DESC, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_product_images_object_key
  ON product_images(object_key) WHERE object_key != '';

UPDATE product_images SET updated_at = COALESCE(NULLIF(created_at, ''), CURRENT_TIMESTAMP) WHERE updated_at = '';

UPDATE product_variants
SET style = 'Style 1',
    allow_player_name = 0,
    allow_player_number = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE product_id = 'patagonia-fc-personalised-mug'
  AND sku = 'PTG-PFC-MUG-OS';

INSERT OR IGNORE INTO product_variants (
  product_id, sku, size, colour, style, stock_quantity, active,
  allow_player_name, allow_player_number
) VALUES (
  'patagonia-fc-personalised-mug', 'PTG-PFC-MUG-STYLE-2', 'One Size', '', 'Style 2', 0, 1, 1, 1
);

UPDATE products
SET allow_player_name = 1,
    allow_player_number = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'patagonia-fc-personalised-mug';

UPDATE product_images SET active = 0, is_primary = 0, updated_at = CURRENT_TIMESTAMP;

INSERT OR IGNORE INTO product_images (product_id, path, alt_text, sort_order, is_primary, active, variant_style) VALUES
  ('patagonia-fc-beanie', '/photos/clouth/Patagonia FC Beanie - $35 - image 01 .jpeg', 'Patagonia FC Beanie in navy club design', 1, 1, 1, ''),
  ('patagonia-fc-performance-tracksuit', '/photos/clouth/Patagonia FC Performance Tracksuit - $115 - image 01.png', 'Patagonia FC Performance Tracksuit front and back', 1, 1, 1, ''),
  ('patagonia-fc-performance-tracksuit', '/photos/clouth/Patagonia FC Performance Tracksuit - $115 - image 03.png', 'Patagonia FC Performance Tracksuit alternate view', 2, 0, 1, ''),
  ('patagonia-fc-performance-tracksuit', '/photos/clouth/Tracksuit .jpeg', 'Patagonia FC Performance Tracksuit detail view', 3, 0, 1, ''),
  ('patagonia-fc-personalised-mug', '/photos/clouth/Mug Style 1.png', 'Patagonia FC Mug Style 1 front view', 1, 1, 1, 'Style 1'),
  ('patagonia-fc-personalised-mug', '/photos/clouth/Mug style 1 .1.png', 'Patagonia FC Mug Style 1 alternate view', 2, 0, 1, 'Style 1'),
  ('patagonia-fc-personalised-mug', '/photos/clouth/Mug Style 1 .2.png', 'Patagonia FC Mug Style 1 detail view', 3, 0, 1, 'Style 1'),
  ('patagonia-fc-personalised-mug', '/photos/clouth/Mug style 2.png', 'Patagonia FC Mug Style 2 personalised design', 1, 0, 1, 'Style 2'),
  ('patagonia-fc-personalised-mug', '/photos/clouth/Mug Style 2.1.png', 'Patagonia FC Mug Style 2 alternate view', 2, 0, 1, 'Style 2'),
  ('patagonia-fc-personalised-mug', '/photos/clouth/Mug Style 2 - Copy.png', 'Patagonia FC Mug Style 2 detail view', 3, 0, 1, 'Style 2'),
  ('patagonia-fc-tournament-player-kit', '/photos/clouth/Patagonia FC Tournament Player Kit - $95 - image 01.png', 'Patagonia FC Tournament Player Kit shirt', 1, 1, 1, ''),
  ('patagonia-fc-tournament-player-kit', '/photos/clouth/Patagonia FC Tournament Player Kit - $95 - image 02.png', 'Patagonia FC Tournament Player Kit alternate shirt view', 2, 0, 1, ''),
  ('patagonia-fc-tournament-player-kit', '/photos/clouth/Shorts $95 - image 03.png', 'Patagonia FC Tournament Player Kit shorts', 3, 0, 1, ''),
  ('patagonia-fc-tournament-player-kit', '/photos/clouth/Patagonia FC Tournament Player Kit - $95 - image 04.png', 'Patagonia FC Tournament Player Kit socks', 4, 0, 1, ''),
  ('patagonia-fc-waterproof-rain-suit', '/photos/clouth/Patagonia FC Waterproof Rain Suit - $50 - image 01.png', 'Patagonia FC Waterproof Rain Suit front view', 1, 1, 1, ''),
  ('patagonia-fc-waterproof-rain-suit', '/photos/clouth/Patagonia FC Waterproof Rain Suit - $50 - image 011.jpeg', 'Patagonia FC Waterproof Rain Suit alternate view', 2, 0, 1, '');

UPDATE product_images
SET active = 1,
    is_primary = CASE
      WHEN path IN (
        '/photos/clouth/Patagonia FC Performance Tracksuit - $115 - image 01.png',
        '/photos/clouth/Patagonia FC Tournament Player Kit - $95 - image 01.png',
        '/photos/clouth/Patagonia FC Waterproof Rain Suit - $50 - image 01.png'
      ) THEN 1 ELSE is_primary END,
    updated_at = CURRENT_TIMESTAMP
WHERE path IN (
  '/photos/clouth/Patagonia FC Performance Tracksuit - $115 - image 01.png',
  '/photos/clouth/Patagonia FC Performance Tracksuit - $115 - image 03.png',
  '/photos/clouth/Patagonia FC Tournament Player Kit - $95 - image 01.png',
  '/photos/clouth/Patagonia FC Tournament Player Kit - $95 - image 02.png',
  '/photos/clouth/Patagonia FC Tournament Player Kit - $95 - image 04.png',
  '/photos/clouth/Patagonia FC Waterproof Rain Suit - $50 - image 01.png'
);
