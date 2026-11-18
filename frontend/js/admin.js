// admin.js — the admin verifies or rejects NGOs.

requireRole('ADMIN');

async function loadNgos() {
  const status = document.getElementById('filter').value;
  showLoading('ngos');
  const res = await api('GET', `/admin/ngos?status=${status}`);
  if (!res.ok) return showError('ngos', res.data.error);

  showTable('ngos', res.data,
    ['NGO', 'Contact', 'City', 'Status', ''],
    (g) => [
      esc(g.name), esc(g.email), esc(g.city), badge(g.status),
      (g.status !== 'VERIFIED' ? `<button onclick="setStatus(${g.id}, 'VERIFIED')">Verify</button> ` : '') +
      (g.status !== 'REJECTED' ? `<button class="danger" onclick="setStatus(${g.id}, 'REJECTED')">Reject</button>` : ''),
    ],
    `No ${status.toLowerCase()} NGOs.`);
}

async function setStatus(ngoId, status) {
  const res = await api('PATCH', `/admin/ngos/${ngoId}/verification`, { status: status });
  showMessage('message', res.ok ? `NGO is now ${res.data.status}.` : res.data.error, res.ok ? 'success' : 'error');
  loadNgos();
}

document.getElementById('filter').addEventListener('change', loadNgos);
loadNgos();
