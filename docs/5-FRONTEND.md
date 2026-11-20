# Frontend

Plain HTML + CSS + JavaScript, no framework (permitted by the project guide).
Served by Express from the `frontend/` folder, so pages and API share `http://localhost:3000`.

## Pages

| Page | Script | Who | Shows |
|---|---|---|---|
| `index.html` | `home.js` | anyone | home page: what GiveGrid does, the 100-chair grid, how it works, sign-up links |
| `login.html` | `login.js` | anyone | "Log in" and "Create an account" tabs (`?mode=register&role=NGO` opens the right one) |
| `donor.html` | `donor.js` | DONOR | tabs: my donations, handovers ("Record pickup"), list an item, what NGOs need |
| `ngo.html` | `ngo.js` | NGO | register NGO, or its status, or (when verified) tabs: my claims, my needs, post a need |
| `matches.html?need=5` | `matches.js` | NGO | ranked donations for need 5; side panel with the claim form and the **counter-proposal box** |
| `donation.html?id=7` | `donation.js` | anyone logged in | details and history; for the owner: edit, stop new claims, NGOs that need it most |
| `admin.html` | `admin.js` | ADMIN | NGOs by status (tabs), Verify / Reject |

Every page loads `js/common.js` first, then its own script.

## `common.js`: the helpers

| Function | Does |
|---|---|
| `saveLogin(data)`, `getUser()`, `logout()` | keep the token and user in `localStorage` |
| `requireRole('NGO')` | wrong person → back to the login page. **Only hides pages; the server is the real guard.** |
| `api(method, path, body)` | the **only** `fetch` call. Adds the token, sends JSON, returns `{ ok, status, data }`, never throws |
| `showLoading(id)`, `showError(id, msg)`, `showTable(id, items, headings, makeCells, emptyText)` | the **loading, error and empty** states (+ the table when there's data) |
| `setupTabs()`, `showTab(name)` | show one section at a time: a `.tab` button with `data-tab="x"` shows the `.panel` with `data-panel="x"` |
| `setCount(id, n)`, `plural(n, word)` | the number on a tab (e.g. claims waiting); "1 listing" / "3 listings" |
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

**One rule for buttons:** `onclick="..."` attributes only ever contain numbers or fixed words, such as
`onclick="chooseDonation(5)"`, never text a user typed. Inside an attribute the browser decodes
`&#39;` back into `'` before running the code, so escaping is not enough there. The matches page
therefore passes only the donation's id and looks the title up in the list it already loaded
(`matchList`), then shows it with `textContent`, which never runs as code.

## Buttons follow the server

On the NGO page, which buttons a claim shows (`buttonsFor`) depends on the status the server sent.
If the status changed meanwhile (e.g. it expired), pressing an old button just gets the server's 409
message; the server checks every step. Hiding buttons is for convenience, not security.

## Look and layout (`css/style.css`)

- **Fonts:** Bricolage Grotesque for headings, Public Sans for text. Both are open-licensed and stored in
  `frontend/fonts/`, because our Content-Security-Policy only allows files from our own server.
- **Colours:** set once as CSS variables in `:root` (e.g. `var(--leaf)`) and reused everywhere.
- **Tabs instead of one long page:** each dashboard shows a one-line summary and one section at a time.
- **The home-page grid:** 100 squares built by `home.js`, one per chair of an example donation split
  40/40/20 between three NGOs. It fills in once when the page opens; with "reduce motion" switched on in
  the operating system, it appears without animation (`prefers-reduced-motion`).
- **Responsive:** checked at 360, 768, 1280 and 1920 pixels wide with no sideways scrolling. Below 900px
  the two-column pages stack into one column. Below 640px every table row becomes a small card: each
  `<td>` carries `data-label="Column name"` (added by `showTable`) and the CSS shows that label above the value.
- **Keyboard:** every button and link shows a visible focus outline (`:focus-visible`).
