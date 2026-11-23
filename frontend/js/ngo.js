// ngo.js — the NGO dashboard.
// Three possible situations, decided by GET /api/ngos/me:
//   404           -> no NGO profile yet: show the registration form
//   PENDING etc.  -> show the status and wait for the admin
//   VERIFIED      -> show the overview numbers and the tabs: claims, needs, post a need

requireRole('NGO');

let claims = [];          // the claims as the server last sent them
let needs = [];           // the needs as the server last sent them
let filter = null;        // which group of claims is shown: 'turn', 'waiting', 'done' or 'all'

// The onboarding steps at the top. "reached" = how many steps are done (0, 1 or 2).
function showOnboarding(reached) {
  const ids = ['step-register', 'step-verify', 'step-start'];
  ids.forEach((id, i) => {
    const step = document.getElementById(id);
    step.className = i < reached ? 'done' : (i === reached ? 'current' : '');
  });
  document.getElementById('onboarding').classList.remove('hidden');
}

async function loadProfile() {
  const res = await api('GET', '/ngos/me');
  const profile = document.getElementById('profile');

  if (res.status === 404) {
    profile.textContent = 'Start by registering your NGO.';
    showOnboarding(0);
    document.getElementById('ngo-form').classList.remove('hidden');
    return;
  }
  if (!res.ok) {
    profile.innerHTML = `<span class="error">${esc(res.data.error)}</span>`;
    return;
  }

  const ngo = res.data;
  document.getElementById('ngo-name').textContent = ngo.name;
  profile.innerHTML = `${esc(ngo.city)} ${badge(ngo.status)}`;

  if (ngo.status === 'PENDING') {
    showOnboarding(1);
    profile.innerHTML += '<p class="notice">An administrator is checking your NGO. You can post needs and claim donations once it is verified.</p>';
  } else if (ngo.status === 'REJECTED') {
    profile.innerHTML += '<p class="error">Your NGO was not verified. Contact the administrator.</p>';
  } else {
    document.getElementById('verified-area').classList.remove('hidden');
    document.getElementById('post-need-top').classList.remove('hidden');
    setupTabs();
    loadCategories('category');
    loadClaims();
    loadNeeds();
  }
}

// ---------- Overview numbers ----------
function showStats() {
  const turn = claims.filter((c) => claimGroup(c, 'NGO') === 'turn').length;
  document.getElementById('stat-turn').textContent = turn;
  document.getElementById('stat-waiting').textContent = claims.filter((c) => claimGroup(c, 'NGO') === 'waiting').length;
  document.getElementById('stat-done').textContent = claims.filter((c) => claimGroup(c, 'NGO') === 'done').length;
  document.getElementById('stat-needs').textContent = needs.filter((n) => n.remaining_quantity > 0).length;
  setCount('claims-count', turn);               // the number on the "My claims" tab
}

// A stat card was pressed: open the claims tab with that group chosen.
function openClaims(group) {
  showTab('claims');
  setFilter(group);
}

// ---------- My needs ----------
async function loadNeeds() {
  showLoading('needs-list');
  const res = await api('GET', '/needs?mine=true');
  if (!res.ok) return showError('needs-list', res.data.error);
  needs = res.data;
  showStats();

  showTable('needs-list', needs,
    ['Need', 'Progress', 'Urgency', ''],
    (n) => {
      const received = n.quantity_required - n.remaining_quantity;
      return [
        `<strong>${esc(n.title)}</strong><span class="muted">${esc(n.category_name)}, ${esc(n.city)}</span>`,
        // <progress> draws a bar: how much of the need is already covered by claims.
        `<progress value="${received}" max="${n.quantity_required}"></progress>
         <span class="muted">${n.remaining_quantity} of ${n.quantity_required} ${esc(n.unit)} still needed</span>`,
        badge(n.urgency),
        n.remaining_quantity > 0
          ? `<a class="button button-small" href="matches.html?need=${n.id}">Find donations</a>`
          : badge('COVERED'),
      ];
    },
    'No needs yet. Use “Post a need” to tell donors what you are short of.');
}

