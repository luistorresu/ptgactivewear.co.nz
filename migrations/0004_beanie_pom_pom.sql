PRAGMA foreign_keys = ON;

UPDATE products
SET description = 'Soft knitted beanie with the Patagonia FC crest and bold club branding. Choose your preferred style with or without a pom pom.',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'patagonia-fc-beanie';

UPDATE product_variants
SET style = 'Without Pom Pom',
    updated_at = CURRENT_TIMESTAMP
WHERE product_id = 'patagonia-fc-beanie'
  AND sku = 'PTG-PFC-BEANIE-OS';

INSERT OR IGNORE INTO product_variants (
  product_id, sku, size, colour, style, stock_quantity, active,
  allow_player_name, allow_player_number
) VALUES (
  'patagonia-fc-beanie', 'PTG-PFC-BEANIE-POMPOM', 'One Size', '', 'With Pom Pom', 0, 1, 0, 0
);

UPDATE product_images
SET active = 0,
    is_primary = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE product_id = 'patagonia-fc-beanie';

INSERT OR IGNORE INTO product_images (
  product_id, path, alt_text, sort_order, is_primary, active, variant_style
) VALUES
  ('patagonia-fc-beanie', '/photos/clouth/binnie 1.jpeg', 'Patagonia FC Beanie without pom pom', 1, 1, 1, 'Without Pom Pom'),
  ('patagonia-fc-beanie', '/photos/clouth/binnie PomPom.jpeg', 'Patagonia FC Beanie with pom pom', 1, 0, 1, 'With Pom Pom');
