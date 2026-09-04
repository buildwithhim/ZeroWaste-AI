# ZeroWaste AI -- backend API
#
# Node 24 is not a preference, it is a requirement: jsdom's bundled undici calls
# webidl.util.markAsUncloneable, which does not exist on Node 20, and the
# frontend suite cannot run there. Pinning the same major across every image
# keeps CI and production on one runtime.
#
# The patch version is pinned rather than a floating `24-alpine`, so a rebuild
# of a release does not silently pick up a different base. For a release you
# intend to keep, pin the digest as well (`node:24.11.1-alpine@sha256:...`) --
# even an exact tag is mutable on the registry.
FROM node:24.11.1-alpine AS base
ENV NODE_ENV=production
WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
# Copied before the source so this layer is cached against package.json rather
# than against every source edit. An npm install on each build is minutes that
# nothing needs to spend.
FROM base AS deps
COPY backend/package.json backend/package-lock.json ./
# `npm ci` installs exactly the lockfile, and fails if package.json and the
# lockfile disagree -- which is the point. `npm install` would quietly resolve a
# newer transitive dependency into a production image.
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

# dumb-init is PID 1. Node as PID 1 does not get the default signal handlers,
# so an unhandled SIGTERM terminates it immediately -- which would defeat the
# graceful shutdown in lib/shutdown.js on every single deploy.
RUN apk add --no-cache dumb-init

# A dedicated unprivileged user. The node image ships one, but it owns parts of
# /usr/local, so a compromise of the process would be a compromise of the
# runtime install as well.
RUN addgroup -g 10001 -S zerowaste && adduser -u 10001 -S zerowaste -G zerowaste

COPY --chown=zerowaste:zerowaste --from=deps /app/node_modules ./node_modules
COPY --chown=zerowaste:zerowaste backend/package.json ./package.json
COPY --chown=zerowaste:zerowaste backend/server.js ./server.js
COPY --chown=zerowaste:zerowaste backend/lib ./lib
COPY --chown=zerowaste:zerowaste backend/migrations ./migrations
COPY --chown=zerowaste:zerowaste backend/scripts ./scripts

# Deliberately NOT copied:
#
#   predict.py, parse_invoices.py   The AI service owns them. Copying them here
#                                   would mean two copies of the model code and
#                                   a Python runtime in this image.
#   data/                           Runtime state belongs on a volume or in
#                                   Postgres and object storage, not baked into
#                                   an image that is replaced on every deploy.
#   tests/                          Test fixtures include invoice PDFs.

# The mount point for ZEROWASTE_DATA_DIR. Created and owned here so the
# container does not need to write to a root-owned path at start-up.
RUN mkdir -p /var/lib/zerowaste && chown zerowaste:zerowaste /var/lib/zerowaste
ENV ZEROWASTE_DATA_DIR=/var/lib/zerowaste

USER zerowaste
EXPOSE 5000

# Liveness only. A HEALTHCHECK that consults readiness would mark the container
# unhealthy -- and, under a restart policy, restart it -- because Postgres is
# down, which restarting cannot fix. Readiness is the orchestrator's business,
# through /health/ready.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
