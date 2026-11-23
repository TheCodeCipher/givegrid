// =====================================================================
// common.js — helpers that EVERY page uses. Loaded before the page's own script.
// =====================================================================
// Sections:
//   1. login storage      (saveLogin, getUser, logout, requireRole)
//   2. api()              (the ONE function that talks to the backend)
//   3. showing things     (loading / error / empty / table, messages, toast)
//   4. small helpers      (esc, formData, getParam, formatDate, badge)
//   5. claims             (progress tracker, whose turn it is, filters)
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
    window.location.href = 'login.html';
    return null;
  }
  document.getElementById('who').textContent = `${user.name}, ${ROLE_NAMES[user.role]}`;
  document.getElementById('logout').addEventListener('click', logout);
  return user;
}

// Friendly names for the three account types.
const ROLE_NAMES = { DONOR: 'donor', NGO: 'NGO', ADMIN: 'administrator' };

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
// Conditional rendering: every list shows a loading state, an error state,
// and an empty state, so the user always knows what is happening.
//
// NO FLICKER: "Loading…" is shown only the FIRST time a box fills. When a
// list is refreshed (e.g. after pressing a button) the old rows stay on screen
// until the new ones arrive, so the page never shrinks and grows again.

function showLoading(boxId) {
  const box = document.getElementById(boxId);
  if (box.innerHTML.trim() === '') {
    box.innerHTML = '<p class="muted loading">Loading…</p>';
  }
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
  // Remember how far the list was scrolled, so a refresh doesn't jump back to the top.
  const oldScroll = box.querySelector('.table-scroll');
  const scrollTop = oldScroll ? oldScroll.scrollTop : 0;

  const head = headings.map((h) => `<th>${h}</th>`).join('');
  const rows = items.map((item) => {
    // data-label = the column name. On phones the CSS shows it above each value,
    // because the table turns into one small card per row.
    const cells = makeCells(item).map((cell, i) => `<td data-label="${headings[i]}">${cell}</td>`).join('');
    // data-id lets a page find a row again, e.g. to highlight the chosen donation.
    return `<tr data-id="${Number(item.id) || ''}">${cells}</tr>`;
  }).join('');
  // .table-scroll = a box with a fixed maximum height: long lists scroll INSIDE it
  // (with the column titles staying visible) instead of making the page very long.
  box.innerHTML = `<div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  box.querySelector('.table-scroll').scrollTop = scrollTop;
}

// A message under a form. type: 'error' or 'success'.
function showMessage(boxId, text, type) {
  const box = document.getElementById(boxId);
  box.textContent = text;
  box.className = type;
}

// A short message that floats in the corner for a few seconds ("toast").
// Used for the result of a button press. It floats OVER the page, so it
// never pushes the tables down (that was one cause of the flicker).
let toastTimer = null;
function toast(text, type) {
  let box = document.getElementById('toast');
  if (!box) {                                    // made once, the first time it's needed
    box = document.createElement('div');
    box.id = 'toast';
    box.setAttribute('role', 'status');          // screen readers read it out
    document.body.appendChild(box);
  }
  box.textContent = text;
  box.className = `toast ${type} show`;
  clearTimeout(toastTimer);                      // a new message restarts the timer
  toastTimer = setTimeout(() => box.classList.remove('show'), 5000);
}


// ---------- Tabs: show one section at a time --------------------------
// The page has buttons  <button class="tab" data-tab="needs">  and sections
// <section class="panel" data-panel="needs">. Clicking a tab shows the section
// with the same name and hides the others (instead of one very long page).
// The open tab is also written in the address (ngo.html#claims), so a link or
// a page reload opens the same tab.
function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
  });
  showTab(tabFromAddress() || tabs[0].dataset.tab);
  // If only the "#..." part of the address changes (a link on the same page,
  // or typing it), switch to that tab too.
  window.addEventListener('hashchange', () => {
    const name = tabFromAddress();
    if (name) showTab(name);
  });
}

// The tab named in the address ("ngo.html#claims" -> "claims"), if this page has it.
function tabFromAddress() {
  const name = window.location.hash.slice(1);
  const exists = document.querySelector(`.tab[data-tab="${CSS.escape(name)}"]`);
  return exists ? name : null;
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const isActive = tab.dataset.tab === name;
    tab.classList.toggle('active', isActive);   // underline the chosen tab
    tab.setAttribute('aria-selected', isActive); // tells screen readers which one is chosen
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.panel !== name);
  });
  history.replaceState(null, '', '#' + name);   // update the address without reloading
}

// Shows a number next to a tab name (e.g. "Claims 2"). 0 shows nothing.
function setCount(elementId, number) {
  document.getElementById(elementId).textContent = number > 0 ? number : '';
}

// "1 listing" / "3 listings"
function plural(number, word) {
  return `${number} ${word}${number === 1 ? '' : 's'}`;
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

// Short, readable date and time, e.g. "22 Nov, 7:29 pm".
function formatDate(value) {
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
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


// ---------- 5. Claims: where is it, and whose turn is it? -------------
// A claim moves through these five steps (the same order as rules.js STEPS).
const CLAIM_STEPS = ['HELD', 'CONFIRMED', 'PICKED_UP', 'DELIVERED', 'RECEIVED'];
const STEP_NAMES = { HELD: 'Claimed', CONFIRMED: 'Confirmed', PICKED_UP: 'Picked up', DELIVERED: 'Delivered', RECEIVED: 'Received' };

// Which statuses mean "it's YOUR turn to press something", per account type.
const YOUR_TURN = {
  NGO: ['HELD', 'PICKED_UP', 'DELIVERED'],
  DONOR: ['CONFIRMED'],
};
const FINISHED = ['RECEIVED', 'CANCELLED', 'EXPIRED'];

// Which group a claim belongs to, for the filter buttons above the list.
function claimGroup(claim, role) {
  if (YOUR_TURN[role].includes(claim.status)) return 'turn';
  if (FINISHED.includes(claim.status)) return 'done';
  return 'waiting';
}

// One plain sentence: what happens next, and who does it.
function nextStep(claim, role) {
  if (claim.status === 'CANCELLED') return 'Cancelled. The items went back to the donation.';
  if (claim.status === 'EXPIRED') return 'Not confirmed within 48 hours, so the items were released.';
  if (claim.status === 'RECEIVED') return 'Finished. The NGO confirmed it received the items.';

  const sentences = {
    NGO: {
      HELD: `Your turn: confirm your pickup plan (${timeLeft(claim.expires_at)}).`,
      CONFIRMED: 'Waiting for the donor to record the pickup.',
      PICKED_UP: 'Your turn: mark it delivered when it arrives.',
      DELIVERED: 'Your turn: confirm you received everything.',
    },
    DONOR: {
      HELD: `Waiting for the NGO to confirm a pickup plan (${timeLeft(claim.expires_at)}).`,
      CONFIRMED: 'Your turn: record the pickup when the NGO collects.',
      PICKED_UP: 'On its way to the NGO.',
      DELIVERED: 'Delivered. Waiting for the NGO to confirm receipt.',
    },
  };
  return sentences[role][claim.status];
}

// The progress tracker: five small steps, the finished ones filled in.
// Cancelled and expired claims stopped early, so they show a label instead.
function claimTracker(claim) {
  if (claim.status === 'CANCELLED' || claim.status === 'EXPIRED') {
    return badge(claim.status);
  }
  const reached = CLAIM_STEPS.indexOf(claim.status);       // 0 for HELD ... 4 for RECEIVED
  const steps = CLAIM_STEPS.map((step, i) => {
    let state = 'todo';
    if (i < reached) state = 'done';
    if (i === reached) state = 'current';
    return `<li class="${state}">${STEP_NAMES[step]}</li>`;
  }).join('');
  return `<ol class="tracker" aria-label="Claim progress">${steps}</ol>`;
}

// "31 h left" / "45 min left" until a hold expires. Only for display:
// the server decides when it has really expired.
function timeLeft(value) {
  const minutes = Math.round((new Date(value) - Date.now()) / 60000);
  if (minutes <= 0) return 'time is up';
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.floor(minutes / 60)} h left`;
}

// Fills in the numbers on the filter buttons and marks the chosen one.
// Each button looks like <button class="chip" data-filter="turn">Your turn <span>3</span></button>
function updateChips(claims, role, chosen) {
  const counts = { turn: 0, waiting: 0, done: 0, all: claims.length };
  for (const c of claims) {
    counts[claimGroup(c, role)] = counts[claimGroup(c, role)] + 1;
  }
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.querySelector('span').textContent = counts[chip.dataset.filter];
    chip.classList.toggle('active', chip.dataset.filter === chosen);
  });
  return counts;
}
