# Only the JavaScript this project uses

Not a course. Just every construct that appears in our code, with our own example.

| Construct | Example from our code | Meaning |
|---|---|---|
| `require` / `module.exports` | `const { pool } = require('../db');` | load another file. That file chose what to share with `module.exports = { pool, ... }` |
| `const` / `let` | `const limit = 20;` `let count = 0;` | `const` can't be reassigned; `let` can |
| Arrow function | `(req, res) => { ... }` | a short way to write `function (req, res) { ... }` |
| `async` / `await` | `const [rows] = await pool.query(sql)` | `await` pauses **this function** until the database answers; other requests keep running. Only allowed inside an `async` function |
| Promise | `pool.query(...)` returns one | "a result that will arrive later". `await` waits for it |
| `Promise.all([a, b])` | concurrency tests | start a and b **together**, wait for both |
| `try / catch / finally` | `withTransaction` | try the work; if anything throws, run catch (ROLLBACK); always run finally (release) |
| `throw new HttpError(404, '...')` | everywhere | stop here and jump to the nearest catch (finally: the error handler) |
| Destructuring (array) | `const [rows] = await pool.query(...)` | take the first item of the returned array |
| Destructuring (object) | `const { pool, withTransaction } = require('../db')` | take those named properties |
| Default parameter | `function oneOf(value, field, maxLength = 100)` | used if the caller leaves it out |
| Template literal | `` `Only ${offer} can be reserved` `` | text with values inside `${ }` |
| Spread | `{ error: err.message, ...err.extra }` | copy all properties of `err.extra` into this object |
| `? :` | `config.isTest ? testName : name` | if … then … else, in one expression |
| `array.map(fn)` | `rows.map((r) => r.title)` | a new array with `fn` applied to each item |
| `array.filter(fn)` | `replies.filter((r) => r.status === 201)` | keep only items where `fn` is true |
| `array.includes(x)` | `step.from.includes(claim.status)` | is x in the array? |
| `class ... extends Error` | `HttpError` | a new kind of error with extra fields |
| `JSON.stringify` / `JSON.parse` | `api()` | object → text (to send) / text → object (received) |
| `Number.isInteger(x)` | `validate.quantity` | true only for real whole numbers (`5`, not `"5"`, not `2.5`) |

**Express-specific**

| Thing | Meaning |
|---|---|
| `req.body` | the JSON the client sent (after `express.json()`) |
| `req.params.id` | the `:id` part of the URL, **always text** |
| `req.query.mine` | `?mine=true` from the URL, text |
| `req.headers.authorization` | the `Authorization` header |
| `req.user` | **we** put it there in `authenticate` |
| `res.status(201).json(obj)` | set the status, then send JSON. Status must come **before** json |
| `next()` | "I'm done, pass to the next middleware" |
| `next(err)` | "skip to the error handler" |
| `express.Router()` | a mini-app for one group of URLs, mounted with `app.use('/api/needs', router)` |
| `router.use(authenticate)` | run this middleware for every route in this file |

**Browser-specific**

| Thing | Meaning |
|---|---|
| `fetch(url, options)` | send an HTTP request; `await response.json()` reads the reply |
| `document.getElementById('x')` | find the element with `id="x"` |
| `el.innerHTML = '...'` / `el.textContent = '...'` | put HTML / plain text inside it |
| `el.addEventListener('submit', fn)` | run fn when the form is submitted |
| `event.preventDefault()` | stop the browser's default action (reloading the page) |
| `el.classList.add('hidden')` / `.remove('hidden')` | hide / show (our CSS has `.hidden { display: none }`) |
| `localStorage.setItem / getItem` | small storage in the browser that survives reloads |
| `onclick="changeClaim(5, 'confirm')"` | call a global function when the button is clicked |

**SQL-in-JS**

```js
await pool.query('SELECT * FROM needs WHERE id = ?', [needId]);
```
Each `?` is replaced, in order, by a value from the array, **safely escaped**. That's what makes SQL
injection impossible: the value is always treated as data, never as part of the SQL command.
