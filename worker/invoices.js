function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

async function loadInvoiceOrder(db, orderId) {
  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) return null;
  const items = await db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').bind(orderId).all();
  return {
    ...order,
    shipping_address: parseJson(order.shipping_address_json, {}),
    billing_address: parseJson(order.billing_address_json, {}),
    shipping_address_json: undefined,
    billing_address_json: undefined,
    items: items.results || []
  };
}

function publicInvoiceSnapshot(order) {
  return {
    ...order,
    stripe_checkout_session_id: undefined,
    stripe_payment_intent_id: undefined,
    stripe_event_id: undefined,
    internal_notes: undefined
  };
}

export async function ensureInvoiceSnapshot(db, orderId, identity = null) {
  let order = await loadInvoiceOrder(db, orderId);
  if (!order) return null;
  if (order.payment_status !== 'paid') throw new Error('Invoices are only available for paid orders.');

  let invoice = await db.prepare('SELECT * FROM invoices WHERE order_id = ?').bind(orderId).first();
  if (!order.invoice_number) {
    const year = Number(String(order.payment_date || order.created_at || new Date().toISOString()).slice(0, 4));
    const sequence = await db.prepare(`INSERT INTO invoice_sequence (year, next_value) VALUES (?, 2)
      ON CONFLICT(year) DO UPDATE SET next_value = next_value + 1, updated_at = CURRENT_TIMESTAMP
      RETURNING next_value - 1 AS value`).bind(year).first();
    const invoiceNumber = `PTG-INV-${year}-${String(sequence.value).padStart(6, '0')}`;
    const result = await db.prepare('UPDATE orders SET invoice_number = ?, invoice_created_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND invoice_number IS NULL').bind(invoiceNumber, orderId).run();
    order = await loadInvoiceOrder(db, orderId);
    if (result.meta.changes && identity?.email) {
      await db.prepare(`INSERT INTO admin_audit_log (admin_email, action, entity_type, entity_id, summary)
        VALUES (?, 'generate_invoice', 'order', ?, ?)`).bind(identity.email, String(orderId), `Generated ${invoiceNumber}`).run();
    }
  }

  if (!invoice) {
    const snapshot = publicInvoiceSnapshot(order);
    const invoiceStatus = Number(order.refunded_cents || 0) >= Number(order.total_cents || 0)
      ? 'refunded' : Number(order.refunded_cents || 0) > 0 ? 'partially_refunded' : 'issued';
    await db.prepare(`INSERT OR IGNORE INTO invoices (
      order_id, invoice_number, issue_date, customer_name, customer_email,
      billing_details_json, fulfilment_details_json, items_json,
      subtotal_cents, personalisation_cents, shipping_cents, processing_surcharge_cents,
      discount_cents, tax_cents, total_cents, refunded_cents, currency, status, snapshot_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(orderId, order.invoice_number, order.invoice_created_at || new Date().toISOString(), order.customer_name, order.customer_email,
        JSON.stringify(order.billing_address || {}), JSON.stringify({ type: order.fulfilment_type, method: order.shipping_method, pickupLocation: order.pickup_location, pickupInstructions: order.pickup_instructions, shippingAddress: order.shipping_address || {} }), JSON.stringify(order.items || []),
        order.subtotal_cents, order.personalisation_cents, order.shipping_cents, order.payment_surcharge_cents,
        order.discount_cents, order.tax_cents, order.total_cents, order.refunded_cents, order.currency, invoiceStatus, JSON.stringify(snapshot)).run();
    invoice = await db.prepare('SELECT * FROM invoices WHERE order_id = ?').bind(orderId).first();
  }

  const snapshot = parseJson(invoice?.snapshot_json, publicInvoiceSnapshot(order));
  return { ...snapshot, invoice_number: invoice.invoice_number, invoice_created_at: invoice.issue_date, invoice_status: invoice.status, refunded_cents: invoice.refunded_cents };
}
