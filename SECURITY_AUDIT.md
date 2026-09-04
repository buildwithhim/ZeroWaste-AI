# ZeroWaste AI — Security Audit

**Date:** 2026-09-04
**Scope:** `backend/` (Express 5 + Python), `frontend/` (React 18 + Vite), `data/`, `scripts/`
**Status:** Findings only. **No code was changed.**

---

## Executive summary

The application has **no authentication and no server-side identity**. "Login" is a
client-side role picker, and the administrator credential is a hardcoded string shipped
inside the employee JavaScript bundle. Every one of the five stated employee boundaries is
currently broken:

| Rule — an employee must NEVER be able to… | Status | Why |
| --- | --- | --- |
| access another employee's bookings | ❌ **Broken** | `GET /operations/bookings/me?employeeId=…` trusts the client-supplied id (C4) |
| access admin APIs | ❌ **Broken** | Admin token is hardcoded in the frontend bundle (C2) |
| upload invoices | ❌ **Broken** | `POST /admin/invoices/import` accepts the same leaked token (C2) |
| view company-wide analytics | ❌ **Broken** | `/admin/analytics/*`, `/admin/operations/*` reachable with the leaked token (C2) |
| manipulate prediction results | ❌ **Broken** | Unauthenticated booking/feedback writes poison the model; `POST /admin/operations/service` rewrites actuals (C3) |

Counts: **4 Critical**, **4 High**, **7 Medium**, **6 Low**.

---

## CRITICAL

### C1 — No authentication; role is chosen by the client and stored in `localStorage`
**Files:** `frontend/src/context/AuthContext.tsx:11-30`, `frontend/src/pages/LoginPage.tsx:8`, `frontend/src/components/ProtectedRoute.tsx:4-7`

Login is a button labelled *"Demo access · no password required"*. It writes
`localStorage["zerowaste-role"] = "admin" | "employee"` and `ProtectedRoute` reads that value
back. There is no password, no session, no token, and no server-side notion of a user.

**Exploit:** in DevTools on any employee device —
```js
localStorage.setItem("zerowaste-role", "admin"); location.reload();
```
Full admin UI: Kitchen, Analytics, Invoice Sync, ESG, Data Pipeline.

**Impact:** complete role escalation, zero effort, no trace.

---

### C2 — Administrator token is hardcoded in the frontend bundle
**Files:** `frontend/src/services/operationsService.ts:18-20`, `frontend/src/services/invoiceService.ts:18-20`, `frontend/src/services/feedbackService.ts:103-104`, `backend/lib/requireAdmin.js:16`

```ts
const ADMIN_TOKEN = "zerowaste-local-admin-token";
const authHeaders = () => ({ "x-admin-token": ADMIN_TOKEN });
```

The backend gate is a shared-secret comparison against the *same* literal, used as the
default when `ADMIN_TOKEN` is unset. Because the constant lives in the shared client bundle,
**every employee's browser already holds the administrator credential** — it is recoverable
from the served JS with a single search, no privileged access required.

**Exploit (from an employee laptop, no admin UI needed):**
```bash
curl -H "x-admin-token: zerowaste-local-admin-token" http://localhost:5000/admin/operations/esg
curl -H "x-admin-token: zerowaste-local-admin-token" http://localhost:5000/admin/analytics/feedback
curl -H "x-admin-token: zerowaste-local-admin-token" -F "invoices=@fake.pdf" \
     http://localhost:5000/admin/invoices/import
curl -X PUT -H "x-admin-token: zerowaste-local-admin-token" -H "content-type: application/json" \
     -d '{"totalEmployees":4000}' http://localhost:5000/admin/operations/roster
```

**Impact:** invoice upload, invoice records and vaulted PDFs (`/admin/invoices/raw/:hash`),
company-wide analytics, ESG, roster writes, service-log writes. This single finding breaks
four of the five employee boundaries. The `adminGate` doc comment claims it "confirms the
caller holds the admin token" — true, but the token is public.

---

### C3 — Prediction and plan results are manipulable by any unauthenticated caller
**Files:** `backend/lib/operations/routes.js:117-127`, `backend/server.js:101-125`, `backend/lib/operations/routes.js:70-91`

Two public write endpoints accept an arbitrary `employeeId` with no proof of ownership and
no rate limit:

* `POST /operations/bookings` — bookings feed `preBookings`, `employeesBooked` and the dish-level
  demand basis in `planner.js`.
* `POST /feedback` — every response is folded into `refreshSignals()`, which writes
  `data/feedback_signals.json`; `predict.py` reads that file and multiplies the model output by
  `portionMultiplier` (`predict.py:38-93`).

**Exploit:** loop `POST /feedback` with fresh random `employeeId` values and
`response: "Left most"` (leftover rate 0.7). Each is stored as a distinct pseudonym, so the
per-employee de-duplication in `feedbackStore.saveFeedback` never fires. The dish/menu-family
multiplier collapses and the kitchen under-cooks. The inverse (`"Wanted more"`) forces
over-cooking and waste. Forged bookings do the same to the headline demand figure.

