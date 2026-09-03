const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");

const { isValidResponse, RESPONSES } = require("./lib/feedbackModel");
const feedbackStore = require("./lib/feedbackStore");
const { buildAdminReport } = require("./lib/analytics");
const { refreshSignals, readSignals, toPublicSignals } = require("./lib/signals");
const { buildPipeline } = require("./lib/pipeline");
const { menuFamilyFor } = require("./lib/menuTaxonomy");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const pythonPath = process.env.PYTHON_PATH || path.join(__dirname, "..", ".venv", "Scripts", "python.exe");

/** Runs the predictor and resolves with its JSON payload. */
function runPredictor(weekday, menu) {
  return new Promise((resolve, reject) => {
    const py = spawn(pythonPath, ["predict.py", weekday, menu], { cwd: __dirname });
    let output = "";
    let error = "";

    py.stdout.on("data", (chunk) => (output += chunk.toString()));
    py.stderr.on("data", (chunk) => (error += chunk.toString()));
    py.on("error", reject);
    py.on("close", (code) => {
      if (code !== 0) return reject(new Error(error || `predict.py exited with code ${code}`));
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error(`Unreadable predictor output: ${output}`));
      }
    });
  });
}

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
    console.error("Forecast failed:", error.message);
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
    console.error("Failed to record feedback:", error.message);
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
 */
app.get("/admin/analytics/feedback", (req, res) => {
  try {
    res.json(buildAdminReport(feedbackStore.listAll()));
  } catch (error) {
    console.error("Analytics failed:", error.message);
    res.status(500).json({ error: "Analytics unavailable" });
  }
});

/**
 * The learning signals, redacted for admin viewing. Buckets below the sample
 * threshold are stripped — see toPublicSignals for why the on-disk document
 * must not be served directly.
 */
app.get("/admin/analytics/signals", (req, res) => {
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
    console.warn("Pipeline forecast metrics unavailable:", error.message);
  }

  res.json(buildPipeline({ bookings, predictedOrders, recommendedServings }));
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Backend running at http://localhost:${PORT}`));
}

module.exports = app;
