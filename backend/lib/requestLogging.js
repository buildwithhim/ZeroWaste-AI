/**
 * Request correlation and access logging.
 *
 * Every request is given an id, which is attached to the async context so any
 * log line produced while handling it carries the same `requestId`, and echoed
 * back in `X-Request-Id` so a user reporting a failure can quote something that
 * finds the exact trace.
 *
 * WHAT IS NOT LOGGED
 * ------------------
 * The path is logged; the query string is not. `/operations/bookings/me` and
 * `/feedback/me` both take `?employeeId=`, so logging the full URL would write
 * a per-person activity trail into the log aggregator -- the exact disclosure
 * the hashing in bookingStore and feedbackStore exists to prevent. Request
 * bodies are never logged for the same reason.
 */

const crypto = require("crypto");

const { logger, withContext } = require("./logger");

/** Trusts an inbound id only if it looks like one, so it cannot inject fields. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

function resolveRequestId(req) {
  const inbound = req.get("x-request-id");
  return inbound && SAFE_ID.test(inbound) ? inbound : crypto.randomUUID();
}

/**
 * The route pattern rather than the concrete path, so ids in a URL do not
 * become high-cardinality noise -- and so a content hash in
 * `/admin/invoices/raw/:hash` is not written to the log.
 */
function routeLabel(req) {
  const base = req.baseUrl || "";
  const route = req.route?.path;
  if (route && route !== "/") return `${base}${route}`;
  return base || req.path;
}

function requestLogging() {
  return function logRequest(req, res, next) {
    const requestId = resolveRequestId(req);
    const startedAt = process.hrtime.bigint();

    res.setHeader("X-Request-Id", requestId);

    withContext({ requestId }, () => {
      res.on("finish", () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const detail = {
          method: req.method,
          route: routeLabel(req),
          status: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        };

        // 5xx is ours, 4xx is usually the caller's; only the former deserves
        // to wake anyone up.
        if (res.statusCode >= 500) logger.error("request failed", detail);
        else if (res.statusCode >= 400) logger.warn("request rejected", detail);
        else logger.info("request completed", detail);
      });

      next();
    });
  };
}

module.exports = { requestLogging, resolveRequestId, routeLabel };