With the C2 token this becomes total: `POST /admin/operations/service` rewrites the
close-of-service actuals that forecast accuracy, turnout ratio and every ESG figure are graded
against, and re-recording the same `servedOn|dish` **replaces** the earlier row
(`serviceLog.js:93-97`) — history can be rewritten silently.

**Impact:** food-waste model poisoning, falsified accuracy/ESG reporting, real operational and
financial loss.

---

### C4 — IDOR on every "my own data" endpoint
**Files:** `backend/lib/operations/routes.js:107-111,130-134`, `backend/server.js:128-132`, `backend/lib/operations/bookingStore.js:154-159`, `backend/lib/feedbackStore.js:97-102`

```js
publicRouter.get("/bookings/me", (req, res) => {
  const employeeId = req.query.employeeId;          // client-supplied, unverified
  res.json({ bookings: bookingStore.listForEmployee(employeeId) });
});
```

Affected: `GET /operations/bookings/me`, `GET /feedback/me`, `GET /operations/impact/me`. The
`…/me` suffix implies an authenticated subject; there is none. The server hashes whatever
identifier it is handed and returns that person's rows.

The identifier is a `crypto.randomUUID()` generated in the browser
(`BookingContext.tsx:84-90`), so it is not enumerable — but it is **not a secret**: it travels in
URL query strings (proxy logs, access logs, browser history, `Referer`), sits in `localStorage`
on shared/kiosk machines, and is fully attacker-chosen on write. Ownership is never proven.

**Impact:** direct violation of "an employee must never access another employee's bookings",
plus their feedback history and personal impact profile.

---

## HIGH

### H1 — Wildcard CORS on every route
**File:** `backend/server.js:17` — `app.use(cors());`

`Access-Control-Allow-Origin: *` with no origin allow-list. Combined with C2, **any website on
the internet** can script a visiting employee's browser into calling the admin API and read the
responses. `x-admin-token` is a non-simple header, so it triggers a preflight — which the
wildcard config happily approves.

### H2 — No rate limiting or abuse control anywhere
No `express-rate-limit`, no throttle, no lockout on any route. Consequences:
* the C2/C3 poisoning loops run unbounded;
* the admin token can be brute-forced offline with unlimited attempts;
* `GET /forecast` and `GET /pipeline` **spawn a Python process per request**
  (`server.js:45-63`) — a trivial request flood is a resource-exhaustion DoS;
* `POST /admin/invoices/scan` re-runs the whole extraction pipeline on demand.

### H3 — Insecure default secrets, and a pseudonymisation salt that defeats its own purpose
**Files:** `backend/lib/requireAdmin.js:16`, `backend/lib/feedbackStore.js:23`, `backend/lib/operations/bookingStore.js:31`

```js
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "zerowaste-local-admin-token";
const HASH_SALT   = process.env.FEEDBACK_HASH_SALT || "zerowaste-local-development-salt";
```

Both fall back to public literals, and nothing fails or warns when the env vars are absent —
so a production deploy that forgets them is silently insecure. With the default salt known,
the `employeeHash` values are plain unsalted-equivalent SHA-256 over a known input space and
can be reversed for any candidate employee id, undoing the stated privacy contract.
There is no `.env.example` documenting the required variables.

### H4 — No server-side authorisation model at all
Authorisation is a single boolean: "does the caller hold one shared secret". There is no user
record, no role claim, no per-object ownership check, and no audit identity — `req.actor` is
taken verbatim from the client-supplied `x-admin-actor` header (`requireAdmin.js:45`), so the
audit trail in `data/invoice_audit.log` can be attributed to anyone the attacker names.

---

## MEDIUM

### M1 — Runtime and business data committed to the repository
`data/bookings.json` (pseudonymised booking rows), `data/service_log.json`,
`data/prediction_log.json`, `data/roster.json` (site name "Microsoft Pune - CMZ"), and eight
real vendor invoice PDFs in `data/invoices/`. `.gitignore` correctly excludes the invoice vault
and feedback stores but not these. Combined with H3 the booking hashes are reversible.

### M2 — Vulnerable backend dependencies
`npm audit` (backend): **2 moderate** —
`qs` (GHSA-x5fp-wj9c-mxmx array-limit bypass, GHSA-4mjr-xmp4-gh2g DoS via attacker-controlled
`isBuffer`) reached through `body-parser` ← `express@5`.

### M3 — Frontend dependencies unverified, two known-stale
`npm audit` for `frontend/` could not complete (registry proxy returned HTTP 500). Manual
review of `frontend/package.json`: `vite@^6.0.5` and `axios@^1.8.4` both sit below their current
patched lines (Vite 6.0.x dev-server arbitrary-file-read / `server.fs.allow` bypasses; Axios
pre-1.12 DoS). **Re-run the audit and confirm before treating this as resolved.**

