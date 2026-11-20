// ngo.js — the NGO dashboard.
// Three possible situations, decided by GET /api/ngos/me:
//   404           -> no NGO profile yet: show the registration form
//   PENDING etc.  -> show the status and wait for the admin
//   VERIFIED      -> show the tabs: claims, needs, post a need

requireRole('NGO');

async function loadProfile() {
  const res = await api('GET', '/ngos/me');
  const profile = document.getElementById('profile');

  if (res.status === 404) {
    profile.textContent = 'You have not registered your NGO yet.';
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
    profile.innerHTML += '<p class="notice">An administrator is checking your NGO. You can post needs and claim donations once it is verified.</p>';
  } else if (ngo.status === 'REJECTED') {
    profile.innerHTML += '<p class="error">Your NGO was not verified. Contact the administrator.</p>';
  } else {
    document.getElementById('verified-area').classList.remove('hidden');
    setupTabs();
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
    ['Need', 'Still needed', 'Urgency', ''],
    (n) => [
      `<strong>${esc(n.title)}</strong>`,
      `${n.remaining_quantity} of ${n.quantity_required} ${esc(n.unit)}`,
      badge(n.urgency),
      n.remaining_quantity > 0 ? `<a href="matches.html?need=${n.id}">Find donations</a>` : 'Fully covered',
    ],
    'No needs yet. Use “Post a need” to tell donors what you are short of.');
}

// Which buttons a claim gets depends on its status (as the server reports it).
// The server checks again anyway, so an out-of-date button just gets an error message.
function buttonsFor(claim) {
  const buttons = [];
  if (claim.status === 'HELD') buttons.push(['confirm', 'Confirm pickup plan']);
  if (claim.status === 'HELD' || claim.status === 'CONFIRMED') buttons.push(['cancel', 'Cancel']);
  if (claim.status === 'PICKED_UP') buttons.push(['deliver', 'Mark delivered']);
  if (claim.status === 'DELIVERED') buttons.push(['receipt', 'Confirm receipt']);
  return buttons.map(([step, label]) => {
    const style = step === 'cancel' ? ' class="danger"' : '';
    return `<button${style} onclick="changeClaim(${claim.id}, '${step}')">${label}</button>`;
  }).join(' ');
}

async function loadClaims() {
  showLoading('claims');
  const res = await api('GET', '/claims');
  if (!res.ok) return showError('claims', res.data.error);

  // The number on the tab = claims waiting for this NGO to do something.
  const needAction = res.data.filter((c) => ['HELD', 'PICKED_UP', 'DELIVERED'].includes(c.status)).length;
  setCount('claims-count', needAction);

  showTable('claims', res.data,
    ['Donation', 'For need', 'Quantity', 'Status', ''],
    (c) => [
      `<a href="donation.html?id=${c.donation_id}">${esc(c.donation_title)}</a>`,
      esc(c.need_title),
      `${c.quantity} ${esc(c.unit)}`,
      badge(c.status) + (c.status === 'HELD' ? `<span class="muted">Confirm before ${formatDate(c.expires_at)}</span>` : ''),
      `<div class="actions">${buttonsFor(c)}</div>`,
    ],
    'No claims yet. Open one of your needs and find donations.');
}

async function changeClaim(claimId, step) {
  const res = await api('POST', `/claims/${claimId}/${step}`);
  showMessage('claim-message', res.ok ? `Done: the claim is now ${res.data.status}.` : res.data.error, res.ok ? 'success' : 'error');
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
  showMessage('need-message', '', '');
  event.target.reset();
  await loadNeeds();
  showTab('needs');                             // show the new need in the list
});

loadProfile();
