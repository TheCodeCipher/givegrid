// matches.js — ranked donations for one need, and the claim panel.
// This page shows the COUNTER-PROPOSAL to the user.
//
// The claim panel on the right has three states (only one is shown at a time):
//   1. claim-hint   nothing chosen yet
//   2. claim-form   a donation is chosen: how many?
//   3. claim-done   the claim worked: what to do next

requireRole('NGO');

const needId = Number(getParam('need'));    // from matches.html?need=5
let need = null;                            // this need, as the server last sent it
let chosenDonationId = null;                // which donation the claim form is for
let matchList = [];                         // the donations shown in the table, as the server sent them

async function loadNeed() {
  const res = await api('GET', `/needs/${needId}`);
  if (!res.ok) return showError('need', res.data.error);
  need = res.data;
  const covered = need.quantity_required - need.remaining_quantity;
  document.getElementById('need').innerHTML =
    `<h1>Donations for “${esc(need.title)}”</h1>
     <p class="summary">You still need <strong>${need.remaining_quantity} of ${need.quantity_required} ${esc(need.unit)}</strong>
       (${esc(need.category_name)}, ${esc(need.city)}).</p>
     <progress value="${covered}" max="${need.quantity_required}"></progress>`;
  if (chosenDonationId !== null) {
    showFacts();                            // keep the panel's numbers up to date
  }
}

// Why a donation ranks where it does, in words. Worked out from the server's score:
// 30 points if it covers the whole need, then 20 (same area) or 10 (same city).
function reasons(d) {
  const tags = [];
  if (d.covers_need) tags.push('<span class="tag tag-good">Covers all you need</span>');
  const place = d.score - (d.covers_need ? 30 : 0);
  if (place === 20) tags.push('<span class="tag tag-good">Same area</span>');
  else if (place === 10) tags.push('<span class="tag">Same city</span>');
  else tags.push('<span class="tag">Other city</span>');
  return tags.join(' ');
}

async function loadMatches() {
  showLoading('matches');
  // Nothing left to claim: say so, instead of offering donations that can't be claimed.
  if (need && need.remaining_quantity === 0) {
    document.getElementById('matches').innerHTML =
      '<p class="empty">This need is fully covered by your claims. Nothing more to claim here.<br>' +
      '<a href="ngo.html#claims">Go to my claims</a> to confirm the pickup plans.</p>';
    document.getElementById('claim-another').classList.add('hidden');
    return;
  }
  const res = await api('GET', `/needs/${needId}/matches`);
  if (!res.ok) return showError('matches', res.data.error);
  matchList = res.data;

  showTable('matches', res.data,
    ['Match score (out of 50)', 'Donation', 'Available', ''],
    (d) => [
      `<strong class="score">${d.score}</strong><div class="tags">${reasons(d)}</div>`,
      `<a href="donation.html?id=${d.id}">${esc(d.title)}</a>
       <span class="muted">${esc(d.locality ? `${d.locality}, ${d.city}` : d.city)}</span>`,
      `${d.available_quantity} ${esc(d.unit)}`,
      // Only the id goes into onclick. Never put user-typed text (like a title) inside
      // onclick: the browser decodes &#39; back into ' and the text could run as code.
      `<button class="button-small" onclick="chooseDonation(${d.id})">Choose</button>`,
    ],
    'No open donations match this need yet. Check again later.');
  highlightChosen();
}

// Marks the chosen donation's row, so it's clear which one the panel is about.
function highlightChosen() {
  document.querySelectorAll('#matches tr').forEach((row) => {
    row.classList.toggle('chosen', Number(row.dataset.id) === chosenDonationId);
  });
}

// Shows one of the panel's three states and highlights the matching "how to" step.
function showPanel(state) {
  document.getElementById('claim-hint').classList.toggle('hidden', state !== 'hint');
  document.getElementById('claim-form').classList.toggle('hidden', state !== 'form');
  document.getElementById('claim-done').classList.toggle('hidden', state !== 'done');
  const stepNumber = { hint: 1, form: 2, done: 3 }[state];
  for (let i = 1; i <= 3; i++) {
    const step = document.getElementById(`how-${i}`);
    step.className = i < stepNumber ? 'done' : (i === stepNumber ? 'current' : '');
  }
}

// The three numbers in the panel. "Most you can get" uses the same rule as the
// server (rules.decideClaim): the smaller of "available" and "still needed".
// It's only a hint: the server works it out again from the locked rows.
function showFacts() {
  const donation = matchList.find((d) => d.id === chosenDonationId);
  if (!donation || !need) return;
  const most = Math.min(donation.available_quantity, need.remaining_quantity);
  document.getElementById('fact-available').textContent = `${donation.available_quantity} ${donation.unit}`;
  document.getElementById('fact-needed').textContent = `${need.remaining_quantity} ${need.unit}`;
  document.getElementById('fact-most').textContent = `${most} ${need.unit}`;
  return most;
}

function chooseDonation(donationId) {
  chosenDonationId = donationId;
  const donation = matchList.find((d) => d.id === donationId);
  document.getElementById('claim-title').textContent = donation.title;   // textContent: shown as plain text
  const most = showFacts();
  document.getElementById('claim-quantity').value = most > 0 ? most : '';  // a sensible starting number
  document.getElementById('offer').classList.add('hidden');
  showMessage('claim-message', '', '');
  showPanel('form');
  highlightChosen();
  // On phones the panel is below the list, so bring it into view.
  if (window.innerWidth < 900) document.querySelector('.claim-panel').scrollIntoView({ behavior: 'smooth' });
  document.getElementById('claim-quantity').focus();                       // ready to type the number
}

function resetPanel() {
  chosenDonationId = null;
  showPanel('hint');
  highlightChosen();
}

// Sends a claim. Also used to ACCEPT a counter-proposal: accepting is just a
// new claim for the offered amount, and the server checks the stock again.
async function sendClaim(quantity) {
  const button = document.getElementById('claim-button');
  button.disabled = true;                   // no double clicks while we wait
  const res = await api('POST', `/donations/${chosenDonationId}/claims`, { need_id: needId, quantity: quantity });
  button.disabled = false;
  const offerBox = document.getElementById('offer');
  offerBox.classList.add('hidden');

  if (res.ok) {
    document.getElementById('done-text').textContent =
      `${res.data.quantity} reserved. Confirm your pickup plan before ${formatDate(res.data.expires_at)}.`;
    showPanel('done');
  } else if (res.status === 409 && res.data.offer) {
    // COUNTER-PROPOSAL: nothing is reserved yet. The NGO decides.
    offerBox.innerHTML =
      `<p><strong>Only ${res.data.offer} can be reserved right now</strong>
        (${res.data.available} available, you still need ${res.data.stillNeeded}). Nothing has been reserved yet.</p>
       <div class="actions">
         <button type="button" onclick="sendClaim(${res.data.offer})">Accept ${res.data.offer}</button>
         <button type="button" class="button-quiet" onclick="document.getElementById('offer').classList.add('hidden')">No thanks</button>
       </div>`;
    offerBox.classList.remove('hidden');
    showMessage('claim-message', '', '');
  } else {
    showMessage('claim-message', res.data.error, 'error');
  }
  await loadNeed();          // always show the server's current numbers
  loadMatches();             // (after loadNeed, so it knows if the need is now covered)
}

document.getElementById('claim-form').addEventListener('submit', (event) => {
  event.preventDefault();
  sendClaim(Number(document.getElementById('claim-quantity').value));
});

// Start: the need first (the list needs to know how much is still needed), then the list.
loadNeed().then(loadMatches);
