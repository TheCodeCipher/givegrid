// login.js — the log in / create account page.

// Already logged in? Go straight to your dashboard.
const alreadyIn = getUser();
if (alreadyIn) {
  window.location.href = homePageFor(alreadyIn.role);
}

// Two tabs: "Log in" and "Create an account".
setupTabs();

// Links like login.html?mode=register&role=NGO open the right tab with the right role chosen.
if (getParam('mode') === 'register') {
  showTab('register');
}
if (getParam('role') === 'NGO' || getParam('role') === 'DONOR') {
  document.getElementById('role').value = getParam('role');
}

// Both forms work the same way: send the data, save the login, go to your dashboard.
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
