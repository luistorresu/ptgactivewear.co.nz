PRAGMA foreign_keys = ON;

UPDATE raffles
SET total_numbers = 40,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'patagonia-fc-tournament-2026'
  AND total_numbers = 36;

INSERT OR IGNORE INTO raffle_numbers (raffle_id, number)
VALUES
  ('patagonia-fc-tournament-2026', 37),
  ('patagonia-fc-tournament-2026', 38),
  ('patagonia-fc-tournament-2026', 39),
  ('patagonia-fc-tournament-2026', 40);
