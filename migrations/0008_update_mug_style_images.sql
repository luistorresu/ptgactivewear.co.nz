PRAGMA foreign_keys = ON;

UPDATE product_images
SET active = 0, is_primary = 0, updated_at = CURRENT_TIMESTAMP
WHERE product_id = 'patagonia-fc-personalised-mug';

INSERT OR IGNORE INTO product_images
  (product_id, path, alt_text, sort_order, is_primary, active, variant_style)
VALUES
  ('patagonia-fc-personalised-mug', '/photos/clouth/Mug style 1  new .jpeg', 'Patagonia FC Mug Style 1 club design', 1, 1, 1, 'Style 1'),
  ('patagonia-fc-personalised-mug', '/photos/clouth/Mug Style 2 New.jpeg', 'Patagonia FC Mug Style 2 personalised name and number design', 2, 0, 1, 'Style 2');

UPDATE product_images
SET
  alt_text = CASE path
    WHEN '/photos/clouth/Mug style 1  new .jpeg' THEN 'Patagonia FC Mug Style 1 club design'
    ELSE 'Patagonia FC Mug Style 2 personalised name and number design'
  END,
  sort_order = CASE path WHEN '/photos/clouth/Mug style 1  new .jpeg' THEN 1 ELSE 2 END,
  is_primary = CASE path WHEN '/photos/clouth/Mug style 1  new .jpeg' THEN 1 ELSE 0 END,
  active = 1,
  variant_style = CASE path WHEN '/photos/clouth/Mug style 1  new .jpeg' THEN 'Style 1' ELSE 'Style 2' END,
  updated_at = CURRENT_TIMESTAMP
WHERE product_id = 'patagonia-fc-personalised-mug'
  AND path IN ('/photos/clouth/Mug style 1  new .jpeg', '/photos/clouth/Mug Style 2 New.jpeg');
