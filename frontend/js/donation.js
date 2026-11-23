// donation.js — one donation: details, history (timeline), and owner tools.
// Any logged-in user can open this page.

const user = getUser();
if (!user) {
  window.location.href = 'login.html';
} else {
  document.getElementById('who').textContent = `${user.name}, ${ROLE_NAMES[user.role]}`;
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
    <div class="page-head"><h1>${esc(d.title)}</h1>${badge(d.status)}</div>
    <div class="card">
      <p class="stock"><strong>${d.available_quantity}</strong> of ${d.total_quantity} ${esc(d.unit)} still available</p>
      <progress value="${d.total_quantity - d.available_quantity}" max="${d.total_quantity}"></progress>
      <p>${esc(d.description) || '<span class="muted">No description.</span>'}</p>
      <p class="muted">${esc(d.category_name)}, in ${esc(d.city)}. Donated by ${esc(d.donor_name)}.</p>
    </div>`;

  // The owner sees the edit form and the best NGOs for this donation.
  if (user.role === 'DONOR' && user.id === d.donor_id) {
    document.getElementById('owner-area').classList.remove('hidden');
    // Only once: the first time the details load, turn on the owner's tabs.
    const tabs = document.getElementById('donation-tabs');
    if (tabs.classList.contains('hidden')) {
      tabs.classList.remove('hidden');
      document.body.classList.add('owner');       // CSS hides the "History" heading (the tab says it)
      setupTabs();
    }
    document.getElementById('edit-title').value = d.title;
    document.getElementById('edit-description').value = d.description || '';
    document.getElementById('close-button').classList.toggle('hidden', d.status === 'CLOSED');
    loadBestNeeds();
  }
}

async function loadHistory() {
  showLoading('history-list');
  const res = await api('GET', `/donations/${donationId}/events`);
  if (!res.ok) return showError('history-list', res.data.error);

  showTable('history-list', res.data,
    ['#', 'What happened', 'Quantity', 'By', 'When'],
    (e) => [e.seq, LABELS[e.action] || e.action, e.quantity === null ? '' : e.quantity,
      esc(e.actor_name || 'GiveGrid (automatic)'), formatDate(e.created_at)],
    'No history yet.');
}

async function loadBestNeeds() {
  showLoading('best-needs');
  const res = await api('GET', `/donations/${donationId}/matching-needs`);
  if (!res.ok) return showError('best-needs', res.data.error);

  showTable('best-needs', res.data,
    ['Match score (out of 80)', 'Urgency', 'NGO', 'Need', 'Still needed', 'Where'],
    (n) => [`<strong>${n.score}</strong>`, badge(n.urgency), esc(n.ngo_name), esc(n.title),
      `${n.remaining_quantity} ${esc(n.unit)}`, esc(n.city)],
    'No verified NGO needs this yet.');
}

document.getElementById('edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const res = await api('PATCH', `/donations/${donationId}`, formData(event.target));
  if (res.ok) {
    showMessage('edit-message', '', '');
    toast('Changes saved.', 'success');
  } else {
    showMessage('edit-message', res.data.error, 'error');
  }
  loadDetails();
});

document.getElementById('close-button').addEventListener('click', async () => {
  if (!confirm('Stop new claims on this donation? Claims already made carry on normally.')) {
    return;
  }
  const res = await api('POST', `/donations/${donationId}/close`);
  toast(res.ok ? 'New claims stopped. Existing claims continue normally.' : res.data.error, res.ok ? 'success' : 'error');
  loadDetails();
  loadHistory();
});

if (user) {
  loadDetails();
  loadHistory();
}
