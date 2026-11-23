# Frontend

Plain HTML + CSS + JavaScript, no framework (permitted by the project guide).
Served by Express from the `frontend/` folder, so pages and API share `http://localhost:3000`.

## Pages

| Page | Script | Who | Shows |
|---|---|---|---|
| `index.html` | `home.js` | anyone | home page: what GiveGrid does, the 100-chair example, how it works. Logged out: sign-up links. Logged in: "Welcome back" and two shortcuts for that account type |
| `login.html` | `login.js` | anyone | "Log in" and "Create an account" tabs (`?mode=register&role=NGO` opens the right one) |
| `donor.html` | `donor.js` | DONOR | 4 overview numbers; tabs: my donations, handovers ("Record pickup"), list an item, what NGOs need |
| `ngo.html` | `ngo.js` | NGO | not registered / pending: the 3 onboarding steps. Verified: 4 overview numbers; tabs: my claims (filtered by whose turn it is), my needs, post a need |
| `matches.html?need=5` | `matches.js` | NGO | the claiming page: 3 numbered steps, ranked donations with the reasons for each score, and a claim panel with the **counter-proposal box** |
| `donation.html?id=7` | `donation.js` | anyone logged in | details and history; the owner also gets edit / stop new claims and a second tab, "NGOs that need this most" |
| `admin.html` | `admin.js` | ADMIN | NGOs by status (tabs, with the number waiting), Verify / Reject |

Every page loads `js/common.js` first, then its own script.

## `common.js`: the helpers

| Function | Does |
|---|---|
| `saveLogin(data)`, `getUser()`, `logout()` | keep the token and user in `localStorage` |
| `requireRole('NGO')` | wrong person → back to the login page. **Only hides pages; the server is the real guard.** |
| `api(method, path, body)` | the **only** `fetch` call. Adds the token, sends JSON, returns `{ ok, status, data }`, never throws |
| `showLoading(id)`, `showError(id, msg)`, `showTable(id, items, headings, makeCells, emptyText)` | the **loading, error and empty** states (+ the table when there's data). "Loading…" only the first time; the table sits in a scroll box and keeps its scroll position on refresh |
| `setupTabs()`, `showTab(name)` | show one section at a time: a `.tab` button with `data-tab="x"` shows the `.panel` with `data-panel="x"`. The open tab is in the address (`ngo.html#claims`) |
| `setCount(id, n)`, `plural(n, word)` | the number on a tab (e.g. claims waiting); "1 listing" / "3 listings" |
| `showMessage(id, text, type)` | green/red message under a form (form errors) |
| `toast(text, type)` | the result of a button press, floating in the corner for 5 seconds |
| `claimGroup`, `nextStep`, `claimTracker`, `timeLeft`, `updateChips` | claims: which group it's in (your turn / waiting / finished), the sentence saying what happens next, the 5-step progress bar, hours left on a hold, the filter buttons' numbers |
| `esc(text)` | makes text safe for HTML (stops XSS) |
| `formData(form)` | all inputs of a form as an object, keyed by `name=""` |
| `getParam('id')` | reads `?id=7` from the address |

## No flicker: why nothing jumps when you press a button

Three things used to make the page jump, and each has one fix:

| Cause | Fix | Where |
|---|---|---|
| Every refresh replaced the list with "Loading…" and then the list again, so the page shrank and grew | `showLoading` only shows "Loading…" if the box is **empty** (the first load). On a refresh the old rows stay until the new ones replace them | `common.js` |
| Result messages appeared above/below the tables and pushed them down | button results go to a **toast** that floats over the page (`position: fixed`), so it takes no space | `common.js`, `style.css` |
| The scrollbar appeared/disappeared as lists changed length, shifting the page sideways | `scrollbar-gutter: stable` always keeps room for it | `style.css` |

Also: long lists scroll inside their own box (`.table-scroll`, column titles stay visible) instead of
making the page very long; the box keeps its scroll position after a refresh; the claim panel on
the claiming page has a fixed minimum height; and the tab names in the address (`#claims`) are never
also the `id` of an element, because the browser would scroll to that element.
Measured with the browser's layout-shift counter: pressing "Confirm pickup plan" moved the page by
0.019 before, and 0 now.

## The pattern every page repeats

```js
async function loadNeeds() {
  showLoading('needs-list');                                   // 1. LOADING state (first time only)
  const res = await api('GET', '/needs?mine=true');            // 2. ask the server
  if (!res.ok) return showError('needs-list', res.data.error); // 3. ERROR state
  showTable('needs-list', res.data, [...headings],             // 4. data, or the EMPTY state
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

## The claiming page (`matches.js`)

The claim panel on the right has three states, one shown at a time: **nothing chosen** → **a donation
chosen** (Available / You still need / Most you can get, and "How many?") → **reserved** (what to do
next, and a button to "My claims"). The three numbered steps at the top light up to match.
"Most you can get" is `Math.min(available, stillNeeded)`, the same rule as `rules.decideClaim`; it's
only a hint, the server decides. The reasons under each score ("Covers all you need", "Same area")
are read from the server's score: 30 for covering the need, then 20 (same area) or 10 (same city).
Once the need is fully covered, the list is replaced by "This need is fully covered".

### The counter-proposal on screen (`sendClaim`)

Type more than "Most you can get" and press **Claim**:

- 201 → the panel switches to "Reserved", with the deadline and a button to "My claims".
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
- **Tabs instead of one long page:** each dashboard shows 4 overview numbers (each one opens its list)
  and one section at a time. Claims can be filtered by whose turn it is.
- **Claim progress:** every claim shows its 5 steps (Claimed → Confirmed → Picked up → Delivered → Received)
  and one sentence saying who acts next. Cancel and "Stop new claims" ask first (`confirm()`).
- **The home-page grid:** 100 squares built by `home.js`, one per chair of an example donation split
  40/40/20 between three NGOs. It fills in once when the page opens; with "reduce motion" switched on in
  the operating system, it appears without animation (`prefers-reduced-motion`).
- **Responsive:** checked at 360, 768, 1280 and 1920 pixels wide with no sideways scrolling. Below 900px
  the two-column pages stack into one column. Below 640px every table row becomes a small card: each
  `<td>` carries `data-label="Column name"` (added by `showTable`) and the CSS shows that label above the value.
- **Keyboard:** every button and link shows a visible focus outline (`:focus-visible`).
