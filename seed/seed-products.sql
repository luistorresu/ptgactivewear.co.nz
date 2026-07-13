PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO products (
  id, slug, name, description, category, product_type, badge, price_cents, currency,
  active, available_for_sale, featured, track_inventory,
  allow_player_name, allow_player_number, player_name_price_cents, player_number_price_cents
) VALUES
  ('patagonia-fc-beanie', 'patagonia-fc-beanie', 'Patagonia FC Beanie', 'Soft knitted beanie with the Patagonia FC crest and bold club branding for training, match days and everyday wear. Two styles available.', 'accessories', 'Beanie', '', 3500, 'NZD', 1, 1, 1, 0, 0, 0, 0, 0),
  ('patagonia-fc-performance-tracksuit', 'patagonia-fc-performance-tracksuit', 'Patagonia FC Performance Tracksuit', 'Premium soft-touch performance tracksuit for training, travel and everyday wear, with a full-zip jacket and tapered pants.', 'tracksuits', 'Tracksuit', 'New', 11500, 'NZD', 1, 1, 1, 0, 0, 0, 0, 0),
  ('patagonia-fc-personalised-mug', 'patagonia-fc-personalised-mug', 'Patagonia FC Personalised Mug', 'Premium ceramic mug with the Patagonia FC club logo, 2026 season design and personalised player name and number.', 'accessories', 'Mug', '', 1500, 'NZD', 1, 1, 1, 0, 0, 0, 0, 0),
  ('patagonia-fc-tournament-player-kit', 'patagonia-fc-tournament-player-kit', 'Patagonia FC Tournament Player Kit', 'Lightweight, breathable tournament kit with moisture-wicking fabric. Includes shirt, shorts and socks.', 'kits', 'Player Kit', 'Match Day', 9500, 'NZD', 1, 1, 1, 0, 1, 1, 2000, 2000),
  ('patagonia-fc-waterproof-rain-suit', 'patagonia-fc-waterproof-rain-suit', 'Patagonia FC Waterproof Rain Suit', 'Lightweight waterproof two-piece rain suit with taped seams, breathable fabric and easy overpants for wet training days.', 'rain-suits', 'Rain Suit', '', 5000, 'NZD', 1, 1, 1, 0, 0, 0, 0, 0);

INSERT OR IGNORE INTO product_variants (product_id, sku, size, colour, style, stock_quantity, active) VALUES
  ('patagonia-fc-beanie', 'PTG-PFC-BEANIE-OS', 'One Size', '', '', 0, 1),
  ('patagonia-fc-performance-tracksuit', 'PTG-PFC-TRACKSUIT-XS', 'XS', '', '', 0, 1),
  ('patagonia-fc-performance-tracksuit', 'PTG-PFC-TRACKSUIT-S', 'S', '', '', 0, 1),
  ('patagonia-fc-performance-tracksuit', 'PTG-PFC-TRACKSUIT-M', 'M', '', '', 0, 1),
  ('patagonia-fc-performance-tracksuit', 'PTG-PFC-TRACKSUIT-L', 'L', '', '', 0, 1),
  ('patagonia-fc-performance-tracksuit', 'PTG-PFC-TRACKSUIT-XL', 'XL', '', '', 0, 1),
  ('patagonia-fc-performance-tracksuit', 'PTG-PFC-TRACKSUIT-2XL', '2XL', '', '', 0, 1),
  ('patagonia-fc-personalised-mug', 'PTG-PFC-MUG-OS', 'One Size', '', '', 0, 1),
  ('patagonia-fc-tournament-player-kit', 'PTG-PFC-KIT-XS', 'XS', '', '', 0, 1),
  ('patagonia-fc-tournament-player-kit', 'PTG-PFC-KIT-S', 'S', '', '', 0, 1),
  ('patagonia-fc-tournament-player-kit', 'PTG-PFC-KIT-M', 'M', '', '', 0, 1),
  ('patagonia-fc-tournament-player-kit', 'PTG-PFC-KIT-L', 'L', '', '', 0, 1),
  ('patagonia-fc-tournament-player-kit', 'PTG-PFC-KIT-XL', 'XL', '', '', 0, 1),
  ('patagonia-fc-tournament-player-kit', 'PTG-PFC-KIT-2XL', '2XL', '', '', 0, 1),
  ('patagonia-fc-waterproof-rain-suit', 'PTG-PFC-RAIN-XS', 'XS', '', '', 0, 1),
  ('patagonia-fc-waterproof-rain-suit', 'PTG-PFC-RAIN-S', 'S', '', '', 0, 1),
  ('patagonia-fc-waterproof-rain-suit', 'PTG-PFC-RAIN-M', 'M', '', '', 0, 1),
  ('patagonia-fc-waterproof-rain-suit', 'PTG-PFC-RAIN-L', 'L', '', '', 0, 1),
  ('patagonia-fc-waterproof-rain-suit', 'PTG-PFC-RAIN-XL', 'XL', '', '', 0, 1),
  ('patagonia-fc-waterproof-rain-suit', 'PTG-PFC-RAIN-2XL', '2XL', '', '', 0, 1);

