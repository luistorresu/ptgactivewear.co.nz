PRAGMA foreign_keys = ON;

INSERT INTO invoice_sequence (year, next_value)
SELECT CAST(strftime('%Y', COALESCE(payment_date, created_at)) AS INTEGER), MAX(id) + 1
FROM orders
WHERE payment_status = 'paid'
GROUP BY CAST(strftime('%Y', COALESCE(payment_date, created_at)) AS INTEGER)
ON CONFLICT(year) DO UPDATE SET
  next_value = CASE WHEN excluded.next_value > invoice_sequence.next_value THEN excluded.next_value ELSE invoice_sequence.next_value END,
  updated_at = CURRENT_TIMESTAMP;

INSERT OR IGNORE INTO invoices (
  order_id, invoice_number, issue_date, customer_name, customer_email,
  billing_details_json, fulfilment_details_json, items_json,
  subtotal_cents, personalisation_cents, shipping_cents, processing_surcharge_cents,
  discount_cents, tax_cents, total_cents, refunded_cents, currency, status, snapshot_json
)
SELECT
  o.id,
  printf('PTG-INV-%s-%06d', strftime('%Y', COALESCE(o.payment_date, o.created_at)), o.id),
  COALESCE(o.invoice_created_at, o.payment_date, o.created_at),
  o.customer_name,
  o.customer_email,
  o.billing_address_json,
  json_object(
    'type', o.fulfilment_type,
    'method', o.shipping_method,
    'pickupLocation', o.pickup_location,
    'pickupInstructions', o.pickup_instructions,
    'shippingAddress', json(o.shipping_address_json)
  ),
  (SELECT json_group_array(json_object(
    'id', oi.id, 'product_id', oi.product_id, 'variant_id', oi.variant_id,
    'product_name', oi.product_name, 'sku', oi.sku, 'quantity', oi.quantity,
    'unit_price_cents', oi.unit_price_cents, 'player_name', oi.player_name,
    'player_number', oi.player_number, 'customisation_total_cents', oi.customisation_total_cents,
    'item_total_cents', oi.item_total_cents, 'size', oi.size, 'colour', oi.colour, 'style', oi.style
  )) FROM order_items oi WHERE oi.order_id = o.id),
  o.subtotal_cents,
  o.personalisation_cents,
  o.shipping_cents,
  o.payment_surcharge_cents,
  o.discount_cents,
  o.tax_cents,
  o.total_cents,
  o.refunded_cents,
  o.currency,
  CASE WHEN o.refunded_cents >= o.total_cents THEN 'refunded' WHEN o.refunded_cents > 0 THEN 'partially_refunded' ELSE 'issued' END,
  json_object(
    'id', o.id,
    'order_number', o.order_number,
    'invoice_number', printf('PTG-INV-%s-%06d', strftime('%Y', COALESCE(o.payment_date, o.created_at)), o.id),
    'invoice_created_at', COALESCE(o.invoice_created_at, o.payment_date, o.created_at),
    'payment_date', o.payment_date,
    'customer_name', o.customer_name,
    'customer_email', o.customer_email,
    'customer_phone', o.customer_phone,
    'billing_address', json(o.billing_address_json),
    'shipping_address', json(o.shipping_address_json),
    'fulfilment_type', o.fulfilment_type,
    'shipping_method', o.shipping_method,
    'pickup_location', o.pickup_location,
    'pickup_instructions', o.pickup_instructions,
    'shipping_name', o.shipping_name,
    'shipping_rural', o.shipping_rural,
    'subtotal_cents', o.subtotal_cents,
    'personalisation_cents', o.personalisation_cents,
    'shipping_cents', o.shipping_cents,
    'payment_surcharge_cents', o.payment_surcharge_cents,
    'payment_surcharge_enabled', o.payment_surcharge_enabled,
    'payment_surcharge_percent', o.payment_surcharge_percent,
    'payment_surcharge_fixed_cents', o.payment_surcharge_fixed_cents,
    'payment_surcharge_label', o.payment_surcharge_label,
    'discount_cents', o.discount_cents,
    'tax_cents', o.tax_cents,
    'total_cents', o.total_cents,
    'refunded_cents', o.refunded_cents,
    'currency', o.currency,
    'payment_status', o.payment_status,
    'payment_method_label', o.payment_method_label,
    'items', json((SELECT json_group_array(json_object(
      'id', si.id, 'product_id', si.product_id, 'variant_id', si.variant_id,
      'product_name', si.product_name, 'sku', si.sku, 'quantity', si.quantity,
      'unit_price_cents', si.unit_price_cents, 'player_name', si.player_name,
      'player_number', si.player_number, 'customisation_total_cents', si.customisation_total_cents,
      'item_total_cents', si.item_total_cents, 'size', si.size, 'colour', si.colour, 'style', si.style
    )) FROM order_items si WHERE si.order_id = o.id))
  )
FROM orders o
WHERE o.payment_status = 'paid' AND o.invoice_number IS NULL;

UPDATE orders
SET invoice_number = printf('PTG-INV-%s-%06d', strftime('%Y', COALESCE(payment_date, created_at)), id),
    invoice_created_at = COALESCE(invoice_created_at, payment_date, created_at),
    updated_at = CURRENT_TIMESTAMP
WHERE payment_status = 'paid' AND invoice_number IS NULL;
