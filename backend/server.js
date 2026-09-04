const express = require("express");

const { isValidResponse, RESPONSES } = require("./lib/feedbackModel");
const feedbackStore = require("./lib/feedbackStore");
const { buildAdminReport } = require("./lib/analytics");
const { refreshSignals, readSignals, toPublicSignals } = require("./lib/signals");
const { buildPipeline } = require("./lib/pipeline");
const { menuFamilyFor } = require("./lib/menuTaxonomy");
const { adminGate } = require("./lib/requireAdmin");
const invoiceRoutes = require("./lib/invoices/routes");
const { adminRouter: operationsAdminRoutes, publicRouter: operationsPublicRoutes } = require("./lib/operations/routes");

const { readConfig, loadConfig, describeConfig, ConfigurationError } = require("./lib/config");
const { corsMiddleware } = require("./lib/cors");
const { requestLogging } = require("./lib/requestLogging");
const { healthRoutes } = require("./lib/health");
const { installGracefulShutdown } = require("./lib/shutdown");
const aiService = require("./lib/aiService");
const { logger } = require("./lib/logger");

const config = readConfig();

const app = express();

// Behind an ingress or load balancer the client address is in X-Forwarded-For.
// Trusting it when nothing sets it lets a client claim any address it likes,
// so this is opt-in through TRUST_PROXY.
if (config.server.trustProxy) app.set("trust proxy", true);

// Express advertises itself in every response by default. Naming the framework
// tells a scanner which vulnerability list to try first, and tells a legitimate
// user nothing.
app.disable("x-powered-by");

app.use(requestLogging());
app.use(corsMiddleware(config));
// Bounded so a large body cannot be used to exhaust memory. Invoice uploads go
// through multer with its own limits and are unaffected.
app.use(express.json({ limit: config.server.bodyLimit }));

/**
 * Liveness, readiness and build information.
 *
 * Mounted first, and ahead of every guard, because a probe cannot present a
 * credential and a health check that depends on the rest of the application
 * being healthy is not a health check.
 */
app.use(healthRoutes());

/**
 * SmartQ invoice ingestion. Mounted as a unit so the admin guard inside the
 * router covers every invoice route; nothing outside this prefix reads invoice
 * data.
 */
app.use("/admin/invoices", invoiceRoutes);

/**
 * Cafeteria operations. The admin half answers "how much should we cook today"
 * and is gated inside its own router; the public half carries the menu and an
 * employee's own bookings, which is why it is mounted separately rather than
 * behind the same guard.
 *
 * Both halves sit under an /operations prefix. The public half was briefly
 * mounted at "/", which silently broke booking sync — the client posted to
 * /operations/bookings and got the 404 handler, so every saved meal plan was
 * dropped and the admin's pre-booking count never moved.
 */
app.use("/admin/operations", operationsAdminRoutes);
app.use("/operations", operationsPublicRoutes);

/** Runs the predictor and resolves with its JSON payload. */
const runPredictor = (weekday, menu) => aiService.predictOne(weekday, menu);

/**
 * Stages 2, 3 and 8: prediction, cooking quantity, and the feedback adjustment
 * that makes this forecast different from the last one.
 */
app.get("/forecast", async (req, res) => {
  const weekday = req.query.day || "Friday";
  const menu = req.query.menu || "Biryani";

  try {
    const result = await runPredictor(weekday, menu);
    const recommendedServings = result.recommendedServings ?? result.prediction;

    res.json({
      predictedOrders: result.prediction,
      basePredictedOrders: result.basePrediction ?? result.prediction,
      recommendedServings,
      portionMultiplier: result.portionMultiplier ?? 1,
      feedbackResponses: result.feedbackResponses ?? 0,
      feedbackApplied: Boolean(result.feedbackApplied),
      adjustmentReason: result.adjustmentReason ?? "No feedback available yet",
      confidence: result.confidence ?? 94,
      foodSavedKg: Math.round(recommendedServings * 0.053),
      workerMeals: Math.round(recommendedServings * 0.106),
      menuFamily: menu,
      weekday,
    });
  } catch (error) {
    logger.error("forecast failed", { error });
    res.status(500).json({ error: "Forecast unavailable" });
  }
});

/**
 * Stage 6: capture feedback. The response is pseudonymised on write and the
 * learning signals are refreshed immediately so the next forecast benefits.
 */
