# Testing Strategy

How ZeroWaste AI is tested, why each layer exists, and what has to be true before a
change ships.

Every test described here exists and runs today. Nothing in this document is aspirational.

---

## 1. What the tests are protecting

This is not a CRUD application. Three things make it unusually easy to break quietly:

1. **A number decides how much food gets cooked.** A regression in the planner does not
   throw — it produces a plausible but wrong figure, and the kitchen cooks to it. Only an
   assertion on the *value* catches that.
2. **Two roles share one deployment.** An employee and an administrator run the same
   bundle against the same API. The boundary between them is the product's main risk, and
   it is currently weak (see `SECURITY_AUDIT.md`).
3. **The data layer is JSON files on disk.** There is no database to roll back. Any test
   that writes must write somewhere disposable, or it corrupts the repository's own data.

The suite is shaped around those three facts rather than around a coverage target.

---

## 2. The layers

```
                    ┌─────────────────────────────┐
                    │  E2E — Playwright           │   32 tests
                    │  real browser, real server, │   5 files
                    │  real Python, real PDFs     │
                    ├─────────────────────────────┤
                    │  API — Vitest + supertest   │   ~180 tests
                    │  real Express app,          │   6 files
                    │  sandboxed data directory   │
                    ├─────────────────────────────┤
                    │  Component — Vitest + RTL   │   150 tests
                    │  jsdom, axios mocked        │   5 files
                    ├─────────────────────────────┤
                    │  Unit — Vitest              │   ~180 tests
                    │  pure domain logic          │   7 files
                    └─────────────────────────────┘
```

**543 tests in 23 files.** The proportions are deliberate: the domain logic that computes
cooking figures is cheap to test exhaustively at the bottom, and the role boundary is
only *honestly* testable at the top.

### 2.1 Unit — `backend/tests/unit/`

Pure functions and stores, no HTTP.

| File | Covers |
| --- | --- |
| `bookingStore.test.js` | Weekday rules, one-meal-per-category-per-day, replacement scoping |
| `feedbackAndSignals.test.js` | Response scale, shrinkage prior, `MIN_DISH_SAMPLE` gating, multiplier bounds |
| `portionAdvice.test.js` | Plate sizing, per-dish advice, the sample threshold |
| `serviceLog.test.js` | Derived leftovers, corrections superseding, impossible services |
| `invoiceStore.test.js` | Content hashing, duplicate classes, conflict records |
| `invoiceValidation.test.js` | Size and count limits, MIME and magic-byte checks |
| `requireAdmin.test.js` | The guard itself, in isolation |

These are where the *arithmetic* is pinned. If `MIN_DISH_SAMPLE` or `SHRINKAGE_PRIOR`
changes, these fail first and loudest.

### 2.2 API — `backend/tests/api/`

The real Express app via supertest, against a disposable data directory.

| File | Covers |
| --- | --- |
| `authorization.test.js` | **The mandatory boundary test.** Every admin route, unauthenticated and mis-authenticated |
| `bookings.test.js` | Employee booking round trip, validation, IDOR characterization |
| `adminOperations.test.js` | Today's plan, roster, waste recording, accuracy |
| `prediction.test.js` | The Python predictor end to end, plus its fallback |
| `feedback.test.js` | Submission, aggregation, the multiplier it produces |
| `invoices.test.js` | Import, parse, duplicate detection, dataset generation |

`authorization.test.js` deserves a note. It drives an **exhaustive table** of admin
routes:

```js
const ADMIN_ROUTES = [
  ["GET",  "/admin/operations/today",      "today's cooking plan"],
  ["POST", "/admin/operations/service",    "waste recording"],
  // ...22 entries
];
```

Adding an admin route without adding it to that table is the single easiest way to open a
hole in this codebase. The table is the mitigation, and it is checked against the router's
own registered routes so an omission fails the suite rather than passing silently.

### 2.3 Component — `frontend/src/test/`

React Testing Library in jsdom, with `axios` mocked at the module boundary.

| File | Tests | Covers |
| --- | --- | --- |
| `auth.test.tsx` | 23 | `AuthContext`, `ProtectedRoute`, `LoginPage` |
| `booking.test.tsx` | 43 | Weekly planner: selection, persistence, hydration, sync, offline retry |
| `feedback.test.tsx` | ~30 | Smart Plate responses, offline hold-and-retry, legacy migration |
| `services.test.ts` | ~50 | Which calls carry the admin token and which do not |
| `harness.test.tsx` | 4 | The harness itself |

`services.test.ts` is the frontend mirror of `authorization.test.js`: a table of 18 admin
calls asserted to send `x-admin-token`, and 8 employee calls asserted **not** to. It
catches the case where someone adds an admin call that forgets the header (breaks in
production) or an employee call that gains one (leaks the token further).

### 2.4 E2E — `e2e/tests/`

Chromium against both servers, the real Python predictor, and real PDFs.

