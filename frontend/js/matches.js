// matches.js — ranked donations for one need, and the claim form.
// This page shows the COUNTER-PROPOSAL to the user.

requireRole('NGO');

const needId = Number(getParam('need'));    // from matches.html?need=5
let chosenDonationId = null;                // which donation the claim form is for

async function loadNeed() {
  const res = await api('GET', `/needs/${needId}`);
  if (!res.ok) return showError('need', res.data.error);
  const n = res.data;
  document.getElementById('need').innerHTML =
    `<p><strong>${esc(n.title)}</strong> — still needed: <strong>${n.remaining_quantity} ${esc(n.unit)}</strong>,
     ${esc(n.category_name)}, ${esc(n.city)}</p>`;
}

async function loadMatches() {
  showLoading('matches');
  const res = await api('GET', `/needs/${needId}/matches`);
  if (!res.ok) return showError('matches', res.data.error);

  showTable('matches', res.data,
    ['Score', 'Donation', 'Available', 'Where', ''],
    (d) => [
      `<strong>${d.score}</strong>`,
      `<a href="donation.html?id=${d.id}">${esc(d.title)}</a>`,
      `${d.available_quantity} ${esc(d.unit)}`,
      esc(d.locality ? `${d.locality}, ${d.city}` : d.city),
      `<button onclick="chooseDonation(${d.id}, '${esc(d.title)}')">Claim</button>`,
    ],
    'No open donations match this need yet. Check again later.');
}

function chooseDonation(donationId, title) {
  chosenDonationId = donationId;
  document.getElementById('claim-title').textContent = title;
  document.getElementById('claim-form').classList.remove('hidden');
  document.getElementById('offer').classList.add('hidden');
  showMessage('claim-message', '', '');
}

// Sends a claim. Also used to ACCEPT a counter-proposal: accepting is just a
// new claim for the offered amount, and the server checks the stock again.
async function sendClaim(quantity) {
  const res = await api('POST', `/donations/${chosenDonationId}/claims`, { need_id: needId, quantity: quantity });
  const offerBox = document.getElementById('offer');
  offerBox.classList.add('hidden');

  if (res.ok) {
    showMessage('claim-message', `Reserved ${res.data.quantity}. Confirm your pickup plan before ${formatDate(res.data.expires_at)}.`, 'success');
  } else if (res.status === 409 && res.data.offer) {
    // COUNTER-PROPOSAL: nothing is reserved yet. The NGO decides.
    offerBox.innerHTML =
      `<p><strong>Only ${res.data.offer} can be reserved right now</strong>
        (${res.data.available} available, you still need ${res.data.stillNeeded}). Nothing has been reserved yet.</p>
       <button type="button" onclick="sendClaim(${res.data.offer})">Accept ${res.data.offer}</button>
       <button type="button" class="secondary" onclick="document.getElementById('offer').classList.add('hidden')">No thanks</button>`;
    offerBox.classList.remove('hidden');
    showMessage('claim-message', '', '');
  } else {
    showMessage('claim-message', res.data.error, 'error');
  }
  loadNeed();                // always show the server's current numbers
  loadMatches();
}

document.getElementById('claim-form').addEventListener('submit', (event) => {
  event.preventDefault();
  sendClaim(Number(document.getElementById('claim-quantity').value));
});

loadNeed();
loadMatches();
