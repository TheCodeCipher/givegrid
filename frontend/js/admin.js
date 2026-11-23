// admin.js — the administrator verifies or rejects NGOs.

requireRole('ADMIN');

let currentStatus = 'PENDING';               // which tab is open

// admin.html#VERIFIED opens the "Verified" tab (used by the home page shortcut).
const fromAddress = window.location.hash.slice(1);
if (['PENDING', 'VERIFIED', 'REJECTED'].includes(fromAddress)) {
  currentStatus = fromAddress;
}

async function loadNgos() {
  showLoading('ngos');
  const res = await api('GET', `/admin/ngos?status=${currentStatus}`);
  if (!res.ok) return showError('ngos', res.data.error);
  if (currentStatus === 'PENDING') {
    setCount('pending-count', res.data.length);   // the number on the "Waiting" tab
  }

  const emptyText = {
    PENDING: 'No NGOs are waiting for verification.',
    VERIFIED: 'No verified NGOs yet.',
    REJECTED: 'No rejected NGOs.',
  };

  showTable('ngos', res.data,
    // No "Status" column: the open tab already says which status these are.
    ['NGO', 'Contact email', 'City', ''],
    (g) => [
      `<strong>${esc(g.name)}</strong>`, esc(g.email), esc(g.city),
      '<div class="actions">' +
      (g.status !== 'VERIFIED' ? `<button class="button-small" onclick="setStatus(${g.id}, 'VERIFIED', this)">Verify</button>` : '') +
      (g.status !== 'REJECTED' ? `<button class="button-small danger" onclick="setStatus(${g.id}, 'REJECTED', this)">Reject</button>` : '') +
      '</div>',
    ],
    emptyText[currentStatus]);
}

async function setStatus(ngoId, status, button) {
  if (status === 'REJECTED' && !confirm('Reject this NGO? It will not be able to post needs or claim donations.')) {
    return;
  }
  button.disabled = true;                    // no double clicks while we wait
  const res = await api('PATCH', `/admin/ngos/${ngoId}/verification`, { status: status });
  toast(res.ok ? `${res.data.name} is now ${res.data.status.toLowerCase()}.` : res.data.error, res.ok ? 'success' : 'error');
  loadNgos();
}

// Here the tabs don't switch sections: they change which status the table shows.
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    currentStatus = tab.dataset.tab;
    showTab(currentStatus);              // underline the chosen tab
    loadNgos();
  });
});

showTab(currentStatus);
loadNgos();
