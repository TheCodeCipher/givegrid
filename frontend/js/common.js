// =====================================================================
// common.js — helpers that EVERY page uses. Loaded before the page's own script.
// =====================================================================
// Sections:
//   1. login storage      (saveLogin, getUser, logout, requireRole)
//   2. api()              (the ONE function that talks to the backend)
//   3. showing things     (loading / error / empty / table, messages)
//   4. small helpers      (esc, formData, getParam, formatDate, badge)
// =====================================================================


// ---------- 1. Login storage ----------------------------------------
// After login the server gives us a token. We keep it in localStorage
// (the browser's small storage that survives page reloads).

function saveLogin(data) {
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));   // objects must be stored as text
}

function getUser() {
  const text = localStorage.getItem('user');
  return text ? JSON.parse(text) : null;                     // text back into an object
}

function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}

// Each page calls this first. Wrong person -> back to the login page.
// This only decides what to SHOW. The server checks every request again,
// so hiding a page here is not the security, the backend is.
function requireRole(role) {
  const user = getUser();
  if (!user || user.role !== role) {
    window.location.href = 'index.html';
    return null;
  }
  document.getElementById('who').textContent = `${user.name} (${user.role})`;
  document.getElementById('logout').addEventListener('click', logout);
  return user;
}

// Where each kind of account lands after logging in.
function homePageFor(role) {
  if (role === 'DONOR') return 'donor.html';
  if (role === 'NGO') return 'ngo.html';
  return 'admin.html';
}


// ---------- 2. api(): talk to the backend ---------------------------
// api('GET', '/needs')   or   api('POST', '/donations', { ...data })
// Always gives back { ok, status, data } and never throws, so pages can
// just check "if (!res.ok)". The frontend and API share one server, so
// the address is simply /api/...
async function api(method, path, body) {
  const options = { method: method, headers: { 'Content-Type': 'application/json' } };

  const token = localStorage.getItem('token');
  if (token) {
    options.headers.Authorization = 'Bearer ' + token;      // prove who we are
  }
  if (body) {
    options.body = JSON.stringify(body);                     // object -> JSON text
  }

  try {
    const response = await fetch('/api' + path, options);
    const data = await response.json();                      // JSON text -> object
    if (response.status === 401 && token) {                  // login expired: start again
      logout();
    }
    return { ok: response.ok, status: response.status, data: data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: 'Cannot reach the server. Is it running?' } };
  }
}


// ---------- 3. Showing things: loading, error, empty, table ----------
// The course marks "conditional rendering": every list must show a
// loading state, an error state, and an empty state.

function showLoading(boxId) {
  document.getElementById(boxId).innerHTML = '<p class="muted">Loading…</p>';
}

function showError(boxId, message) {
  document.getElementById(boxId).innerHTML = `<p class="error">${esc(message)}</p>`;
}

// items     = array from the server
// headings  = column titles, e.g. ['Item', 'Quantity']
// makeCells = function that turns ONE item into an array of cell HTML
// emptyText = what to show if there are no items
function showTable(boxId, items, headings, makeCells, emptyText) {
  const box = document.getElementById(boxId);
  if (items.length === 0) {
    box.innerHTML = `<p class="empty">${esc(emptyText)}</p>`;
    return;
  }
  const head = headings.map((h) => `<th>${h}</th>`).join('');
  const rows = items.map((item) => {
    const cells = makeCells(item).map((cell) => `<td>${cell}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  box.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

// A message under a form. type: 'error' or 'success'.
function showMessage(boxId, text, type) {
  const box = document.getElementById(boxId);
  box.textContent = text;
  box.className = type;
}


// ---------- 4. Small helpers ----------------------------------------

// esc(): makes text safe to put inside HTML. Without it, a donation titled
// "<script>...</script>" would RUN in other people's browsers (an XSS attack).
function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// All the inputs of a form as one object: { title: '...', city: '...' }.
// Each input's name="" attribute becomes the key.
function formData(form) {
  return Object.fromEntries(new FormData(form));
}

// Reads ?id=5 from the address bar: getParam('id') -> "5"
function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

// A coloured label for statuses like HELD, VERIFIED, HIGH.
function badge(text) {
  return `<span class="badge badge-${esc(text).toLowerCase()}">${esc(text)}</span>`;
}

// Fills a <select> with the categories from the server.
async function loadCategories(selectId) {
  const res = await api('GET', '/categories');
  const select = document.getElementById(selectId);
  if (!res.ok) {
    select.innerHTML = '<option value="">Could not load categories</option>';
    return;
  }
  select.innerHTML = '<option value="">Choose a category</option>' +
    res.data.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}
