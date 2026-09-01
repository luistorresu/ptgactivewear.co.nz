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
