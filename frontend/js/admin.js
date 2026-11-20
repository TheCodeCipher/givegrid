// admin.js — the administrator verifies or rejects NGOs.

requireRole('ADMIN');

let currentStatus = 'PENDING';               // which tab is open

async function loadNgos() {
  showLoading('ngos');
  const res = await api('GET', `/admin/ngos?status=${currentStatus}`);
  if (!res.ok) return showError('ngos', res.data.error);

  const emptyText = {
    PENDING: 'No NGOs are waiting for verification.',
    VERIFIED: 'No verified NGOs yet.',
    REJECTED: 'No rejected NGOs.',
  };

  showTable('ngos', res.data,
    ['NGO', 'Contact', 'City', 'Status', ''],
    (g) => [
      `<strong>${esc(g.name)}</strong>`, esc(g.email), esc(g.city), badge(g.status),
      '<div class="actions">' +
      (g.status !== 'VERIFIED' ? `<button onclick="setStatus(${g.id}, 'VERIFIED')">Verify</button>` : '') +
      (g.status !== 'REJECTED' ? `<button class="danger" onclick="setStatus(${g.id}, 'REJECTED')">Reject</button>` : '') +
      '</div>',
    ],
    emptyText[currentStatus]);
}

async function setStatus(ngoId, status) {
  const res = await api('PATCH', `/admin/ngos/${ngoId}/verification`, { status: status });
  showMessage('message', res.ok ? `${res.data.name} is now ${res.data.status.toLowerCase()}.` : res.data.error, res.ok ? 'success' : 'error');
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
