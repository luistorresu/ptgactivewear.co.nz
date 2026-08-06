const SUPPORT_EMAIL = 'info@ptgactivewear.co.nz';

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')) && String(value).length <= 254;
}

function pickupAddress(env) {
  return [
    cleanText(env.PICKUP_ADDRESS_LINE_1, 200),
    cleanText(env.PICKUP_ADDRESS_LINE_2, 200),
    cleanText(env.PICKUP_CITY, 120),
    cleanText(env.PICKUP_POSTCODE, 20)
  ].filter(Boolean).join(', ');
}

function firstName(value) {
  return cleanText(value, 200).split(/\s+/)[0] || 'there';
}

export function readyCollectionEmailConfigured(env) {
  const provider = cleanText(env.EMAIL_PROVIDER || 'resend', 30).toLowerCase();
  return provider === 'resend' && validEmail(cleanText(env.CONTACT_FROM_EMAIL, 254)) && Boolean(env.EMAIL_API_KEY);
}

export function validateCollectionAction(order, action) {
  if (!order) return { error: 'Order not found.', status: 404, code: 'ORDER_NOT_FOUND' };
  if (order.fulfilment_type !== 'pickup') {
    return { error: 'Ready to Collect is available only for pickup orders.', status: 409, code: 'NOT_PICKUP' };
  }
  if (order.payment_status !== 'paid') {
    return { error: 'The order must be paid before it can be marked ready.', status: 409, code: 'NOT_PAID' };
  }
  if (['cancelled', 'refunded'].includes(order.fulfilment_status)
    || ['fully_refunded', 'refunded'].includes(order.refund_status)
    || Number(order.refunded_cents || 0) >= Number(order.total_cents || 0)) {
    return { error: 'Cancelled or fully refunded orders cannot be marked ready.', status: 409, code: 'ORDER_CLOSED' };
  }
  if (action !== 'collected' && !validEmail(order.customer_email)) {
    return { error: 'This order does not have a valid customer email address.', status: 409, code: 'MISSING_EMAIL' };
  }
  if (action === 'initial' && order.ready_for_collection_email_sent_at) {
    return { error: 'The Ready to Collect email has already been sent. Use Resend instead.', status: 409, code: 'ALREADY_SENT' };
  }
  if (action === 'resend' && !order.ready_for_collection_email_sent_at) {
    return { error: 'Send the first Ready to Collect email before using Resend.', status: 409, code: 'NOT_SENT' };
  }
  if (action === 'collected' && order.fulfilment_status !== 'ready_for_collection') {
    return { error: 'Mark the order ready for collection before marking it collected.', status: 409, code: 'NOT_READY' };
  }
  if (order.fulfilment_status === 'collected' && action !== 'collected') {
    return { error: 'This order has already been collected.', status: 409, code: 'ALREADY_COLLECTED' };
  }
  return { ok: true };
}

export function buildReadyToCollectEmail(order, env) {
  const location = cleanText(order.pickup_location || env.PICKUP_LOCATION_NAME, 120) || 'Training Centre';
  const instructions = cleanText(order.pickup_instructions || env.PICKUP_INSTRUCTIONS, 300)
    || 'Please contact PTG Activewear if you need help with collection.';
  const address = pickupAddress(env);
  const supportEmail = cleanText(env.CONTACT_TO_EMAIL, 254) || SUPPORT_EMAIL;
  const orderNumber = cleanText(order.order_number, 80) || 'PTG Activewear order';
  const greetingName = firstName(order.customer_name);
  const childName = cleanText(order.child_name, 60);
  const readyMessage = childName
    ? `Great news - your PTG Activewear order for ${childName} is ready to collect from the training centre.`
    : 'Great news - your PTG Activewear order is ready to collect from the training centre.';
  const addressText = address ? [`Pickup address:`, address, ''] : [];
  const addressHtml = address
    ? `<div style="margin:0 0 18px"><strong style="display:block;color:#586574;font-size:12px;text-transform:uppercase">Pickup address</strong><span>${escapeHtml(address)}</span></div>`
    : '';

  const text = [
    `Hi ${greetingName},`,
    '',
    readyMessage,
    '',
    'Order number:',
    orderNumber,
    '',
    ...(childName ? ["Child's Name:", childName, ''] : []),
    'Pickup location:',
    location,
    '',
    ...addressText,
    'Pickup instructions:',
    instructions,
    '',
    'Please bring your order number when collecting your order.',
    '',
    'Thank you for your order.',
    '',
    'PTG Activewear',
    supportEmail
  ].join('\n');

  const html = `<!doctype html>
  <html lang="en"><body style="margin:0;background:#f3f6f8;color:#101820;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f8;padding:24px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dbe1e7">
          <tr><td style="padding:22px 28px;background:#07090b;color:#ffffff;font-size:20px;font-weight:700">PTG Activewear</td></tr>
          <tr><td style="padding:30px 28px">
            <p style="margin:0 0 18px">Hi ${escapeHtml(greetingName)},</p>
            <h1 style="margin:0 0 14px;font-size:26px;line-height:1.2">Your order is ready to collect</h1>
            <p style="margin:0 0 24px;line-height:1.6">${escapeHtml(readyMessage)}</p>
            ${childName ? `<div style="margin:0 0 18px"><strong style="display:block;color:#586574;font-size:12px;text-transform:uppercase">Child's Name</strong><span>${escapeHtml(childName)}</span></div>` : ''}
            <div style="margin:0 0 18px"><strong style="display:block;color:#586574;font-size:12px;text-transform:uppercase">Order number</strong><span style="font-size:20px;font-weight:700">${escapeHtml(orderNumber)}</span></div>
            <div style="margin:0 0 18px"><strong style="display:block;color:#586574;font-size:12px;text-transform:uppercase">Pickup location</strong><span>${escapeHtml(location)}</span></div>
            ${addressHtml}
            <div style="margin:0 0 22px"><strong style="display:block;color:#586574;font-size:12px;text-transform:uppercase">Pickup instructions</strong><span>${escapeHtml(instructions)}</span></div>
            <p style="margin:0 0 20px;line-height:1.6">Please bring your order number when collecting your order.</p>
            <p style="margin:0;line-height:1.6">Thank you for your order.<br><strong>PTG Activewear</strong><br><a href="mailto:${escapeHtml(supportEmail)}" style="color:#087f9b">${escapeHtml(supportEmail)}</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;

  return {
    to: cleanText(order.customer_email, 254),
    replyTo: supportEmail,
    subject: 'Your PTG Activewear order is ready to collect',
    text,
    html
  };
}

export async function sendReadyToCollectEmail(env, email, idempotencyKey) {
  if (!readyCollectionEmailConfigured(env)) {
    const error = new Error('Ready to Collect email is not configured.');
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.EMAIL_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': cleanText(idempotencyKey, 256)
    },
    body: JSON.stringify({
      from: cleanText(env.CONTACT_FROM_EMAIL, 254),
      to: [email.to],
      reply_to: email.replyTo,
      subject: email.subject,
      text: email.text,
      html: email.html
    })
  });

  if (!response.ok) {
    const error = new Error('Resend could not send the Ready to Collect email.');
    error.code = `RESEND_${response.status}`;
    throw error;
  }
  const body = await response.json().catch(() => ({}));
  return { id: cleanText(body.id, 160) };
}
