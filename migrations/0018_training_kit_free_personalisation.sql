PRAGMA foreign_keys = ON;

UPDATE products
SET
  player_name_price_cents = 0,
  player_number_price_cents = 0,
  version = version + 1,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'patagonia-fc-training-kit'
  AND (player_name_price_cents != 0 OR player_number_price_cents != 0);
