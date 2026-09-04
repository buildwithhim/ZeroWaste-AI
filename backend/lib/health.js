/**
 * Health endpoints.
 *
 * THREE ENDPOINTS, THREE DIFFERENT QUESTIONS
 * ------------------------------------------
 * `/health/live` asks "is this process alive". It checks nothing else, on
 * purpose. A liveness probe that fails when Postgres is unreachable makes the
 * orchestrator restart a perfectly healthy container -- which cannot fix
 * Postgres, and converts a dependency outage into a crash loop across every
 * replica at once.
 *
 * `/health/ready` asks "should this instance receive traffic". It checks the
 * dependencies a request actually needs, and returning 503 takes the instance
 * out of the load balancer's rotation while leaving it running, so it rejoins
 * by itself when the dependency recovers.
 *
 * `/health` is the original endpoint and stays as it was, because the
 * end-to-end harness and any existing monitor already call it.
 *
 * WHAT THE RESPONSE MAY SAY
 * -------------------------
 * Readiness output names dependencies and their status. It does not include
 * connection strings, credentials, or the resolved value of any secret --
 * `describeConfig` reports whether a secret is configured, never what it is. The
 * endpoint is unauthenticated, because a probe cannot hold a credential, so
 * everything it returns should be treated as public.
 */

const express = require("express");

const { readConfig, describeConfig } = require("./config");
const db = require("./db/pool");
const objectStorage = require("./storage/objectStore");
const aiService = require("./aiService");
const { logger } = require("./logger");

/** Set false by the shutdown sequence so readiness fails before the port closes. */
let acceptingTraffic = true;

const setAcceptingTraffic = (value) => {
  acceptingTraffic = Boolean(value);
};

/**
 * Runs every check, even when one fails.
 *
 * Stopping at the first failure would report one broken dependency at a time
 * and turn diagnosis into a sequence of restarts.
 */
async function runChecks(config) {
  const settled = await Promise.allSettled([
    db.checkHealth(config),
    objectStorage.checkHealth(config),
    aiService.checkHealth(config),
  ]);

  return settled.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : {
          name: ["postgres", "storage", "ai-service"][index],
          status: "error",
          detail: result.reason?.message || "check threw",
        }
  );
}

function healthRoutes() {
  const router = express.Router();
  const startedAt = Date.now();

  router.get("/health/live", (req, res) => {
    res.json({ status: "ok", uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
  });

  router.get("/health/ready", async (req, res) => {
    const config = readConfig();

    if (!acceptingTraffic) {
      // Draining. Reported before the checks run, because the answer is "stop
      // sending traffic" regardless of how healthy the dependencies are.
      return res.status(503).json({ status: "draining", checks: [] });
    }

    const checks = await runChecks(config);
    // "skipped" is a deliberate configuration -- no DATABASE_URL means the JSON
    // stores are the system of record -- and must not fail readiness.
    const failed = checks.filter((check) => check.status === "error");

    if (failed.length) {
      logger.warn("readiness check failed", { failed: failed.map((check) => check.name) });
    }

    res.status(failed.length ? 503 : 200).json({
      status: failed.length ? "unavailable" : "ok",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      checks,
    });
  });

  /**
   * Build and configuration information, for confirming what is actually
   * deployed. Secrets are reported as booleans by describeConfig; nothing here
   * returns a value that would help a caller authenticate.
   */
  router.get("/health/info", (req, res) => {
    res.json(describeConfig(readConfig()));
  });

  // The original endpoint. Unchanged shape.
  router.get("/health", (req, res) => res.json({ status: "ok" }));

  return router;
}

module.exports = { healthRoutes, setAcceptingTraffic, runChecks };
