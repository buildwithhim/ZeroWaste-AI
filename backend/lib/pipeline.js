/**
 * The closed loop, described as data.
 *
 *   Booking → Prediction → Cooking → Consumption → Waste → Feedback →
 *   Model improvement → Next prediction → (back to Booking)
 *
 * Each stage declares what it consumes, what it produces and where that data
 * physically lives, so the pipeline is auditable rather than implied.
 */

const { readSignals } = require("./signals");

const STAGES = [
  {
    id: "booking",
    order: 1,
    name: "Booking",
    description: "Employees pre-book breakfast, lunch and snacks for each workday.",
    input: "Weekly menu",
    output: "Per-dish pre-order counts",
    store: "BookingContext (client) → /forecast query",
    owner: "Employee",
  },
  {
    id: "prediction",
    order: 2,
    name: "Prediction",
    description: "The trained model forecasts demand from weekday and menu family.",
    input: "Pre-orders, weekday, menu family",
    output: "Predicted orders",
    store: "data/model.pkl via backend/predict.py",
    owner: "Model",
  },
  {
    id: "cooking",
    order: 3,
    name: "Cooking",
    description: "Predicted orders are scaled by the learned portion multiplier into a cooking quantity.",
    input: "Predicted orders + portion multiplier",
    output: "Recommended servings and safety buffer",
    store: "GET /forecast → Kitchen page",
    owner: "Kitchen",
  },
  {
    id: "consumption",
    order: 4,
    name: "Consumption",
    description: "Meals are served and eaten; actual servings are compared with the forecast.",
    input: "Recommended servings",
    output: "Served meals",
    store: "Service records",
    owner: "Kitchen",
  },
  {
    id: "waste",
    order: 5,
    name: "Waste",
    description: "Uneaten food is quantified as a leftover rate per dish.",
    input: "Served meals vs. consumed meals",
    output: "Leftover rate, estimated waste in kg",
    store: "Derived in backend/lib/analytics.js",
    owner: "Kitchen",
  },
  {
    id: "feedback",
    order: 6,
    name: "Feedback",
    description: "Employees report Finished, Left some, Left most or Wanted more after a meal.",
    input: "One optional response per booked meal",
    output: "Pseudonymised feedback rows",
    store: "data/feedback.json",
    owner: "Employee",
  },
  {
    id: "model-improvement",
    order: 7,
    name: "Model improvement",
    description: "Feedback is aggregated into per-dish portion multipliers, shrunk toward 1.0 by sample size.",
    input: "Aggregated feedback (no identities)",
    output: "Learning signals",
    store: "data/feedback_signals.json",
    owner: "System",
  },
  {
    id: "next-prediction",
    order: 8,
    name: "Next prediction",
    description: "The next forecast applies the learned signals, closing the loop back to booking.",
    input: "Model output + learning signals",
    output: "Feedback-adjusted forecast",
    store: "GET /forecast",
    owner: "Model",
  },
];

/**
 * Attaches live metrics to each stage. Booking-side counts are supplied by the
 * caller because bookings are held client-side; everything else comes from the
 * server's own aggregated state.
 */
function buildPipeline({ bookings = 0, predictedOrders = 0, recommendedServings = 0 } = {}) {
  const signals = readSignals();
  const totalResponses = signals?.totalResponses ?? 0;
  const leftoverRate = signals?.global?.averageLeftoverRate ?? 0;
  const multiplier = signals?.global?.portionMultiplier ?? 1;
  const confidence = signals?.global?.signalConfidence ?? 0;
  const consumed = Math.round(recommendedServings * (1 - leftoverRate / 100));

  const metrics = {
    booking: { label: "Pre-orders", value: bookings, unit: "meals" },
    prediction: { label: "Predicted orders", value: predictedOrders, unit: "orders" },
    cooking: { label: "Recommended servings", value: recommendedServings, unit: "servings" },
    consumption: { label: "Estimated consumed", value: consumed, unit: "servings" },
    waste: { label: "Average leftover rate", value: leftoverRate, unit: "%" },
    feedback: { label: "Responses collected", value: totalResponses, unit: "responses" },
    "model-improvement": { label: "Portion multiplier", value: multiplier, unit: "x" },
    "next-prediction": { label: "Signal confidence", value: confidence, unit: "%" },
  };

  /**
   * A stage is "active" once real data has reached it. The learning stages are
   * keyed off response volume rather than their metric, because a multiplier of
   * 1.0 is the *absence* of a signal, not a non-zero reading.
   */
  const isActive = {
    booking: () => bookings > 0,
    prediction: () => predictedOrders > 0,
    cooking: () => recommendedServings > 0,
    consumption: () => consumed > 0,
    waste: () => totalResponses > 0,
    feedback: () => totalResponses > 0,
    "model-improvement": () => totalResponses > 0,
    "next-prediction": () => totalResponses > 0 && predictedOrders > 0,
  };

  const stages = STAGES.map((stage) => ({
    ...stage,
    metric: metrics[stage.id],
    status: isActive[stage.id]() ? "active" : "awaiting-data",
  }));

  return {
    generatedAt: new Date().toISOString(),
    loopClosed: totalResponses > 0 && multiplier !== 1,
    lastSignalRefresh: signals?.generatedAt ?? null,
    stages,
  };
}

module.exports = { STAGES, buildPipeline };
