const MAX_FIELD_LENGTHS = {
  name: 100,
  email: 254,
  message: 3000
};

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

function cleanText(value, maxLength = MAX_FIELD_LENGTHS.email) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanMessage(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, MAX_FIELD_LENGTHS.message);
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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateContactPayload(payload) {
  const website = cleanText(payload.website, 200);
  if (website) return { error: 'Invalid submission.' };

  const name = cleanText(payload.name, MAX_FIELD_LENGTHS.name);
  const email = cleanText(payload.email, MAX_FIELD_LENGTHS.email);
  const message = cleanMessage(payload.message);

  if (!name) return { error: 'Name is required.' };
  if (!isValidEmail(email)) return { error: 'A valid email is required.' };
  if (!message) return { error: 'Message is required.' };

  return { name, email, message };
}

function validateNewsletterPayload(payload) {
  const website = cleanText(payload.website, 200);
  if (website) return { error: 'Invalid submission.' };

  const email = cleanText(payload.email, MAX_FIELD_LENGTHS.email);
  if (!isValidEmail(email)) return { error: 'A valid email is required.' };

  return { email };
}

function buildContactEmail({ name, email, message }, toEmail) {
  const subject = `PTG Activewear contact form message from ${name}`;
  const text = [
    'New message from ptgactivewear.co.nz contact form',
    '',
    `Sender name: ${name}`,
    `Sender email: ${email}`,
    'Website source: ptgactivewear.co.nz contact form',
    '',
    'Message:',
    message
  ].join('\n');
  const html = `
    <h2>New PTG Activewear contact message</h2>
    <p><strong>Sender name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Sender email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Website source:</strong> ptgactivewear.co.nz contact form</p>
    <hr>
    <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
  `;

  return { subject, text, html, to: toEmail, replyTo: email };
}

function buildNewsletterEmail({ email }, toEmail) {
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

async function readJson(request) {
  try {
    return await request.json();
  } catch (error) {
    return null;
  }
}

async function handleEmailRequest(request, env, type) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: jsonHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  }

  const payload = await readJson(request);
  if (!payload) {
    return jsonResponse({ ok: false, error: 'Invalid JSON payload.' }, 400);
  }

  const validation = type === 'contact'
    ? validateContactPayload(payload)
    : validateNewsletterPayload(payload);

  if (validation.error) {
    return jsonResponse({ ok: false, error: validation.error }, 400);
  }

  const provider = String(env.EMAIL_PROVIDER || 'resend').toLowerCase();
  const toEmail = cleanText(env.CONTACT_TO_EMAIL, MAX_FIELD_LENGTHS.email);
  const fromEmail = cleanText(env.CONTACT_FROM_EMAIL, MAX_FIELD_LENGTHS.email);

  if (!toEmail || !fromEmail || !env.EMAIL_API_KEY) {
    return jsonResponse({ ok: false, error: 'Email service is not configured.' }, 503);
  }

  const emailData = type === 'contact'
    ? buildContactEmail(validation, toEmail)
    : buildNewsletterEmail(validation, toEmail);

  try {
    if (provider === 'resend') {
      await sendWithResend({ ...env, CONTACT_FROM_EMAIL: fromEmail }, emailData);
    } else {
      return jsonResponse({ ok: false, error: `Unsupported email provider: ${provider}` }, 503);
    }
  } catch (error) {
    console.error(`${type} email send failed`, error);
    return jsonResponse({ ok: false, error: 'Email could not be sent.' }, 502);
  }

  return jsonResponse({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/contact') {
      return handleEmailRequest(request, env, 'contact');
    }

    if (url.pathname === '/api/newsletter') {
      return handleEmailRequest(request, env, 'newsletter');
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status === 500) {
      return new Response('Not found', { status: 404 });
    }

    return assetResponse;
  }
};
