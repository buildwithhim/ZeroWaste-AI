# ZeroWaste AI — production

Operator-facing quick reference for deploying ZeroWaste AI. For the reasoning
behind any of it, see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). For the
security findings that gate go-live, see
[`SECURITY_AUDIT.md`](SECURITY_AUDIT.md); for the test suite, see
[`TESTING_STRATEGY.md`](TESTING_STRATEGY.md).

> [!WARNING]
> **Not safe to expose publicly yet.** Five critical security findings remain
> open, including the fact that login is a client-side role picker with no
> server-side session — setting `localStorage["zerowaste-role"] = "admin"` in a
> browser console grants the admin application. Deploy only behind an existing
> access control (VPN, SSO proxy, internal network). See
> [Go-live blockers](docs/DEPLOYMENT.md#go-live-blockers).

---

## Stack

| Service | Port | Image |
|---|---|---|
| frontend | 8080 | nginx + static Vite bundle, proxies the API |
| backend | 5000 | Express API |
| ai-service | 8000 | FastAPI, scikit-learn, pdfplumber — **never published** |
| postgres | 5432 | managed service in production |
| object storage | — | S3 or compatible; holds original invoice PDFs |

---

## Quick start

```bash
cp .env.example .env
# Fill in ADMIN_TOKEN and FEEDBACK_HASH_SALT:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

npm run docker:up      # builds and starts everything, including Postgres + MinIO
```

Then <http://localhost:8080>.

```bash
npm run docker:logs
npm run docker:down
```

## Production

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The overlay supplies **no defaults** — Compose refuses to start if a required
variable is missing. That is intentional.

---

## Commands

| Command | Does |
|---|---|
| `npm run build` | Build the frontend bundle |
| `npm run docker:build` | Build all three images |
| `npm run docker:up` / `docker:down` | Local stack up / down |
| `npm run docker:config` | Validate the merged production Compose config |
| `npm run prod:up` / `prod:down` | Production overlay up / down |
| `npm run migrate` | Apply pending migrations |
| `npm run migrate:check` | Report pending migrations; non-zero if any |
| `npm test` | Backend + frontend + E2E |

---

## Required configuration

Full reference in [`.env.example`](.env.example). The minimum for production:

```bash
NODE_ENV=production
ADMIN_TOKEN=                 # 32+ chars, unique per environment
FEEDBACK_HASH_SALT=          # 32+ chars; changing it orphans every hash
CORS_ALLOWED_ORIGINS=        # exact https origins, comma-separated
ZEROWASTE_DATA_DIR=/var/lib/zerowaste
DATABASE_URL=
STORAGE_DRIVER=s3
STORAGE_BUCKET=
STORAGE_REGION=
AI_SERVICE_URL=http://ai-service:8000
APP_VERSION=                 # commit SHA
```

The backend **validates all of this before opening a port** and exits `78`
with every problem listed if anything is wrong. It will not start with the
committed development secrets, a wildcard CORS origin, or a plaintext `http://`
origin.

> [!CAUTION]
> Never commit real secrets. `.gitignore` covers `.env*` and re-includes only
> `.env.example`. Anything prefixed `VITE_` is inlined into the JavaScript
> bundle and served to every visitor.

---

## Health

| Endpoint | Checks | Use for |
|---|---|---|
| `/health/live` | nothing | container healthcheck, liveness probe |
| `/health/ready` | Postgres, storage, AI service | load balancer, readiness probe |
| `/health/info` | non-secret config | confirming a running instance |

Point liveness at `/health/live` and **never** at `/health/ready` — a liveness
probe that fails during a database outage restarts every healthy replica and
turns an outage into a crash loop.

```bash
curl -fsS http://localhost:5000/health/ready | jq
curl -fsS http://localhost:5000/health/info  | jq   # expect nodeEnv: production
```

---

## Deploy order

1. `npm run migrate` — must be backward compatible with the running version
2. ai-service → wait for `/health/live`
3. backend → will not accept traffic until `/health/ready` passes
4. frontend

**Rollback** is redeploying the previous image tag. There are no down
migrations; take a database snapshot before migrating.

---

## Common problems

| Symptom | Cause |
|---|---|
| Exits with code 78 | Invalid config — the log lists every problem |
| `/health/ready` 503, `/health/live` 200 | A dependency is down. Don't restart. |
| CORS errors in the console | Origin missing from `CORS_ALLOWED_ORIGINS`, or `VITE_API_BASE` was baked in when it should be empty |
| Uploaded PDF later unreadable | `STORAGE_DRIVER=local` with >1 replica |
| Requests cut off during deploys | `SHUTDOWN_GRACE_MS` below the LB deregistration delay |

Full runbook: [`docs/DEPLOYMENT.md#runbook`](docs/DEPLOYMENT.md#runbook).

---

## Note on data

The application still reads and writes **JSON files**, not Postgres. The
schema, migrations and repository interface exist and are exercised in CI, but
the data-layer cutover is deliberately a follow-up change. See
[The Postgres cutover](docs/DEPLOYMENT.md#the-postgres-cutover).