// ---------- My claims ----------
// Which buttons a claim gets depends on its status (as the server reports it).
// The server checks again anyway, so an out-of-date button just gets an error message.
function buttonsFor(claim) {
  const buttons = [];
  if (claim.status === 'HELD') buttons.push(['confirm', 'Confirm pickup plan']);
  if (claim.status === 'PICKED_UP') buttons.push(['deliver', 'Mark delivered']);
  if (claim.status === 'DELIVERED') buttons.push(['receipt', 'Confirm receipt']);
  if (claim.status === 'HELD' || claim.status === 'CONFIRMED') buttons.push(['cancel', 'Cancel']);
  // "this" = the button itself, so changeClaim can switch it off while it waits.
  return buttons.map(([step, label]) => {
    const style = step === 'cancel' ? 'button-small danger' : 'button-small';
    return `<button class="${style}" onclick="changeClaim(${claim.id}, '${step}', this)">${label}</button>`;
  }).join(' ');
}

async function loadClaims() {
  showLoading('claims-list');
  const res = await api('GET', '/claims');
  if (!res.ok) return showError('claims-list', res.data.error);
  claims = res.data;

  // First time: open on "Your turn" if something is waiting, otherwise on "All".
  if (filter === null) {
    filter = claims.some((c) => claimGroup(c, 'NGO') === 'turn') ? 'turn' : 'all';
  }
  showStats();
  showClaims();
}

// Draws the claims of the chosen group. No request to the server: it filters
// the list we already have, so switching groups is instant.
function showClaims() {
  updateChips(claims, 'NGO', filter);
  const shown = filter === 'all' ? claims : claims.filter((c) => claimGroup(c, 'NGO') === filter);
  const emptyText = {
    turn: 'Nothing is waiting for you right now.',
    waiting: 'No claims are waiting for a donor.',
    done: 'No finished claims yet.',
    all: 'No claims yet. Go to “My needs” and press “Find donations”.',
  };

  showTable('claims-list', shown,
    ['Donation', 'Quantity', 'Progress', ''],
    (c) => [
      `<a href="donation.html?id=${c.donation_id}">${esc(c.donation_title)}</a>
       <span class="muted">for: ${esc(c.need_title)}</span>`,
      `${c.quantity} ${esc(c.unit)}`,
      `${claimTracker(c)}<span class="next">${esc(nextStep(c, 'NGO'))}</span>`,
      `<div class="actions">${buttonsFor(c)}</div>`,
    ],
    emptyText[filter]);
}

function setFilter(group) {
  filter = group;
  showClaims();
}

// What to say after each button worked.
const DONE_TEXT = {
  confirm: 'Pickup plan confirmed. Next, the donor records the pickup.',
  cancel: 'Claim cancelled. The items went back to the donation.',
  deliver: 'Marked as delivered. Last step: confirm receipt.',
  receipt: 'Receipt confirmed. This claim is finished.',
};

async function changeClaim(claimId, step, button) {
  if (step === 'cancel' && !confirm('Cancel this claim? The items go back to the donation for other NGOs.')) {
    return;                                     // the user pressed "Cancel" in the question box
  }
  button.disabled = true;                       // no double clicks while we wait
  const res = await api('POST', `/claims/${claimId}/${step}`);
  toast(res.ok ? DONE_TEXT[step] : res.data.error, res.ok ? 'success' : 'error');
  await loadClaims();                           // always show what the server now says
  loadNeeds();                                  // cancelling changes "still needed"
}

// ---------- Forms ----------
document.getElementById('ngo-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const res = await api('POST', '/ngos', formData(event.target));
  if (!res.ok) return showMessage('ngo-message', res.data.error, 'error');
  document.getElementById('ngo-form').classList.add('hidden');
  loadProfile();
});

document.getElementById('need-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = formData(event.target);
  data.category_id = Number(data.category_id);
  data.quantity_required = Number(data.quantity_required);

  const res = await api('POST', '/needs', data);
  if (!res.ok) return showMessage('need-message', res.data.error, 'error');
  showMessage('need-message', '', '');
  event.target.reset();
  await loadNeeds();
  showTab('needs');                             // show the new need in the list
  toast('Need posted. Press “Find donations” next to it to claim items.', 'success');
});

loadProfile();