### M4 — Raw interpreter errors returned to the client
**Files:** `backend/lib/invoices/ingest.js:100-110`, `backend/lib/invoices/routes.js:52-55`

Python `stderr` is passed straight through as
`` `Extractor unavailable: ${error.message}` `` and returned in the HTTP response, disclosing
absolute filesystem paths, the virtualenv location, package versions and stack traces.

### M5 — No security headers, no TLS
No `helmet`, no CSP, no `X-Content-Type-Options`, no HSTS. `API_BASE` is hardcoded to
`http://localhost:5000` (`feedbackService.ts:3`) — plaintext, and not environment-configurable,
so any deploy either stays on HTTP or requires a code edit.

### M6 — PDF upload hardening gaps
Positives: `%PDF` magic-byte check, 10 MB cap, batch cap, in-memory storage, content-hash
filenames, `0600` vault mode, sanitised display names (`validation.js:24-55`). Gaps: no
page-count or object-count ceiling before handing the file to `pdfplumber`, so a compressed
PDF bomb is a CPU/memory DoS; no AV/content scanning; a malicious PDF is retained in the vault
and re-served to admins via `/admin/invoices/raw/:hash` with `Content-Disposition: inline`,
which renders it in the browser's PDF engine.

### M7 — Sensitive identifiers carried in URL query strings
`employeeId` is passed as a query parameter on three GET routes. Query strings are recorded by
default in web-server access logs, reverse proxies and browser history, and leak via `Referer` —
turning the only identity token the system has into a widely-logged value (feeds C4).

---

## LOW

* **L1 — Timing/length oracle in the token check.** `tokenMatches` (`requireAdmin.js:29-37`)
  early-returns on a length mismatch before the constant-time loop, leaking the token's length.
* **L2 — Audit-log spoofing.** `x-admin-actor` is unvalidated free text (truncated to 120 chars)
  and is written as the actor on every audit entry.
* **L3 — `localStorage` used for all client state.** Role, `employeeId`, weekly bookings,
  feedback and appetite live in `localStorage` — readable by any XSS payload, persistent on
  shared machines, and never cleared on logout (`logout()` removes only the role key).
* **L4 — CSRF.** Classic cookie CSRF does not apply (no cookies, header-based token), but the
  unauthenticated public POST routes are freely callable cross-origin (see H1). No CSRF tokens
  and no `SameSite` posture exist for when real sessions arrive.
* **L5 — Weekend/date validation gaps.** `GET /admin/operations/today?date=` accepts any parsable
  date, including far-future values, and `new Date()` parsing is lenient.
* **L6 — Server-side logging.** `console.error`/`console.warn` log messages only and no PII was
  found in them; the audit log is `0600` and append-only. Noted as acceptable, with M4 as the
  exception.

---

## Verified clean

* **SQL injection** — not applicable. There is no database; persistence is JSON files written via
  `JSON.stringify` with atomic temp-file renames. No query string is ever concatenated.
* **Path traversal** — no traversal found. `invoiceStore.readRaw` enforces `/^[a-f0-9]{64}$/`
  before joining (`invoiceStore.js:69-73`); `safeFileName` strips directory components and
  non-word characters; the `/scan` drop folder is a fixed server-side path the request cannot
  influence; vault files are named by content hash, never by upload name.
* **XSS** — no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` or `document.write`
  anywhere in `frontend/src`. React's default escaping covers the invoice-derived strings
  (dish names, vendor, cafeteria) rendered in admin tables. Residual risk is low and depends on
  no future raw-HTML sink being introduced.
* **Command injection** — both `spawn` calls pass an argument array (never a shell string), and
  the invoice extractor receives its file list over stdin as JSON rather than as argv.
* **Aggregation privacy** — the small-sample suppression in `toPublicSignals`, `buildAdminReport`
  and `buildPortionAdvice` is real and consistently applied; no admin route returns an
  identity-bearing row. This design is sound — it is simply bypassed by C2/C4 upstream.

---

## Suggested remediation order

1. **C2** — remove the token from the frontend; it is the single change that closes four of the
   five employee boundaries.
2. **C1 / H4** — real authentication (SSO) and a server-side role claim; make `adminGate` check
   identity, not a shared secret.
3. **C4 / M7** — derive `employeeId` from the authenticated session; never accept it from the
   client.
4. **C3 / H2** — authenticate the write paths and add rate limiting.
5. **H1** — origin allow-list for CORS.
6. **H3 / M1** — fail fast on missing secrets; purge committed runtime data and rotate the salt.
7. **M2 / M3 / M4 / M5 / M6** — dependency upgrades, error sanitisation, `helmet` + HTTPS,
   PDF resource limits.
