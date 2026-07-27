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

function firstName(value) {
  return cleanText(value, 200).split(/\s+/)[0] || 'there';
}

export function deliveryEmailConfigured(env) {
  const provider = cleanText(env.EMAIL_PROVIDER || 'resend', 30).toLowerCase();
  return provider === 'resend' && validEmail(cleanText(env.CONTACT_FROM_EMAIL, 254)) && Boolean(env.EMAIL_API_KEY);
}

export function validateDeliveryAction(order, action) {
  if (!order) return { error: 'Order not found.', status: 404, code: 'ORDER_NOT_FOUND' };
  if (order.fulfilment_type !== 'delivery') {
    return { error: 'Delivery actions are available only for delivery orders.', status: 409, code: 'NOT_DELIVERY' };
  }
  if (order.payment_status !== 'paid') {
    return { error: 'The order must be paid before its delivery status can be changed.', status: 409, code: 'NOT_PAID' };
  }
  if (['cancelled', 'refunded'].includes(order.fulfilment_status)
    || ['fully_refunded', 'refunded'].includes(order.refund_status)
    || Number(order.refunded_cents || 0) >= Number(order.total_cents || 0)) {
    return { error: 'Cancelled or fully refunded orders cannot be dispatched or completed.', status: 409, code: 'ORDER_CLOSED' };
  }
  if (action !== 'completed' && !validEmail(order.customer_email)) {
    return { error: 'This order does not have a valid customer email address.', status: 409, code: 'MISSING_EMAIL' };
  }
  if (action === 'initial' && order.out_for_delivery_email_sent_at) {
    return { error: 'The Out for Delivery email has already been sent. Use Resend instead.', status: 409, code: 'ALREADY_SENT' };
  }
  if (action === 'resend' && !order.out_for_delivery_email_sent_at) {
    return { error: 'Send the first Out for Delivery email before using Resend.', status: 409, code: 'NOT_SENT' };
  }
  if (order.fulfilment_status === 'completed' && action !== 'completed') {
    return { error: 'This order has already been completed.', status: 409, code: 'ALREADY_COMPLETED' };
  }
  return { ok: true };
}

export function buildOutForDeliveryEmail(order, env) {
  const supportEmail = cleanText(env.CONTACT_TO_EMAIL, 254) || SUPPORT_EMAIL;
  const orderNumber = cleanText(order.order_number, 80) || 'PTG Activewear order';
  const greetingName = firstName(order.customer_name);
  const text = [
    `Hi ${greetingName},`,
    '',
    'Good news - your PTG Activewear order is now out for delivery.',
    '',
    'Order number:',
    orderNumber,
    '',
    'Please keep an eye out for your delivery. Delivery timing can vary depending on the courier and destination.',
    '',
    `If you have any questions, contact us at ${supportEmail}.`,
    '',
    'Thank you for your order.',
    '',
    'PTG Activewear'
  ].join('\n');

  const html = `<!doctype html>
  <html lang="en"><body style="margin:0;background:#f3f6f8;color:#101820;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f8;padding:24px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dbe1e7">
          <tr><td style="padding:22px 28px;background:#07090b;color:#ffffff;font-size:20px;font-weight:700">PTG Activewear</td></tr>
          <tr><td style="padding:30px 28px">
            <p style="margin:0 0 18px">Hi ${escapeHtml(greetingName)},</p>
            <h1 style="margin:0 0 14px;font-size:26px;line-height:1.2">Your order is out for delivery</h1>
            <p style="margin:0 0 24px;line-height:1.6">Good news - your PTG Activewear order is now out for delivery.</p>
            <div style="margin:0 0 22px"><strong style="display:block;color:#586574;font-size:12px;text-transform:uppercase">Order number</strong><span style="font-size:20px;font-weight:700">${escapeHtml(orderNumber)}</span></div>
            <p style="margin:0 0 20px;line-height:1.6">Please keep an eye out for your delivery. Delivery timing can vary depending on the courier and destination.</p>
            <p style="margin:0;line-height:1.6">If you have any questions, contact <a href="mailto:${escapeHtml(supportEmail)}" style="color:#087f9b">${escapeHtml(supportEmail)}</a>.<br><br>Thank you for your order.<br><strong>PTG Activewear</strong></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;

  return {
    to: cleanText(order.customer_email, 254),
    replyTo: supportEmail,
    subject: 'Your PTG Activewear order is out for delivery',
    text,
    html
  };
}

export async function sendOutForDeliveryEmail(env, email, idempotencyKey) {
  if (!deliveryEmailConfigured(env)) {
    const error = new Error('Out for Delivery email is not configured.');
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
    const error = new Error('Resend could not send the Out for Delivery email.');
    error.code = `RESEND_${response.status}`;
    throw error;
  }
  const body = await response.json().catch(() => ({}));
  return { id: cleanText(body.id, 160) };
}
