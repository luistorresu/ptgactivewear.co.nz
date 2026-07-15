PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO products (
  id, slug, name, description, category, product_type, badge, price_cents, currency,
  active, available_for_sale, featured, track_inventory,
  allow_player_name, allow_player_number, player_name_price_cents, player_number_price_cents,
  seo_title, meta_description
) VALUES (
  'patagonia-fc-windbreaker-jacket',
  'patagonia-fc-windbreaker-jacket',
  'Patagonia FC Windbreaker Jacket',
  'Stay comfortable and protected in changing weather with the official Patagonia FC Windbreaker Jacket. Designed for training, travel and everyday wear, this lightweight jacket offers protection from wind and light showers while remaining breathable and comfortable. Constructed from a durable water-resistant outer shell, it features a soft mesh lining that improves airflow and comfort without adding unnecessary weight. The full-length front zip allows for easy layering, while the elasticated cuffs and waistband provide a secure fit. Includes two side pockets. Finished with the official Patagonia FC crest and PTG Activewear branding, this jacket combines performance with a clean, professional look. Features: water-resistant outer fabric for light rain and windy conditions; lightweight design; breathable mesh inner lining; full front zipper; two side pockets; elasticated cuffs and waistband; official Patagonia FC and PTG Activewear branding; athletic fit; suitable for players. Please note: this jacket is water-resistant and is not designed as a fully waterproof raincoat.',
  'jackets',
  'Windbreaker Jacket',
  'New',
  12000,
  'NZD',
  1, 1, 0, 0, 0, 0, 0, 0,
  'Patagonia FC Windbreaker Jacket | PTG Activewear',
  'Official Patagonia FC lightweight, water-resistant windbreaker jacket with breathable mesh lining, full zip, side pockets and athletic fit.'
);

INSERT OR IGNORE INTO product_variants
  (product_id, sku, size, colour, style, stock_quantity, active)
VALUES
  ('patagonia-fc-windbreaker-jacket', 'PTG-PFC-WINDBREAKER-XS', 'XS', 'Blue', '', 0, 1),
  ('patagonia-fc-windbreaker-jacket', 'PTG-PFC-WINDBREAKER-S', 'S', 'Blue', '', 0, 1),
  ('patagonia-fc-windbreaker-jacket', 'PTG-PFC-WINDBREAKER-M', 'M', 'Blue', '', 0, 1),
  ('patagonia-fc-windbreaker-jacket', 'PTG-PFC-WINDBREAKER-L', 'L', 'Blue', '', 0, 1),
  ('patagonia-fc-windbreaker-jacket', 'PTG-PFC-WINDBREAKER-XL', 'XL', 'Blue', '', 0, 1),
  ('patagonia-fc-windbreaker-jacket', 'PTG-PFC-WINDBREAKER-2XL', '2XL', 'Blue', '', 0, 1);

INSERT OR IGNORE INTO product_images
  (product_id, path, alt_text, sort_order, is_primary, active)
VALUES
  ('patagonia-fc-windbreaker-jacket', '/photos/clouth/Windbreaker.jpeg', 'Patagonia FC Windbreaker Jacket front and back views', 1, 1, 1),
  ('patagonia-fc-windbreaker-jacket', '/photos/clouth/WindBreaker 2.png', 'Patagonia FC Windbreaker Jacket front view', 2, 0, 1),
  ('patagonia-fc-windbreaker-jacket', '/photos/clouth/Windbreaker 1.png', 'Patagonia FC Windbreaker Jacket back view', 3, 0, 1);