app.post("/feedback", (req, res) => {
  const { employeeId, bookingId, dish, category, weekday, response, servedOn, portionSize } = req.body || {};

  if (!bookingId || !dish) return res.status(400).json({ error: "bookingId and dish are required" });
  if (!isValidResponse(response)) return res.status(400).json({ error: `response must be one of: ${RESPONSES.join(", ")}` });

  try {
    const entry = feedbackStore.saveFeedback({ employeeId, bookingId, dish, category, weekday, response, servedOn, portionSize });
    const signals = refreshSignals(feedbackStore.listAll());
    const dishSignal = signals.byDish[dish];

    // Echo back only the submitter's own response, plus aggregate context.
    res.status(201).json({
      recorded: { bookingId: entry.bookingId, dish: entry.dish, response: entry.response, servedOn: entry.servedOn },
      impact: {
        totalResponses: signals.totalResponses,
        dishPortionMultiplier: dishSignal?.portionMultiplier ?? signals.global.portionMultiplier,
        menuFamily: menuFamilyFor(dish),
      },
    });
  } catch (error) {
    logger.error("failed to record feedback", { error });
    res.status(500).json({ error: "Could not record feedback" });
  }
});

/** An employee may read back only their own responses. */
app.get("/feedback/me", (req, res) => {
  const employeeId = req.query.employeeId;
  if (!employeeId) return res.status(400).json({ error: "employeeId is required" });
  res.json({ feedback: feedbackStore.listForEmployee(employeeId) });
});

/**
 * Stages 5 and 6, reported for administrators.
 *
 * This route reads raw rows but returns only the aggregate report. There is
 * deliberately no endpoint anywhere that lists individual responses to an admin.
 *
 * Guarded like the rest of /admin. Sitting under the /admin prefix is a naming
 * convention, not a control: without the gate these two routes were reachable
 * by anyone who knew the path, which put an admin-only surface one fetch away
 * from the employee bundle.
 */
app.get("/admin/analytics/feedback", adminGate("Administrator access is required for feedback analytics"), (req, res) => {
  try {
    res.json(buildAdminReport(feedbackStore.listAll()));
  } catch (error) {
    logger.error("analytics failed", { error });
    res.status(500).json({ error: "Analytics unavailable" });
  }
});

/**
 * The learning signals, redacted for admin viewing. Buckets below the sample
 * threshold are stripped — see toPublicSignals for why the on-disk document
 * must not be served directly.
 */
app.get("/admin/analytics/signals", adminGate("Administrator access is required for learning signals"), (req, res) => {
  const fallback = { version: 1, totalResponses: 0, global: { portionMultiplier: 1 }, byDish: {}, byMenuFamily: {}, byWeekday: {}, weeklyTrend: [] };
  res.json(toPublicSignals(readSignals()) ?? fallback);
});

/** End-to-end view of the loop, with live metrics on each stage. */
app.get("/pipeline", async (req, res) => {
  const bookings = Number(req.query.bookings) || 0;
  const weekday = req.query.day || "Friday";
  const menu = req.query.menu || "Biryani";

  let predictedOrders = 0;
  let recommendedServings = 0;
  try {
    const result = await runPredictor(weekday, menu);
    predictedOrders = result.prediction;
    recommendedServings = result.recommendedServings ?? result.prediction;
  } catch (error) {
    logger.warn("pipeline forecast metrics unavailable", { error });
  }

  res.json(buildPipeline({ bookings, predictedOrders, recommendedServings }));
});

/**
 * Boot.
 *
 * Configuration is validated before the port is opened. In production an
 * invalid configuration is fatal: exiting with the list of problems makes a
 * misconfigured rollout fail visibly, where booting anyway with a committed
 * default admin token would fail silently and much later.
 */
function start() {
  let validated;
  try {
    validated = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      logger.error("refusing to start with an invalid configuration", { problems: error.problems });
      return process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const server = app.listen(validated.server.port, validated.server.host, () => {
    logger.info("backend listening", describeConfig(validated));
  });

  // Slowloris: a client that opens a connection and sends headers a byte at a
  // time holds a socket open indefinitely. Node's defaults are generous.
  server.headersTimeout = 20000;
  server.requestTimeout = 60000;
  // Must exceed the load balancer's idle timeout, or the balancer will reuse a
  // connection this process is closing and the client sees a 502.
  server.keepAliveTimeout = 65000;

  installGracefulShutdown(server, {
    graceMs: validated.server.shutdownGraceMs,
    isProduction: validated.isProduction,
  });

  return server;
}

if (require.main === module) {
  start();
}

module.exports = app;
module.exports.start = start;