| File | Tests | Journey |
| --- | --- | --- |
| `journey1-employee-booking.spec.ts` | 5 | **Employee login → weekly booking → confirmation** |
| `journey2-admin-review.spec.ts` | 5 | **Admin login → view bookings → view prediction** |
| `journey3-kitchen-waste.spec.ts` | 4 | **Kitchen → view recommendation → record waste** |
| `journey4-invoice-import.spec.ts` | 5 | **Admin → upload invoice → parse → dataset update** |
| `role-isolation.spec.ts` | 9 | The employee/admin boundary, from a real browser |
| `harness.spec.ts` | 4 | The harness itself |

Journey 4 is the one that most justifies the layer's cost. `fixtures/invoicePdf.ts` mints
a genuine PDF with a real text layer, uploads it through the actual file input, and
`pdfplumber` parses it server-side. Nothing is stubbed, so a dependency upgrade that
breaks parsing fails here and nowhere else.

---

## 3. Isolation: the two changes that made testing possible

Both were required before a single test could be written safely. Neither changes
behaviour.

### 3.1 `ZEROWASTE_DATA_DIR` (backend)

Nine stores previously resolved `../data` at module load. That meant any test that booked
a meal wrote into the repository's committed data, and the path was fixed at first
`require` so a test could not redirect it afterwards.

`backend/lib/dataDir.js` now resolves the directory **per call**:

```js
const dataDir = () => process.env.ZEROWASTE_DATA_DIR || path.join(__dirname, "..", "..", "data");
const dataPath = (...parts) => path.join(dataDir(), ...parts);
```

`predict.py` honours the same variable, so the Python side lands in the sandbox too.
`tests/helpers/sandbox.js` gives each suite a fresh temporary copy:

```js
useDataSandbox({ withModel: true });   // per-suite temp dir, seeded, torn down after
```

### 3.2 `VITE_API_BASE` (frontend)

`API_BASE` was the literal `http://localhost:5000`, so an E2E run could only ever talk to
a developer's own server — writing into the real `data/`. It now reads
`import.meta.env.VITE_API_BASE` with the same default, and the E2E config points the app
at the test backend.

### 3.3 Ports

E2E runs the backend on **5399** and the frontend on **5273**, deliberately away from the
defaults, with `reuseExistingServer: false`. If a developer's own server is running, the
E2E run fails loudly on a busy port rather than quietly attaching to it and mutating real
data. This has already caught itself once.

---

## 4. Characterization tests for the security findings

`SECURITY_AUDIT.md` records 5 Critical findings. The audit was explicitly read-only, so
**none of them are fixed**. Testing around that needs a rule, and the rule is:

> Where behaviour is insecure, assert the insecure behaviour, label it `KNOWN GAP: (Cn)`,
> and name the finding.

```js
it("KNOWN GAP (C4): another employee's plan is readable by naming them", async () => {
  const response = await client().get(`/operations/bookings/me?employeeId=${victim}`);
  expect(response.status).toBe(200);              // ← what it does
  expect(response.body.bookings).not.toHaveLength(0);
});
```

This is not the same as endorsing it. It:

- **stops the gap widening** — a change that made C4 worse would fail the test;
- **makes the fix visible** — fixing C4 turns this test red, which is the signal to invert
  it to `expect(403)`;
- **keeps the count honest** — every Critical finding has at least one test, so the audit
  and the suite cannot drift apart.

There are 12 such tests across the three layers. Each names its finding. **None of them
should be "fixed" by loosening the assertion.**

### C5 was found this way

`predict.py:66-72` applies `MIN_SIGNAL_SAMPLE` to the menu-family and weekday buckets but
not to the global fallback. A single anonymous `POST /feedback` moves
`recommendedServings` from 331 to 338. `signals.js:140-143` and `portionAdvice.js:69-74`
both threshold the equivalent bucket correctly — the inconsistency is the bug.

It was found by a prediction test asserting that one response should not move the number,
which is the argument for testing the arithmetic rather than the status code.

---

## 5. Running the tests

```bash
npm test                  # everything: backend → frontend → E2E

npm run test:backend      # 361 tests, ~70s
npm run test:frontend     # 150 tests, ~10s
npm run test:e2e          # 32 tests, ~2.5min

npm --prefix backend run test:unit     # unit only
npm --prefix backend run test:api      # API only
npm run test:e2e:ui                    # Playwright's interactive runner
```

Debugging a failed E2E run:

```bash
KEEP_E2E_DATA=1 npm run test:e2e       # keeps the JSON the backend actually wrote
npx playwright show-trace e2e/.artifacts/<test>/trace.zip
```

The written JSON is usually the fastest route to the cause — the assertion tells you the
number was wrong, the data directory tells you why.

### Python

The predictor tests need `.venv` at the repository root with `joblib`, `pandas`,
`scikit-learn` and `pdfplumber`. The backend finds it automatically via
`PYTHON_PATH` or `<repo>/.venv/Scripts/python.exe`. Tests that need a trained model
**skip rather than fail** when the artefact is absent, so a fresh clone is green before
the model is built — but CI trains it, so the skip never hides a regression there.

---

## 6. CI gates

