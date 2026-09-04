/**
 * Structured application logging.
 *
 * `console.error("Forecast failed:", error.message)` is fine on a terminal and
 * useless in production: there is no level to filter on, no timestamp, no way
 * to tie a line to the request that produced it, and no structure for a log
 * shipper to index. Worse, an unstructured logger invites interpolating
 * whatever is to hand into the message -- which is how employee identifiers and
 * admin tokens end up in a log aggregator that a much wider group can read.
 *
 * This module emits one JSON object per line in production and a readable line
 * in development, and it redacts on the way out rather than trusting every call
 * site to remember.
 *
 * WHAT IS REDACTED, AND WHY IT IS DONE HERE
 * -----------------------------------------
 * The application's whole privacy contract is that an employee identifier is
 * hashed on write and never leaves the aggregation layer. A log line is a way
 * out of that contract that no route-level review would catch. Redaction is
 * therefore applied centrally to any key matching the sensitive set, at any
 * depth, so a new call site cannot leak by omission.
 */

const { LOG_LEVELS, readConfig } = require("./config");

const LEVEL_RANK = Object.fromEntries(LOG_LEVELS.map((level, index) => [level, index]));

/**
 * Keys whose values never belong in a log.
 *
 * `employeeId` is the raw identifier the client sends; `employeeHash` is the
 * pseudonym. Both are redacted: the hash is stable, so a log full of hashes is
 * still a per-person activity trail.
 */
const SENSITIVE_KEYS = new Set([
  "admintoken",
  "admin_token",
  "authorization",
  "cookie",
  "employeehash",
  "employeeid",
  "feedbackhashsalt",
  "hashsalt",
  "password",
  "salt",
  "secret",
  "secretaccesskey",
  "token",
  "x-admin-token",
]);

const REDACTED = "[redacted]";
const MAX_DEPTH = 6;

/** Recursively replaces sensitive values. Cycles and depth are handled. */
function redact(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redact(item, depth + 1, seen);
  }
  return output;
}

/**
 * Async-local storage for the current request's correlation id.
 *
 * Threading a logger through every function signature would touch code that
 * has nothing to do with logging, so the request context is carried out of
 * band. `AsyncLocalStorage` is the only mechanism that survives an `await`
 * without that plumbing.
 */
const { AsyncLocalStorage } = require("node:async_hooks");

const requestContext = new AsyncLocalStorage();

/** Runs `fn` with `context` attached to every log line it produces. */
function withContext(context, fn) {
  return requestContext.run({ ...(requestContext.getStore() || {}), ...context }, fn);
}

const currentContext = () => requestContext.getStore() || {};

function formatPretty(record) {
  const { level, msg, time, ...rest } = record;
  const detail = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
  return `${time} ${level.toUpperCase().padEnd(5)} ${msg}${detail}`;
}

/**
 * Builds a logger. `bindings` are merged into every line, which is how a
 * module-scoped logger labels its own output without repeating itself.
 */
function createLogger(bindings = {}, options = {}) {
  // Resolved per call so a test that changes LOG_LEVEL after import is not
  // silently ignored, and so a logger created at module load in one
  // environment still behaves correctly in another.
  const settings = () => {
    const config = options.config || readConfig();
    return config.logging;
  };

  function emit(level, msg, detail) {
    const { level: threshold, format, silent, serviceName, version } = settings();
    if (silent || LEVEL_RANK[level] < LEVEL_RANK[threshold]) return;

    const record = {
      time: new Date().toISOString(),
      level,
      service: serviceName,
      version,
      msg: String(msg),
      ...redact({ ...bindings, ...currentContext(), ...(detail || {}) }),
    };

    const line = format === "json" ? JSON.stringify(record) : formatPretty(record);
    // Warnings and errors go to stderr so a container runtime and any
    // log-based alerting can separate them without parsing.
    const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  }

  const logger = {
    debug: (msg, detail) => emit("debug", msg, detail),
    info: (msg, detail) => emit("info", msg, detail),
    warn: (msg, detail) => emit("warn", msg, detail),
    error: (msg, detail) => emit("error", msg, detail),
    /** A logger carrying additional permanent fields. */
    child: (extra) => createLogger({ ...bindings, ...extra }, options),
  };

  return logger;
}

const logger = createLogger();

module.exports = { createLogger, logger, withContext, currentContext, redact, SENSITIVE_KEYS, REDACTED };
