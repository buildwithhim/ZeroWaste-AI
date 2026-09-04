# ZeroWaste AI -- frontend
#
# Two stages, for two very different reasons. The build stage needs Node, the
# TypeScript compiler, Vite and roughly 400 MB of node_modules. The runtime
# needs none of it: the output is static files. Shipping the build environment
# to production would mean an image an order of magnitude larger containing a
# compiler, a package manager and the full dependency tree, none of which is
# used to serve a single request.

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM node:24.11.1-alpine AS build
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# Vite inlines every VITE_-prefixed variable into the bundle at build time, so
# this is a build argument rather than a runtime environment variable. It is
# also why nothing secret may ever be named VITE_*: the value ends up in
# JavaScript that is served to every visitor.
#
# The default is empty, which makes the app issue same-origin relative requests
# and lets the nginx block below proxy them. Set it only when the API is on a
# genuinely different origin.
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE

RUN npm run build

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# The unprivileged image runs as uid 101 and listens on 8080, so no capability
# to bind a low port is needed. The stock nginx image runs its master process as
# root purely to bind port 80, which is a root process per replica in exchange
# for nothing a proxy cannot provide.
USER 101

# Rendered by the image's entrypoint at start-up, not baked in. The filter
# restricts substitution to BACKEND_* so nginx's own $host, $uri and
# $remote_addr survive envsubst untouched.
COPY --chown=101:101 docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chown=101:101 --from=build /app/dist /usr/share/nginx/html

ENV BACKEND_HOST=backend \
    BACKEND_PORT=5000 \
    NGINX_ENVSUBST_FILTER=^BACKEND_

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
