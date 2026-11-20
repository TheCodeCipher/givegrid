// donor.js — the donor dashboard.

requireRole('DONOR');
setupTabs();

// The "List an item" button at the top opens the form tab.
document.getElementById('new-donation').addEventListener('click', () => showTab('new'));

async function loadDonations() {
  showLoading('donations');
  const res = await api('GET', '/donations?mine=true&limit=100');
  if (!res.ok) {
    document.getElementById('summary').textContent = '';
    return showError('donations', res.data.error);
  }

  // One-line summary at the top, worked out from the list the server sent.
  let unitsLeft = 0;
  for (const d of res.data) {
    if (d.status === 'OPEN') {
      unitsLeft = unitsLeft + d.available_quantity;
    }
  }
  document.getElementById('summary').textContent =
    `${plural(res.data.length, 'listing')}, ${plural(unitsLeft, 'item')} still available to claim.`;

  showTable('donations', res.data,
    ['Item', 'Category', 'Available', 'Status', ''],
    (d) => [
      `<strong>${esc(d.title)}</strong>`,
      esc(d.category_name),
      `${d.available_quantity} of ${d.total_quantity} ${esc(d.unit)}`,
      badge(d.status),
      `<a href="donation.html?id=${d.id}">Details and history</a>`,
    ],
    'You have not listed anything yet. Use “List an item” to add your first donation.');
}

async function loadClaims() {
  showLoading('claims');
  const res = await api('GET', '/claims');
  if (!res.ok) return showError('claims', res.data.error);

  // The number on the tab = claims waiting for the donor to record pickup.
  const waiting = res.data.filter((c) => c.status === 'CONFIRMED').length;
  setCount('claims-count', waiting);

  showTable('claims', res.data,
    ['Donation', 'NGO', 'Quantity', 'Status', ''],
    (c) => [
      esc(c.donation_title),
      esc(c.ngo_name),
      `${c.quantity} ${esc(c.unit)}`,
      badge(c.status),
      // The button only appears when the SERVER says the claim is CONFIRMED.
      c.status === 'CONFIRMED' ? `<button onclick="recordPickup(${c.id})">Record pickup</button>` : '',
    ],
    'No NGO has claimed your donations yet.');
}

async function recordPickup(claimId) {
  const res = await api('POST', `/claims/${claimId}/pickup`);
  showMessage('claim-message', res.ok ? 'Pickup recorded.' : res.data.error, res.ok ? 'success' : 'error');
  loadClaims();                                  // always show what the server now says
}

async function loadNeeds() {
  showLoading('needs');
  const res = await api('GET', '/needs');
  if (!res.ok) return showError('needs', res.data.error);

  showTable('needs', res.data,
    ['Urgency', 'Need', 'NGO', 'Still needed', 'Where'],
    (n) => [badge(n.urgency), esc(n.title), esc(n.ngo_name), `${n.remaining_quantity} ${esc(n.unit)}`, esc(n.city)],
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
});

loadCategories('category');
loadClaims();
loadDonations();
loadNeeds();
