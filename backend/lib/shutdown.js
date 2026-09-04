/**
 * Graceful shutdown.
 *
 * WHY THE ORDER MATTERS
 * ---------------------
 * When an orchestrator replaces a container it sends SIGTERM and starts a
 * countdown; when the countdown expires it sends SIGKILL. Exiting immediately
 * on SIGTERM drops every request in flight, which during a rolling deploy shows
 * up as a burst of 502s -- an invoice import abandoned midway, a booking save
 * that never landed.
 *
 * The sequence below exists because the obvious version (close the server, then
 * exit) is still wrong: a load balancer does not learn about the closed port
 * instantly, so requests keep arriving for a second or two after and are
 * refused. So readiness is failed *first*, giving the balancer a chance to
 * remove this instance while it is still able to serve, and only then is the
 * listener closed.
 *
 *   1. Fail readiness. New traffic stops being routed here.
 *   2. Wait out the drain delay, so in-flight routing decisions land somewhere
 *      that can still answer them.
 *   3. Stop accepting connections; let the ones already open finish.
 *   4. Close the database pool and any storage clients.
 *   5. Exit.
 *
 * A hard deadline covers step 3 hanging on a long-lived connection. It has to
 * be shorter than the orchestrator's termination grace period, or the process
 * is SIGKILLed mid-cleanup and the whole sequence was pointless.
 */

const { setAcceptingTraffic } = require("./health");
const { logger } = require("./logger");
const db = require("./db/pool");
const objectStorage = require("./storage/objectStore");

/** How long to keep serving after failing readiness, so routing can catch up. */
const DEFAULT_DRAIN_DELAY_MS = 3000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wires shutdown handling onto a listening server.
 *
 * Returns the shutdown function so a test can drive it directly rather than
 * signalling the process running the test.
 */
function installGracefulShutdown(server, options = {}) {
  const graceMs = options.graceMs ?? 15000;
  const drainDelayMs = options.drainDelayMs ?? (options.isProduction ? DEFAULT_DRAIN_DELAY_MS : 0);
  const exit = options.exit || ((code) => process.exit(code));

  let shuttingDown = false;

  // Track sockets so keep-alive connections can be closed at the deadline.
  // Without this, `server.close()` waits for an idle keep-alive client that may
  // never send anything, and the deadline is reached every time.
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  async function shutdown(signal) {
    // A second signal during shutdown means somebody is impatient; honour it
    // rather than ignoring it, but say so.
    if (shuttingDown) {
      logger.warn("second shutdown signal, exiting immediately", { signal });
      return exit(1);
    }
    shuttingDown = true;

    logger.info("shutdown started", { signal, graceMs, drainDelayMs });

    // 1 & 2: stop being routed to, then let routing catch up.
    setAcceptingTraffic(false);
    if (drainDelayMs > 0) await wait(drainDelayMs);

    // A deadline for the whole of the rest, so a stuck connection or a database
    // that will not close cannot hold the process open until SIGKILL.
    const deadline = setTimeout(() => {
      logger.error("shutdown deadline exceeded, forcing exit", { graceMs, openSockets: sockets.size });
      for (const socket of sockets) socket.destroy();
      exit(1);
    }, graceMs);
    deadline.unref?.();

    try {
      // 3: stop accepting, let in-flight requests finish.
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // Idle keep-alive sockets are not requests in flight, so they are
        // closed straight away. Node 18+ does this itself via closeIdle-
        // Connections; calling it explicitly keeps the behaviour on older
        // runtimes and makes the intent visible.
        server.closeIdleConnections?.();
      });
      logger.info("http server closed");

      // 4: release resources. Settled rather than sequential so one failing
      // close does not skip the others.
      const closes = await Promise.allSettled([db.close(), objectStorage.close()]);
      for (const result of closes) {
        if (result.status === "rejected") logger.error("resource close failed", { error: result.reason });
      }

      clearTimeout(deadline);
      logger.info("shutdown complete");
      exit(0);
    } catch (error) {
      clearTimeout(deadline);
      logger.error("shutdown failed", { error });
      exit(1);
    }
  }

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }

  /**
   * A process that has thrown an unhandled exception is in an unknown state and
   * must not keep serving. It is logged and shut down through the same path, so
   * the requests already in flight still get an answer.
   */
  process.on("uncaughtException", (error) => {
    logger.error("uncaught exception", { error });
    void shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled rejection", { error: reason instanceof Error ? reason : new Error(String(reason)) });
  });

  return shutdown;
}

module.exports = { installGracefulShutdown, DEFAULT_DRAIN_DELAY_MS };
