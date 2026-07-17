PRAGMA foreign_keys = ON;

-- The catalogue does not yet use counted inventory, so all newly introduced
-- sizes begin at zero while remaining saleable until real stock is entered.
INSERT OR IGNORE INTO products (
  id, slug, name, description, category, product_type, badge, price_cents, currency,
  active, available_for_sale, featured, track_inventory,
  allow_player_name, allow_player_number, player_name_price_cents, player_number_price_cents,
  seo_title, meta_description
) VALUES (
  'patagonia-fc-training-kit',
  'patagonia-fc-training-kit',
  'Patagonia FC Training Kit',
  'Designed for comfort, durability and performance, our Patagonia FC Training Kit is perfect for every training session. Made from lightweight, breathable, quick-dry fabric to keep players cool and comfortable on the field. Includes shirt, shorts and socks: a premium performance training shirt, lightweight training shorts with an elastic waistband, and comfortable football socks. Optional personalised name and number printing is available. Built for players of all ages, this kit combines professional quality with everyday comfort for training all year round.',
  'kits',
  'Training Kit',
  'Training',
  9500,
  'NZD',
  1, 1, 0, 0,
  1, 1, 2000, 2000,
  'Patagonia FC Training Kit | PTG Activewear',
  'Shop the Patagonia FC Training Kit, including a breathable performance shirt, lightweight shorts and football socks. Available in sizes 8, 10, 12 and XS.'
);

UPDATE products
SET
  name = 'Patagonia FC Training Kit',
  description = 'Designed for comfort, durability and performance, our Patagonia FC Training Kit is perfect for every training session. Made from lightweight, breathable, quick-dry fabric to keep players cool and comfortable on the field. Includes shirt, shorts and socks: a premium performance training shirt, lightweight training shorts with an elastic waistband, and comfortable football socks. Optional personalised name and number printing is available. Built for players of all ages, this kit combines professional quality with everyday comfort for training all year round.',
  category = 'kits', product_type = 'Training Kit', badge = 'Training', price_cents = 9500, currency = 'NZD',
  active = 1, available_for_sale = 1, track_inventory = 0,
  allow_player_name = 1, allow_player_number = 1,
  player_name_price_cents = 2000, player_number_price_cents = 2000,
  seo_title = 'Patagonia FC Training Kit | PTG Activewear',
  meta_description = 'Shop the Patagonia FC Training Kit, including a breathable performance shirt, lightweight shorts and football socks. Available in sizes 8, 10, 12 and XS.',
  version = version + 1, updated_at = CURRENT_TIMESTAMP
WHERE id = 'patagonia-fc-training-kit';

INSERT OR IGNORE INTO product_variants
  (product_id, sku, size, colour, style, stock_quantity, active, allow_player_name, allow_player_number)
VALUES
  ('patagonia-fc-training-kit', 'PTG-PFC-TRAINING-KIT-8', '8', '', '', 0, 1, 1, 1),
  ('patagonia-fc-training-kit', 'PTG-PFC-TRAINING-KIT-10', '10', '', '', 0, 1, 1, 1),
  ('patagonia-fc-training-kit', 'PTG-PFC-TRAINING-KIT-12', '12', '', '', 0, 1, 1, 1),
  ('patagonia-fc-training-kit', 'PTG-PFC-TRAINING-KIT-XS', 'XS', '', '', 0, 1, 1, 1);

INSERT OR IGNORE INTO product_images
  (product_id, path, alt_text, sort_order, is_primary, active)
VALUES
  ('patagonia-fc-training-kit', '/photos/clouth/Patagonia FC Training Kit .jpeg', 'Patagonia FC Training Kit with player name and number printing', 1, 1, 1),
  ('patagonia-fc-training-kit', '/photos/clouth/Patagonia FC Training Kit - $95 - image 01.png', 'Patagonia FC Training Shirt', 2, 0, 1),
  ('patagonia-fc-training-kit', '/photos/clouth/Patagonia FC Training Kit - $95 - image 02.png', 'Patagonia FC Training Shorts', 3, 0, 1),
  ('patagonia-fc-training-kit', '/photos/clouth/Patagonia FC Training Kit - $95 - image 03.png', 'Patagonia FC Training Socks', 4, 0, 1),
  ('patagonia-fc-training-kit', '/photos/clouth/Patagonia FC training kit Short and Socks.jpeg', 'Patagonia FC Training Shorts and Socks', 5, 0, 1);

UPDATE product_images
SET active = 1,
    is_primary = CASE path WHEN '/photos/clouth/Patagonia FC Training Kit .jpeg' THEN 1 ELSE 0 END,
    sort_order = CASE path
      WHEN '/photos/clouth/Patagonia FC Training Kit .jpeg' THEN 1
      WHEN '/photos/clouth/Patagonia FC Training Kit - $95 - image 01.png' THEN 2
      WHEN '/photos/clouth/Patagonia FC Training Kit - $95 - image 02.png' THEN 3
      WHEN '/photos/clouth/Patagonia FC Training Kit - $95 - image 03.png' THEN 4
      ELSE 5 END,
    updated_at = CURRENT_TIMESTAMP
WHERE product_id = 'patagonia-fc-training-kit'
  AND path IN (
    '/photos/clouth/Patagonia FC Training Kit .jpeg',
    '/photos/clouth/Patagonia FC Training Kit - $95 - image 01.png',
    '/photos/clouth/Patagonia FC Training Kit - $95 - image 02.png',
    '/photos/clouth/Patagonia FC Training Kit - $95 - image 03.png',
    '/photos/clouth/Patagonia FC training kit Short and Socks.jpeg'
  );

-- Keep historical variant rows intact, but retire sizes no longer offered.
UPDATE product_variants
SET active = 0, version = version + 1, updated_at = CURRENT_TIMESTAMP
WHERE product_id = 'patagonia-fc-windbreaker-jacket'
  AND size NOT IN ('8', '10', '12', 'XS')
  AND active = 1;

INSERT OR IGNORE INTO product_variants
  (product_id, sku, size, colour, style, stock_quantity, active)
VALUES
  ('patagonia-fc-windbreaker-jacket', 'PTG-PFC-WINDBREAKER-8', '8', 'Blue', '', 0, 1),
  ('patagonia-fc-windbreaker-jacket', 'PTG-PFC-WINDBREAKER-10', '10', 'Blue', '', 0, 1),
  ('patagonia-fc-windbreaker-jacket', 'PTG-PFC-WINDBREAKER-12', '12', 'Blue', '', 0, 1);

UPDATE products
SET price_cents = 9500, currency = 'NZD', active = 1, available_for_sale = 1,
    seo_title = 'Patagonia FC Windbreaker Jacket | PTG Activewear',
    meta_description = 'Official Patagonia FC lightweight water-resistant windbreaker jacket. Available in sizes 8, 10, 12 and XS.',
    version = version + 1, updated_at = CURRENT_TIMESTAMP
WHERE id = 'patagonia-fc-windbreaker-jacket';

INSERT INTO admin_audit_log (admin_email, action, entity_type, entity_id, summary)
VALUES
  ('system-migration', 'create', 'product', 'patagonia-fc-training-kit', 'Created Patagonia FC Training Kit with sizes 8, 10, 12 and XS; stock starts at zero with inventory tracking disabled.'),
  ('system-migration', 'update', 'product', 'patagonia-fc-windbreaker-jacket', 'Updated price to NZD 95.00 and active sizes to 8, 10, 12 and XS; prior variant rows retained for history.');
