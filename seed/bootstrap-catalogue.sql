PRAGMA foreign_keys = ON;

-- Legacy media migrations refer to these catalogue IDs. This compact seed is
-- used only while bootstrapping a fresh local D1 database before those
-- migrations run; seed-products.sql supplies the complete local catalogue.
INSERT OR IGNORE INTO products (
  id, slug, name, description, category, product_type, badge, price_cents, currency,
  active, available_for_sale, featured, track_inventory,
  allow_player_name, allow_player_number, player_name_price_cents, player_number_price_cents
) VALUES
  ('patagonia-fc-beanie', 'patagonia-fc-beanie', 'Patagonia FC Beanie', 'Soft knitted beanie with the Patagonia FC crest and bold club branding.', 'accessories', 'Beanie', '', 3500, 'NZD', 1, 1, 1, 0, 0, 0, 0, 0),
  ('patagonia-fc-performance-tracksuit', 'patagonia-fc-performance-tracksuit', 'Patagonia FC Performance Tracksuit', 'Premium soft-touch performance tracksuit.', 'tracksuits', 'Tracksuit', 'New', 11500, 'NZD', 1, 1, 1, 0, 0, 0, 0, 0),
  ('patagonia-fc-personalised-mug', 'patagonia-fc-personalised-mug', 'Patagonia FC Personalised Mug', 'Premium ceramic mug with the Patagonia FC club logo.', 'accessories', 'Mug', '', 1500, 'NZD', 1, 1, 1, 0, 0, 0, 0, 0),
  ('patagonia-fc-tournament-player-kit', 'patagonia-fc-tournament-player-kit', 'Patagonia FC Tournament Player Kit', 'Includes shirt, shorts and socks.', 'kits', 'Player Kit', 'Match Day', 9500, 'NZD', 1, 1, 1, 0, 1, 1, 2000, 2000),
  ('patagonia-fc-waterproof-rain-suit', 'patagonia-fc-waterproof-rain-suit', 'Patagonia FC Waterproof Rain Suit', 'Lightweight waterproof two-piece rain suit.', 'rain-suits', 'Rain Suit', '', 5000, 'NZD', 1, 1, 1, 0, 0, 0, 0, 0);

INSERT OR IGNORE INTO product_variants (product_id, sku, size, colour, style, stock_quantity, active) VALUES
  ('patagonia-fc-beanie', 'PTG-PFC-BEANIE-OS', 'One Size', '', '', 0, 1),
  ('patagonia-fc-performance-tracksuit', 'PTG-PFC-TRACKSUIT-XS', 'XS', '', '', 0, 1),
  ('patagonia-fc-personalised-mug', 'PTG-PFC-MUG-OS', 'One Size', '', '', 0, 1),
  ('patagonia-fc-tournament-player-kit', 'PTG-PFC-KIT-XS', 'XS', '', '', 0, 1),
  ('patagonia-fc-waterproof-rain-suit', 'PTG-PFC-RAIN-XS', 'XS', '', '', 0, 1);
