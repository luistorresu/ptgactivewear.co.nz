const form = document.querySelector('[data-login-form]');
const button = document.querySelector('[data-login-button]');
const notice = document.querySelector('[data-login-notice]');

function showNotice(message, type = 'error') {
  notice.textContent = message;
  notice.className = `notice notice-${type}`;
  notice.hidden = false;
}

async function checkExistingSession() {
  const response = await fetch('/api/admin/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (response.ok) window.location.replace('/admin');
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled) return;
  if (!form.reportValidity()) return;
  button.disabled = true;
  button.textContent = 'Logging in...';
  notice.hidden = true;
  const values = new FormData(form);
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: values.get('username'), password: values.get('password') })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Login could not be completed.');
    window.location.replace('/admin');
  } catch (error) {
    showNotice(error.message || 'Login could not be completed.');
    button.disabled = false;
    button.textContent = 'Log In';
  }
});

checkExistingSession().catch(() => {});
