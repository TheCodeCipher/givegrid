// donor.js — the donor dashboard.

requireRole('DONOR');
setupTabs();

let claims = [];          // the claims on my donations, as the server last sent them
let filter = null;        // which group of handovers is shown: 'turn', 'waiting', 'done' or 'all'

async function loadDonations() {
  showLoading('donations-list');
  const res = await api('GET', '/donations?mine=true&limit=100');
  if (!res.ok) return showError('donations-list', res.data.error);

  // Overview numbers, worked out from the list the server sent.
  let openListings = 0;
  let itemsLeft = 0;
  for (const d of res.data) {
    if (d.status === 'OPEN') {
      openListings = openListings + 1;
      itemsLeft = itemsLeft + d.available_quantity;
    }
  }
  document.getElementById('stat-open').textContent = openListings;
  document.getElementById('stat-items').textContent = itemsLeft;

  showTable('donations-list', res.data,
    ['Item', 'Claimed so far', 'Status', ''],
    (d) => [
      `<strong>${esc(d.title)}</strong><span class="muted">${esc(d.category_name)}, ${esc(d.city)}</span>`,
      // The bar fills up as NGOs claim items.
      `<progress value="${d.total_quantity - d.available_quantity}" max="${d.total_quantity}"></progress>
       <span class="muted">${d.available_quantity} of ${d.total_quantity} ${esc(d.unit)} still free</span>`,
      badge(d.status),
      `<a class="button button-small button-quiet" href="donation.html?id=${d.id}">Details</a>`,
    ],
    'You have not listed anything yet. Use “List an item” to add your first donation.');
}

// ---------- Handovers (claims on my donations) ----------
async function loadClaims() {
  showLoading('claims-list');
  const res = await api('GET', '/claims');
  if (!res.ok) return showError('claims-list', res.data.error);
  claims = res.data;

  if (filter === null) {        // first time: open on "Your turn" if something is waiting
    filter = claims.some((c) => claimGroup(c, 'DONOR') === 'turn') ? 'turn' : 'all';
  }
  const turn = claims.filter((c) => claimGroup(c, 'DONOR') === 'turn').length;
  document.getElementById('stat-turn').textContent = turn;
  document.getElementById('stat-waiting').textContent = claims.filter((c) => claimGroup(c, 'DONOR') === 'waiting').length;
  setCount('claims-count', turn);
  showClaims();
}

// Draws the handovers of the chosen group, from the list we already have.
function showClaims() {
  updateChips(claims, 'DONOR', filter);
  const shown = filter === 'all' ? claims : claims.filter((c) => claimGroup(c, 'DONOR') === filter);
  const emptyText = {
    turn: 'No pickups to record right now.',
    waiting: 'No claims in progress.',
    done: 'No finished handovers yet.',
    all: 'No NGO has claimed your donations yet.',
  };

  showTable('claims-list', shown,
    ['Donation', 'NGO', 'Quantity', 'Progress', ''],
    (c) => [
      `<a href="donation.html?id=${c.donation_id}">${esc(c.donation_title)}</a>`,
      esc(c.ngo_name),
      `${c.quantity} ${esc(c.unit)}`,
      `${claimTracker(c)}<span class="next">${esc(nextStep(c, 'DONOR'))}</span>`,
      // The button only appears when the SERVER says the claim is CONFIRMED.
      c.status === 'CONFIRMED' ? `<button class="button-small" onclick="recordPickup(${c.id}, this)">Record pickup</button>` : '',
    ],
    emptyText[filter]);
}

function setFilter(group) {
  filter = group;
  showClaims();
}

// A stat card was pressed: open the handovers tab with that group chosen.
function openClaims(group) {
  showTab('claims');
  setFilter(group);
}

async function recordPickup(claimId, button) {
  button.disabled = true;                        // no double clicks while we wait
  const res = await api('POST', `/claims/${claimId}/pickup`);
  toast(res.ok ? 'Pickup recorded. The NGO will confirm delivery and receipt.' : res.data.error, res.ok ? 'success' : 'error');
  await loadClaims();                            // always show what the server now says
}

// ---------- What NGOs need ----------
async function loadNeeds() {
  showLoading('needs-list');
  const res = await api('GET', '/needs');
  if (!res.ok) return showError('needs-list', res.data.error);

  showTable('needs-list', res.data,
    ['Urgency', 'Need', 'NGO', 'Still needed', 'Where'],
    (n) => [badge(n.urgency), `<strong>${esc(n.title)}</strong><span class="muted">${esc(n.category_name)}</span>`,
      esc(n.ngo_name), `${n.remaining_quantity} ${esc(n.unit)}`, esc(n.city)],
    'No open needs right now.');
}

document.getElementById('donation-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = formData(event.target);
  // Form inputs are always text. The server wants real numbers.
  data.category_id = Number(data.category_id);
  data.total_quantity = Number(data.total_quantity);

  const res = await api('POST', '/donations', data);
  if (!res.ok) return showMessage('form-message', res.data.error, 'error');

  showMessage('form-message', '', '');
  event.target.reset();
  await loadDonations();
  showTab('donations');                          // show the new donation in the list
  toast('Donation listed. Open “Details” to see which NGOs need it most.', 'success');
});

loadCategories('category');
loadClaims();
loadDonations();
loadNeeds();
