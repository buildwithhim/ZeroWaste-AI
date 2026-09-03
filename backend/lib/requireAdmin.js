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
 */

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "zerowaste-local-admin-token";

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
  const expected = ADMIN_TOKEN;
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

module.exports = { adminGate, ADMIN_TOKEN, presentedToken, tokenMatches };
