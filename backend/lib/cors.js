/**
 * Cross-origin policy.
 *
 * `app.use(cors())` -- the previous configuration -- sends
 * `Access-Control-Allow-Origin: *` to every caller. That is finding H1 of the
 * security audit, and it means any page on the internet can make a user's
 * browser call this API and read the response. For the employee routes, which
 * take an `employeeId` as a plain query parameter, that is a one-line script on
 * an attacker's site away from reading someone's bookings.
 *
 * Production is therefore given an explicit allowlist, and `config.js` refuses
 * to boot without one. Development keeps the permissive behaviour, because the
 * Vite dev server, the Playwright harness and the occasional `curl` all sit on
 * different origins and none of them are exposed.
 *
 * WHY THE ALLOWLIST IS A FUNCTION
 * -------------------------------
 * The `origin` callback form echoes back the request's own origin when it is on
 * the list, rather than sending the list. That is required for the header to be
 * meaningful -- `Access-Control-Allow-Origin` may name exactly one origin --
 * and it means an origin that is not on the list receives no CORS headers at
 * all, so the browser blocks the response.
 */

const cors = require("cors");

const { readConfig } = require("./config");
const { logger } = require("./logger");

/** Headers the browser is allowed to send. Keep in step with the frontend. */
const ALLOWED_HEADERS = ["Content-Type", "Authorization", "X-Admin-Token", "X-Admin-Actor", "X-Request-Id"];

/** Headers the browser is allowed to read off the response. */
const EXPOSED_HEADERS = ["Content-Disposition", "X-Request-Id"];

function corsOptions(config = readConfig()) {
  const { allowedOrigins, allowAll, allowCredentials } = config.cors;

  return {
    origin(origin, callback) {
      // No Origin header: same-origin navigation, curl, or a server-to-server
      // call. There is no browser to protect, so there is nothing to decide.
      if (!origin) return callback(null, true);

      if (allowAll) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);

      logger.warn("cors origin rejected", { origin });
      // Resolving false rather than erroring omits the CORS headers and lets
      // the request continue; the browser then blocks it. Erroring here would
      // turn a policy decision into a 500 in the application's error path.
      return callback(null, false);
    },
    credentials: allowCredentials,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS,
    maxAge: 600,
  };
}

/** The configured CORS middleware. */
const corsMiddleware = (config = readConfig()) => cors(corsOptions(config));

module.exports = { corsMiddleware, corsOptions, ALLOWED_HEADERS, EXPOSED_HEADERS };
