/**
 * Shared administrator gate.
 *
 * SCOPE AND LIMITS
 * ----------------
 * This application has no user directory or session layer yet, so this is a
 * shared-secret check rather than real authentication: it confirms the caller
 * holds the admin token, not who they are. It exists so every admin-only route
 * decides access in one explicit place, and so no employee-facing route can
 * reach admin data by accident.
 *
 * Replace `tokenMatches` with the real identity check when SSO lands -- the
 * route layers should not need to change.
 *
 * THE TOKEN IS NOT A SECRET IN DEVELOPMENT
 * ----------------------------------------
 * The default below is committed to this repository and is also compiled into
 * the frontend bundle, so in a development build "holding the admin token" means
 * nothing at all. That is finding C2 of the security audit and is not fixed
 * here. What is enforced is that it cannot reach production: lib/config.js
 * refuses to boot with NODE_ENV=production while ADMIN_TOKEN is still this
 * value. See docs/DEPLOYMENT.md, which lists C1 and C2 as go-live blockers.
 */

const { readConfig } = require("./config");

/**
 * Resolved per call rather than at import, so a test that sets ADMIN_TOKEN
 * after this module is first required is not silently ignored.
 */
const adminToken = () => readConfig().security.adminToken;

/** Reads the token from the header, falling back to a bearer authorization. */
function presentedToken(req) {
  const header = req.get("x-admin-token");
  if (header) return header.trim();

  const auth = req.get("authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  return bearer ? bearer[1].trim() : "";
}

/** Constant-time comparison so the token cannot be recovered by timing. */
function tokenMatches(presented) {
  const expected = adminToken();
  if (presented.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < presented.length; i += 1) {
    mismatch |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Builds the middleware, so each area can name the data it protects. */
function adminGate(message = "Administrator access is required") {
  return function requireAdmin(req, res, next) {
    if (!tokenMatches(presentedToken(req))) return res.status(403).json({ error: message });

    // Label for the audit trail. Once real auth exists this becomes the user id.
    req.actor = req.get("x-admin-actor")?.slice(0, 120) || "admin";
    next();
  };
}

module.exports = {
  adminGate,
  presentedToken,
  tokenMatches,
  adminToken,
  /** Kept as a getter so existing importers see the live value, not a snapshot. */
  get ADMIN_TOKEN() {
    return adminToken();
  },
};