INSERT OR IGNORE INTO product_images (product_id, path, alt_text, sort_order, is_primary) VALUES
  ('patagonia-fc-beanie', '/photos/clouth/Patagonia FC Beanie - $35 - image 01.png', 'Patagonia FC Beanie', 1, 1),
  ('patagonia-fc-performance-tracksuit', '/photos/clouth/Patagonia FC Performance Tracksuit - $115 - image 03.png', 'Patagonia FC Performance Tracksuit front view', 1, 1),
  ('patagonia-fc-performance-tracksuit', '/photos/clouth/Patagonia FC Performance Tracksuit - $115 - image 01.png', 'Patagonia FC Performance Tracksuit alternate view 1', 2, 0),
  ('patagonia-fc-performance-tracksuit', '/photos/clouth/Patagonia FC Performance Tracksuit - $115 - image 02.png', 'Patagonia FC Performance Tracksuit alternate view 2', 3, 0),
  ('patagonia-fc-performance-tracksuit', '/photos/clouth/Patagonia FC Performance Tracksuit - $115 - image 04.png', 'Patagonia FC Performance Tracksuit alternate view 3', 4, 0),
  ('patagonia-fc-personalised-mug', '/photos/clouth/Patagonia FC Personalised Mug - $15 - image 01.png', 'Patagonia FC Personalised Mug', 1, 1),
  ('patagonia-fc-personalised-mug', '/photos/clouth/Patagonia FC Personalised Mug - $15 - image 02.png', 'Patagonia FC Personalised Mug alternate view 1', 2, 0),
  ('patagonia-fc-personalised-mug', '/photos/clouth/Patagonia FC Personalised Mug - $15 - image 03.png', 'Patagonia FC Personalised Mug alternate view 2', 3, 0),
  ('patagonia-fc-personalised-mug', '/photos/clouth/Patagonia FC Personalised Mug - $15 - image 04.png', 'Patagonia FC Personalised Mug alternate view 3', 4, 0),
  ('patagonia-fc-personalised-mug', '/photos/clouth/Patagonia FC Personalised Mug - $15 - image 05.png', 'Patagonia FC Personalised Mug alternate view 4', 5, 0),
  ('patagonia-fc-personalised-mug', '/photos/clouth/Patagonia FC Personalised Mug - $15 - image 06.png', 'Patagonia FC Personalised Mug alternate view 5', 6, 0),
  ('patagonia-fc-tournament-player-kit', '/photos/clouth/Patagonia FC Tournament Player Kit - $95 - image 01.png', 'Patagonia FC Tournament Player Kit', 1, 1),
  ('patagonia-fc-tournament-player-kit', '/photos/clouth/Patagonia FC Tournament Player Kit - $95 - image 02.png', 'Patagonia FC Tournament Player Kit alternate view 1', 2, 0),
  ('patagonia-fc-tournament-player-kit', '/photos/clouth/Patagonia FC Tournament Player Kit - $95 - image 03.png', 'Patagonia FC Tournament Player Kit alternate view 2', 3, 0),
  ('patagonia-fc-tournament-player-kit', '/photos/clouth/Patagonia FC Tournament Player Kit - $95 - image 04.png', 'Patagonia FC Tournament Player Kit alternate view 3', 4, 0),
  ('patagonia-fc-waterproof-rain-suit', '/photos/clouth/Patagonia FC Waterproof Rain Suit - $50 - image 01.png', 'Patagonia FC Waterproof Rain Suit', 1, 1);