`.github/workflows/tests.yml` runs on every push and pull request:

1. **Backend** — Node 20, Python 3.11 venv, model trained, `npm --prefix backend test`
2. **Frontend** — `npm --prefix frontend test`
3. **E2E** — both of the above must pass first; Playwright with Chromium
4. **Audit** — `npm audit --omit=dev` on both packages, non-blocking, reported

Merge is blocked on 1–3. Step 4 reports but does not block, because the two known
moderate advisories (`qs` via `body-parser` via Express 5) have no upstream fix yet and
would otherwise block every unrelated change.

---

## 7. Coverage

Coverage is a gate, not a goal. The thresholds in `backend/vitest.config.mjs` are set at
the level the suite actually achieves, so they catch *regression* rather than decorating
the README:

```js
thresholds: { lines: 70, functions: 70, branches: 60, statements: 70 }
```

Measured today (`npm --prefix backend run test:coverage`):

| Metric | Actual | Gate |
| --- | --- | --- |
| Lines | 81.9% | 70% |
| Statements | 78.5% | 70% |
| Functions | 71.1% | 70% |
| Branches | 60.5% | 60% |

Branches sits barely above its gate, which is honest and useful: the next change that adds
an untested conditional fails CI.

Where the coverage is concentrated matters more than the total. The modules that decide
how much food is cooked, and the one that guards the admin boundary, are the ones held
high:

| Module | Lines | Why |
| --- | --- | --- |
| `middleware/requireAdmin.js` | **100%** | The authorization guard; no excuse |
| `operations/portionAdvice.js` | **100%** | Portion multipliers |
| `operations/serviceLog.js` | 96% | Derived leftovers |
| `operations/predictor.js` | 96% | The Python bridge and its fallback |
| `operations/bookingStore.js` | 95% | Employee bookings |
| `operations/planner.js` | 92% | The cooking figure itself |
| `operations/routes.js` | 91% | Every operations endpoint |
| `invoices/ingest.js` | 93% | Parse and import |
| `invoices/validation.js` | 94% | Untrusted file input |

Deliberately low, and acceptable:

- `invoices/invoiceAnalytics.js` (7%) and `invoicePipeline.js` (15%) are presentation
  aggregations over data already asserted elsewhere; they are exercised by E2E journey 4.
- `operations/accuracy.js` (41%) and `attendance.js` (46%) have large branches that only
  execute once many service days exist. Raising these needs a long-horizon fixture, which
  is worth doing and is not done.

Frontend coverage is reported over `context/`, `components/`, `services/` and
`LoginPage`. Pages are covered by E2E instead — RTL assertions on presentational markup
cost more to maintain than they catch.

```bash
npm --prefix backend run test:coverage
npm --prefix frontend run test:coverage
```

---

## 8. Conventions

**Name the behaviour, not the function.** `"refuses to serve more than was cooked"` beats
`"recordService validation"`. When it fails at 3am, the name should be the diagnosis.

**Assert values, not shapes.** `expect(entry.leftoverPortions).toBe(16)` beats
`expect(entry).toHaveProperty("leftoverPortions")`. The second passes when the arithmetic
is wrong.

**One temporal helper, not `new Date()`.** Weekend dates are rejected by the backend, so
every suite uses `nextWeekday()` / `nextWeekdayKey()`. A test hardcoding a date is a test
that fails on a Saturday.

**Unique identities per test.** `uniqueEmployeeId("journey2")` — the data directory is
shared within an E2E run, and absolute counts are asserted. Collisions produce failures
that look like logic bugs.

**Mock at the module boundary only.** `axios` is mocked; `BookingContext` is not. Mocking
the thing under test is how a suite reaches 100% coverage while testing nothing.

### Two harness traps, documented because they cost real time

- **`restoreMocks: true` does not clear call history for `vi.fn()` created in a module
  factory.** Only `vi.spyOn` spies are restored. `clearMocks: true` is required and is
  load-bearing in `frontend/vitest.config.ts` — removing it breaks two suites.
- **axios `get`/`post`/`put` have separate `mock.calls` arrays.** Ordering across verbs
  needs `mock.invocationCallOrder`. Concatenating the arrays gives an order that looks
  right and is not.

---

## 9. Known gaps in the suite itself

Stated plainly rather than left to be discovered.

- **No waste-recording UI exists.** `recordService` is exported from
  `operationsService.ts` and imported by no page. Journey 3 therefore drives the
  recommendation through the UI and the recording through the API. When the screen is
  built, the API steps become UI steps and the assertions either side stay as they are.
- **Chromium only.** Firefox and WebKit projects are one config block away; the
  application has no browser-specific code today.
- **Frontend dependencies unaudited.** `npm audit` against the corporate package feed
  returns HTTP 500 (`TF400898`). Backend audits fine. Recorded as L6 in the audit.
- **No load or soak testing.** There is also no rate limiting (H2), so the two should be
  addressed together.
- **`data/` seeds are shared within an E2E run.** Hence `workers: 1`. Parallelising means
  giving each worker its own data directory and its own backend port.
