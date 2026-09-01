PRAGMA foreign_keys = ON;

ALTER TABLE raffle_reservations ADD COLUMN customer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE raffle_reservations ADD COLUMN child_name TEXT NOT NULL DEFAULT '';
ALTER TABLE raffle_reservations ADD COLUMN customer_email TEXT NOT NULL DEFAULT '';
ALTER TABLE raffle_reservations ADD COLUMN external_provider TEXT NOT NULL DEFAULT '';
ALTER TABLE raffle_reservations ADD COLUMN external_url TEXT NOT NULL DEFAULT '';

UPDATE raffles
SET reservation_minutes = 1440,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'patagonia-fc-tournament-2026';

CREATE TRIGGER IF NOT EXISTS raffle_manual_confirmation
AFTER UPDATE OF status ON raffle_numbers
WHEN OLD.status = 'reserved' AND NEW.status = 'sold' AND NEW.reservation_token IS NOT NULL
BEGIN
  UPDATE raffle_reservations
  SET status = 'committed', updated_at = CURRENT_TIMESTAMP
  WHERE reservation_token = NEW.reservation_token
    AND raffle_id = NEW.raffle_id
    AND status = 'reserved';
END;
