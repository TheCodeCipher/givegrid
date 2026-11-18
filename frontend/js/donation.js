// donation.js — one donation: details, history (timeline), and owner tools.
// Any logged-in user can open this page.

const user = getUser();
if (!user) {
  window.location.href = 'index.html';
} else {
  document.getElementById('who').textContent = `${user.name} (${user.role})`;
  document.getElementById('logout').addEventListener('click', logout);
  document.getElementById('back').href = homePageFor(user.role);
}

const donationId = Number(getParam('id'));    // from donation.html?id=5

// Plain-English names for the history entries.
const LABELS = {
  DONATION_POSTED: 'Donation listed',
  DONATION_CLOSED: 'Closed to new claims',
  CLAIM_HELD: 'Claimed: held for 48 hours',
  HOLD_CONFIRMED: 'Pickup plan confirmed',
  HOLD_EXPIRED: 'Hold expired: items released',
  CLAIM_CANCELLED: 'Claim cancelled: items released',
  PICKED_UP: 'Picked up from the donor',
  DELIVERED: 'Delivered to the NGO',
  RECEIPT_CONFIRMED: 'Receipt confirmed by the NGO',
};

async function loadDetails() {
  const res = await api('GET', `/donations/${donationId}`);
  if (!res.ok) return showError('details', res.data.error);
  const d = res.data;

  document.getElementById('details').innerHTML = `
    <h1>${esc(d.title)} ${badge(d.status)}</h1>
    <p class="stock"><strong>${d.available_quantity}</strong> of ${d.total_quantity} ${esc(d.unit)} available</p>
    <p>${esc(d.description) || '<span class="muted">No description.</span>'}</p>
    <p class="muted">${esc(d.category_name)} · ${esc(d.city)} · donated by ${esc(d.donor_name)}</p>`;

  // The owner sees the edit form and the best NGOs for this donation.
  if (user.role === 'DONOR' && user.id === d.donor_id) {
    document.getElementById('owner-area').classList.remove('hidden');
    document.getElementById('edit-title').value = d.title;
    document.getElementById('edit-description').value = d.description || '';
    document.getElementById('close-button').classList.toggle('hidden', d.status === 'CLOSED');
    loadBestNeeds();
  }
}

async function loadHistory() {
  showLoading('history');
  const res = await api('GET', `/donations/${donationId}/events`);
  if (!res.ok) return showError('history', res.data.error);

  showTable('history', res.data,
    ['#', 'What happened', 'Quantity', 'By', 'When'],
    (e) => [e.seq, LABELS[e.action] || e.action, e.quantity === null ? '' : e.quantity,
      esc(e.actor_name || 'GiveGrid (automatic)'), formatDate(e.created_at)],
    'No history yet.');
}

async function loadBestNeeds() {
  showLoading('best-needs');
  const res = await api('GET', `/donations/${donationId}/matching-needs`);
  if (!res.ok) return showError('best-needs', res.data.error);

  showTable('best-needs', res.data.slice(0, 10),
    ['Score', 'Urgency', 'NGO', 'Need', 'Still needed', 'Where'],
    (n) => [`<strong>${n.score}</strong>`, badge(n.urgency), esc(n.ngo_name), esc(n.title),
      `${n.remaining_quantity} ${esc(n.unit)}`, esc(n.city)],
    'No verified NGO needs this yet.');
}

document.getElementById('edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const res = await api('PATCH', `/donations/${donationId}`, formData(event.target));
  showMessage('edit-message', res.ok ? 'Saved.' : res.data.error, res.ok ? 'success' : 'error');
  loadDetails();
});

document.getElementById('close-button').addEventListener('click', async () => {
  const res = await api('POST', `/donations/${donationId}/close`);
  showMessage('edit-message', res.ok ? 'Closed. Existing claims continue normally.' : res.data.error, res.ok ? 'success' : 'error');
  loadDetails();
  loadHistory();
});

if (user) {
  loadDetails();
  loadHistory();
}
