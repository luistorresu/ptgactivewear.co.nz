const MAX_EMAIL_LENGTH = 254;

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders
  });
}

function cleanText(value, maxLength = MAX_EMAIL_LENGTH) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function validatePayload(payload) {
  const website = cleanText(payload.website, 200);
  if (website) return { error: 'Invalid submission.' };

  const email = cleanText(payload.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'A valid email is required.' };
  }

  return { email };
}

function buildEmail({ email }, toEmail) {
  const subject = 'PTG Activewear newsletter signup';
  const text = [
    'New newsletter subscription from ptgactivewear.co.nz',
    '',
    `Subscriber email: ${email}`,
    'Website source: ptgactivewear.co.nz newsletter form'
  ].join('\n');
  const html = `
    <h2>New PTG Activewear newsletter signup</h2>
    <p><strong>Subscriber email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Website source:</strong> ptgactivewear.co.nz newsletter form</p>
  `;

  return { subject, text, html, to: toEmail, replyTo: email };
}

async function sendWithResend(env, emailData) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.EMAIL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.CONTACT_FROM_EMAIL,
      to: [emailData.to],
      reply_to: emailData.replyTo,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend failed with ${response.status}: ${body}`);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: jsonHeaders });
}

export async function onRequestPost({ request, env }) {
  let payload;

  try {
    payload = await request.json();
  } catch (error) {
    return jsonResponse({ ok: false, error: 'Invalid JSON payload.' }, 400);
  }

  const validation = validatePayload(payload || {});
  if (validation.error) {
    return jsonResponse({ ok: false, error: validation.error }, 400);
  }

  const provider = String(env.EMAIL_PROVIDER || 'resend').toLowerCase();
  const toEmail = cleanText(env.CONTACT_TO_EMAIL);
  const fromEmail = cleanText(env.CONTACT_FROM_EMAIL);

  if (!toEmail || !fromEmail || !env.EMAIL_API_KEY) {
    return jsonResponse({ ok: false, error: 'Newsletter email service is not configured.' }, 503);
  }

  const emailData = buildEmail(validation, toEmail);

  try {
    if (provider === 'resend') {
      await sendWithResend({ ...env, CONTACT_FROM_EMAIL: fromEmail }, emailData);
    } else {
      return jsonResponse({ ok: false, error: `Unsupported email provider: ${provider}` }, 503);
    }
  } catch (error) {
    console.error('Newsletter signup send failed', error);
    return jsonResponse({ ok: false, error: 'Subscription could not be sent.' }, 502);
  }

  return jsonResponse({ ok: true });
}
