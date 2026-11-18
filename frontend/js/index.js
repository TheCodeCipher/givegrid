// index.js — the login / register page.

// If already logged in, go straight to your page.
const alreadyIn = getUser();
if (alreadyIn) {
  window.location.href = homePageFor(alreadyIn.role);
}

// Show whether the backend is up (GET /api/health).
async function checkServer() {
  const res = await api('GET', '/health');
  document.getElementById('server-status').textContent = res.ok
    ? 'Server status: running'
    : 'Server status: ' + res.data.error;
}

// Both forms work the same way: send the data, save the login, go to your page.
async function submitAuth(event, path, messageId) {
  event.preventDefault();                       // stop the browser reloading the page
  const button = event.target.querySelector('button');
  button.disabled = true;                       // no double clicks while we wait

  const res = await api('POST', path, formData(event.target));

  button.disabled = false;
  if (!res.ok) {
    showMessage(messageId, res.data.error, 'error');
    return;
  }
  saveLogin(res.data);
  window.location.href = homePageFor(res.data.user.role);
}

document.getElementById('login-form').addEventListener('submit', (e) => submitAuth(e, '/auth/login', 'login-message'));
document.getElementById('register-form').addEventListener('submit', (e) => submitAuth(e, '/auth/register', 'register-message'));

checkServer();
