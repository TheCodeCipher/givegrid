// ngo.js — the NGO dashboard.
// Three possible situations, decided by GET /api/ngos/me:
//   404           -> no NGO profile yet: show the registration form
//   PENDING etc.  -> show the status and wait for the admin
//   VERIFIED      -> show claims, needs and the "post a need" form

requireRole('NGO');

async function loadProfile() {
  const res = await api('GET', '/ngos/me');
  const profile = document.getElementById('profile');

  if (res.status === 404) {
    profile.innerHTML = '<p class="muted">You have not registered your NGO yet.</p>';
    document.getElementById('ngo-form').classList.remove('hidden');
    return;
  }
  if (!res.ok) return showError('profile', res.data.error);

  const ngo = res.data;
  profile.innerHTML = `<p><strong>${esc(ngo.name)}</strong> — ${esc(ngo.city)} ${badge(ngo.status)}</p>`;

  if (ngo.status === 'PENDING') {
    profile.innerHTML += '<p class="notice">Waiting for an administrator to verify your NGO.</p>';
  } else if (ngo.status === 'REJECTED') {
    profile.innerHTML += '<p class="error">Your NGO was rejected. Contact the administrator.</p>';
  } else {
    document.getElementById('verified-area').classList.remove('hidden');
    loadCategories('category');
    loadClaims();
    loadNeeds();
  }
}

async function loadNeeds() {
  showLoading('needs');
  const res = await api('GET', '/needs?mine=true');
  if (!res.ok) return showError('needs', res.data.error);

  showTable('needs', res.data,
    ['Need', 'Still needed / Asked', 'Urgency', ''],
    (n) => [
      esc(n.title),
      `${n.remaining_quantity} / ${n.quantity_required} ${esc(n.unit)}`,
      badge(n.urgency),
      n.remaining_quantity > 0 ? `<a href="matches.html?need=${n.id}">Find donations</a>` : 'Fully covered',
    ],
    'No needs yet. Use the form below to tell donors what you need.');
}

// Which buttons a claim gets depends on its status (as the server reports it).
// The server checks again anyway, so an out-of-date button just gets an error message.
function buttonsFor(claim) {
  const buttons = [];
  if (claim.status === 'HELD') buttons.push(['confirm', 'Confirm pickup plan']);
  if (claim.status === 'HELD' || claim.status === 'CONFIRMED') buttons.push(['cancel', 'Cancel']);
  if (claim.status === 'PICKED_UP') buttons.push(['deliver', 'Mark delivered']);
  if (claim.status === 'DELIVERED') buttons.push(['receipt', 'Confirm receipt']);
  return buttons.map(([step, label]) => `<button onclick="changeClaim(${claim.id}, '${step}')">${label}</button>`).join(' ');
}

async function loadClaims() {
  showLoading('claims');
  const res = await api('GET', '/claims');
  if (!res.ok) return showError('claims', res.data.error);

  showTable('claims', res.data,
    ['Donation', 'For need', 'Quantity', 'Status', ''],
    (c) => [
      `<a href="donation.html?id=${c.donation_id}">${esc(c.donation_title)}</a>`,
      esc(c.need_title),
      `${c.quantity} ${esc(c.unit)}`,
      badge(c.status) + (c.status === 'HELD' ? `<br><span class="muted">confirm before ${formatDate(c.expires_at)}</span>` : ''),
      buttonsFor(c),
    ],
    'No claims yet. Open one of your needs and find donations.');
}

async function changeClaim(claimId, step) {
  const res = await api('POST', `/claims/${claimId}/${step}`);
  showMessage('claim-message', res.ok ? `Done: claim is now ${res.data.status}.` : res.data.error, res.ok ? 'success' : 'error');
  loadClaims();
  loadNeeds();                                  // cancelling changes "still needed"
}

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
  showMessage('need-message', 'Need posted.', 'success');
  event.target.reset();
  loadNeeds();
});

loadProfile();
