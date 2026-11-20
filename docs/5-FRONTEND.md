# Frontend

Plain HTML + CSS + JavaScript, no framework (permitted by the project guide).
Served by Express from the `frontend/` folder, so pages and API share `http://localhost:3000`.

## Pages

| Page | Script | Who | Shows |
|---|---|---|---|
| `index.html` | `index.js` | anyone | login form, register form, server status |
| `donor.html` | `donor.js` | DONOR | claims on my donations ("Record pickup"), my donations, new donation form, needs board |
| `ngo.html` | `ngo.js` | NGO | register NGO / status / (if verified) my claims with buttons, my needs, new need form |
| `matches.html?need=5` | `matches.js` | NGO | ranked donations for need 5, claim form, **counter-proposal box** |
| `donation.html?id=7` | `donation.js` | anyone logged in | details, history table; owner: edit, close, best NGOs |
| `admin.html` | `admin.js` | ADMIN | NGOs by status, Verify / Reject |

Every page loads `js/common.js` first, then its own script.

## `common.js`: the helpers

| Function | Does |
|---|---|
| `saveLogin(data)`, `getUser()`, `logout()` | keep the token and user in `localStorage` |
| `requireRole('NGO')` | wrong person → back to login. **Only hides pages; the server is the real guard.** |
| `api(method, path, body)` | the **only** `fetch` call. Adds the token, sends JSON, returns `{ ok, status, data }`, never throws |
| `showLoading(id)`, `showError(id, msg)`, `showTable(id, items, headings, makeCells, emptyText)` | the **loading, error and empty** states (+ the table when there's data) |
| `showMessage(id, text, type)` | green/red message under a form |
| `esc(text)` | makes text safe for HTML (stops XSS) |
| `formData(form)` | all inputs of a form as an object, keyed by `name=""` |
| `getParam('id')` | reads `?id=7` from the address |

## The pattern every page repeats

```js
async function loadNeeds() {
  showLoading('needs');                                   // 1. LOADING state
  const res = await api('GET', '/needs?mine=true');       // 2. ask the server
  if (!res.ok) return showError('needs', res.data.error); // 3. ERROR state
  showTable('needs', res.data, [...headings],             // 4. data, or the EMPTY state
    (n) => [esc(n.title), ...],
    'No needs yet.');
}
```

And every form:
```js
form.addEventListener('submit', async (event) => {
  event.preventDefault();                 // stop the browser reloading the page
  const data = formData(event.target);    // { title: '...', quantity_required: '60', ... }
  data.quantity_required = Number(data.quantity_required);   // inputs are always text; server wants numbers
  const res = await api('POST', '/needs', data);
  if (!res.ok) return showMessage('need-message', res.data.error, 'error');
  ...
});
```

## The counter-proposal on screen (`matches.js`, `sendClaim`)

- 201 → green "Reserved X, confirm before <date>".
- 409 **with** `offer` → yellow box: "Only 30 can be reserved right now. Nothing has been reserved yet."
  with **Accept 30** (calls `sendClaim(30)`: a new claim, checked again by the server) and **No thanks**.
- anything else → red message with the server's error.
- After any answer, the page reloads the need and the matches **from the server**, so it never shows
  stock numbers worked out in the browser.

## Why `esc()` matters (XSS)

Pages build HTML with template strings. If a donor names a donation `<script>stealToken()</script>`
and we inserted it raw, it would **run in every visitor's browser** (cross-site scripting) and could
read the token from `localStorage`. `esc()` turns `<` into `&lt;` etc., so it shows as text.

## Buttons follow the server

On the NGO page, which buttons a claim shows (`buttonsFor`) depends on the status the server sent.
If the status changed meanwhile (e.g. it expired), pressing an old button just gets the server's 409
message; the server checks every step. Hiding buttons is for convenience, not security.

## CSS (`css/style.css`)

Flexbox for the top bar and form rows; **Grid** for login/register side by side
(`repeat(auto-fit, minmax(280px, 1fr))` puts them in one column on phones); a `@media (max-width: 600px)`
rule lets tables scroll sideways on phones. `.hidden { display: none }` is how sections are shown or hidden.
