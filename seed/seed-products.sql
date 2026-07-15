PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO products (
  id, slug, name, description, category, product_type, badge, price_cents, currency,
  active, available_for_sale, featured, track_inventory,
  allow_player_name, allow_player_number, player_name_price_cents, player_number_price_cents
) VALUES
  ('patagonia-fc-beanie', 'patagonia-fc-beanie', 'Patagonia FC Beanie', 'Soft knitted beanie with the Patagonia FC crest and bold club branding. Choose your preferred style with or without a pom pom.', 'accessories', 'Beanie', '', 3500, 'NZD', 1, 1, 1, 0, 0, 0, 0, 0),
  ('patagonia-fc-performance-tracksuit', 'patagonia-fc-performance-tracksuit', 'Patagonia FC Performance Tracksuit', 'Premium soft-touch performance tracksuit for training, travel and everyday wear, with a full-zip jacket and tapered pants.', 'tracksuits', 'Tracksuit', 'New', 11500, 'NZD', 1, 1, 1, 0, 0, 0, 0, 0),
  ('patagonia-fc-personalised-mug', 'patagonia-fc-personalised-mug', 'Patagonia FC Personalised Mug', 'Premium ceramic mug with the Patagonia FC club logo, 2026 season design and personalised player name and number.', 'accessories', 'Mug', '', 1500, 'NZD', 1, 1, 1, 0, 0, 0, 0, 0),
  ('patagonia-fc-tournament-player-kit', 'patagonia-fc-tournament-player-kit', 'Patagonia FC Tournament Player Kit', 'Lightweight, breathable tournament kit with moisture-wicking fabric. Includes shirt, shorts and socks.', 'kits', 'Player Kit', 'Match Day', 9500, 'NZD', 1, 1, 1, 0, 1, 1, 2000, 2000),
  ('patagonia-fc-waterproof-rain-suit', 'patagonia-fc-waterproof-rain-suit', 'Patagonia FC Waterproof Rain Suit', 'Lightweight waterproof two-piece rain suit with taped seams, breathable fabric and easy overpants for wet training days.', 'rain-suits', 'Rain Suit', '', 5000, 'NZD', 1, 1, 1, 0, 0, 0, 0, 0),
  ('patagonia-fc-windbreaker-jacket', 'patagonia-fc-windbreaker-jacket', 'Patagonia FC Windbreaker Jacket', 'Stay comfortable and protected in changing weather with the official Patagonia FC Windbreaker Jacket. Designed for training, travel and everyday wear, this lightweight jacket offers protection from wind and light showers while remaining breathable and comfortable. Constructed from a durable water-resistant outer shell, it features a soft mesh lining that improves airflow and comfort without adding unnecessary weight. The full-length front zip allows for easy layering, while the elasticated cuffs and waistband provide a secure fit. Includes two side pockets. Finished with the official Patagonia FC crest and PTG Activewear branding, this jacket combines performance with a clean, professional look. Features: water-resistant outer fabric for light rain and windy conditions; lightweight design; breathable mesh inner lining; full front zipper; two side pockets; elasticated cuffs and waistband; official Patagonia FC and PTG Activewear branding; athletic fit; suitable for players. Please note: this jacket is water-resistant and is not designed as a fully waterproof raincoat.', 'jackets', 'Windbreaker Jacket', 'New', 12000, 'NZD', 1, 1, 0, 0, 0, 0, 0, 0);

INSERT OR IGNORE INTO product_variants (product_id, sku, size, colour, style, stock_quantity, active) VALUES
  ('patagonia-fc-beanie', 'PTG-PFC-BEANIE-OS', 'One Size', '', 'Without Pom Pom', 0, 1),
  ('patagonia-fc-beanie', 'PTG-PFC-BEANIE-POMPOM', 'One Size', '', 'With Pom Pom', 0, 1),
  ('patagonia-fc-performance-tracksuit', 'PTG-PFC-TRACKSUIT-XS', 'XS', '', '', 0, 1),
  ('patagonia-fc-performance-tracksuit', 'PTG-PFC-TRACKSUIT-S', 'S', '', '', 0, 1),
  ('patagonia-fc-performance-tracksuit', 'PTG-PFC-TRACKSUIT-M', 'M', '', '', 0, 1),
  ('patagonia-fc-performance-tracksuit', 'PTG-PFC-TRACKSUIT-L', 'L', '', '', 0, 1),
  ('patagonia-fc-performance-tracksuit', 'PTG-PFC-TRACKSUIT-XL', 'XL', '', '', 0, 1),
  ('patagonia-fc-performance-tracksuit', 'PTG-PFC-TRACKSUIT-2XL', '2XL', '', '', 0, 1),
  ('patagonia-fc-personalised-mug', 'PTG-PFC-MUG-OS', 'One Size', '', 'Style 1', 0, 1),
  ('patagonia-fc-personalised-mug', 'PTG-PFC-MUG-STYLE-2', 'One Size', '', 'Style 2', 0, 1),
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
  ('patagonia-fc-waterproof-rain-suit', 'PTG-PFC-RAIN-2XL', '2XL', '', '', 0, 1),
  ('patagonia-fc-windbreaker-jacket', 'PTG-PFC-WINDBREAKER-XS', 'XS', 'Blue', '', 0, 1),
  ('patagonia-fc-windbreaker-jacket', 'PTG-PFC-WINDBREAKER-S', 'S', 'Blue', '', 0, 1),
  ('patagonia-fc-windbreaker-jacket', 'PTG-PFC-WINDBREAKER-M', 'M', 'Blue', '', 0, 1),
  ('patagonia-fc-windbreaker-jacket', 'PTG-PFC-WINDBREAKER-L', 'L', 'Blue', '', 0, 1),
  ('patagonia-fc-windbreaker-jacket', 'PTG-PFC-WINDBREAKER-XL', 'XL', 'Blue', '', 0, 1),
  ('patagonia-fc-windbreaker-jacket', 'PTG-PFC-WINDBREAKER-2XL', '2XL', 'Blue', '', 0, 1);

