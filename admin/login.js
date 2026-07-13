const form = document.getElementById('login-form');
const email = document.getElementById('email');
const code = document.getElementById('code');
const codeField = document.getElementById('code-field');
const submit = document.getElementById('login-submit');
const status = document.getElementById('login-status');
let codeRequested = false;

function showStatus(type, message) {
  status.textContent = message;
  status.className = `status status-${type}`;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  submit.disabled = true;
  submit.textContent = codeRequested ? 'Signing in...' : 'Sending code...';
  try {
    const endpoint = codeRequested ? 'verify-code' : 'request-code';
    const response = await fetch(`/api/admin-auth/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value, code: code.value }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Sign in could not be completed.');
    if (codeRequested) { window.location.assign('/admin'); return; }
    codeRequested = true;
    email.readOnly = true;
    codeField.hidden = false;
    code.required = true;
    code.focus();
    submit.textContent = 'Sign in';
    showStatus('success', 'Code sent. Check your inbox and enter it below.');
  } catch (error) {
    showStatus('error', error.message);
  } finally {
    submit.disabled = false;
    if (!codeRequested) submit.textContent = 'Send sign-in code';
    else if (submit.textContent === 'Signing in...') submit.textContent = 'Sign in';
  }
});