INSERT OR IGNORE INTO product_images (product_id, path, alt_text, sort_order, is_primary) VALUES
  ('patagonia-fc-beanie', '/photos/clouth/binnie 1.jpeg', 'Patagonia FC Beanie without pom pom', 1, 1),
  ('patagonia-fc-beanie', '/photos/clouth/binnie PomPom.jpeg', 'Patagonia FC Beanie with pom pom', 2, 0),
  ('patagonia-fc-performance-tracksuit', '/photos/clouth/Patagonia FC Performance Tracksuit - $115 - image 01.png', 'Patagonia FC Performance Tracksuit front and back', 1, 1),
  ('patagonia-fc-performance-tracksuit', '/photos/clouth/Patagonia FC Performance Tracksuit - $115 - image 03.png', 'Patagonia FC Performance Tracksuit alternate view', 2, 0),
  ('patagonia-fc-performance-tracksuit', '/photos/clouth/Tracksuit .jpeg', 'Patagonia FC Performance Tracksuit detail view', 3, 0),
  ('patagonia-fc-personalised-mug', '/photos/clouth/Mug style 1  new .jpeg', 'Patagonia FC Mug Style 1 club design', 1, 1),
  ('patagonia-fc-personalised-mug', '/photos/clouth/Mug Style 2 New.jpeg', 'Patagonia FC Mug Style 2 personalised name and number design', 2, 0),
  ('patagonia-fc-tournament-player-kit', '/photos/clouth/Patagonia FC Tournament Player Kit - $95 - image 01.png', 'Patagonia FC Tournament Player Kit', 1, 1),
  ('patagonia-fc-tournament-player-kit', '/photos/clouth/Patagonia FC Tournament Player Kit - $95 - image 02.png', 'Patagonia FC Tournament Player Kit alternate view 1', 2, 0),
  ('patagonia-fc-tournament-player-kit', '/photos/clouth/Shorts $95 - image 03.png', 'Patagonia FC Tournament Player Kit shorts', 3, 0),
  ('patagonia-fc-tournament-player-kit', '/photos/clouth/Patagonia FC Tournament Player Kit - $95 - image 04.png', 'Patagonia FC Tournament Player Kit alternate view 3', 4, 0),
  ('patagonia-fc-waterproof-rain-suit', '/photos/clouth/Patagonia FC Waterproof Rain Suit - $50 - image 01.png', 'Patagonia FC Waterproof Rain Suit', 1, 1),
  ('patagonia-fc-waterproof-rain-suit', '/photos/clouth/Patagonia FC Waterproof Rain Suit - $50 - image 011.jpeg', 'Patagonia FC Waterproof Rain Suit alternate view', 2, 0),
  ('patagonia-fc-windbreaker-jacket', '/photos/clouth/Windbreaker.jpeg', 'Patagonia FC Windbreaker Jacket front and back views', 1, 1),
  ('patagonia-fc-windbreaker-jacket', '/photos/clouth/WindBreaker 2.png', 'Patagonia FC Windbreaker Jacket front view', 2, 0),
  ('patagonia-fc-windbreaker-jacket', '/photos/clouth/Windbreaker 1.png', 'Patagonia FC Windbreaker Jacket back view', 3, 0);

UPDATE product_variants SET allow_player_name = 0, allow_player_number = 0
WHERE product_id = 'patagonia-fc-personalised-mug' AND style = 'Style 1';
UPDATE product_variants SET allow_player_name = 1, allow_player_number = 1
WHERE product_id = 'patagonia-fc-personalised-mug' AND style = 'Style 2';
