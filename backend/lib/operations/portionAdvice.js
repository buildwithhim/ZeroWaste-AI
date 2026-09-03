/**
 * Smart Plate advice: which plate size to suggest to an employee for a dish.
 *
 * The employee UI used to render a fixed "AI recommended" badge on the Regular
 * option for every dish. That was not a recommendation, it was decoration --
 * the same label appeared whether people had been leaving half the biryani or
 * asking for seconds. This module turns the portion multiplier the feedback
 * loop already learns into an actual suggestion.
 *
 * PRIVACY
 * -------
 * This is a public endpoint, so it is held to a stricter rule than the planner.
 * The planner may read thin buckets internally as long as it does not return
 * them; here every number is returned, so a bucket is only used once it clears
 * MIN_DISH_SAMPLE, walking dish -> menu family -> cafeteria. Nothing about an
 * individual's answers is derivable: a plate size is one of three labels, the
 * sample count published alongside it is the same aggregate count the admin
 * analytics already expose, and below the threshold the response says so
 * instead of guessing.
 *
 * When no bucket qualifies the advice is explicitly marked as a default rather
 * than dressed up as a recommendation, which is the same rule the admin
 * dashboard follows for un-gradeable forecasts.
 */

const { readSignals } = require("../signals");
const { MIN_DISH_SAMPLE } = require("../feedbackModel");
const { listMenu } = require("./menu");

/**
 * Plate sizes offered to employees. `multiplier` is the share of a standard
 * serving, and is what the learned portion multiplier is matched against.
 * Kept server-side so the plate the employee picks and the portion the planner
 * costs it at cannot drift apart.
 */
const PLATE_SIZES = [
  { name: "Light", grams: 220, multiplier: 0.72, description: "A smaller plate for a lighter day" },
  { name: "Regular", grams: 320, multiplier: 1, description: "A balanced everyday serving" },
  { name: "Heavy", grams: 420, multiplier: 1.28, description: "A fuller plate for a bigger appetite" },
];

const DEFAULT_PLATE = "Regular";

/** The plate whose multiplier sits closest to the learned one. */
function nearestPlate(multiplier) {
  return PLATE_SIZES.reduce((best, plate) =>
    Math.abs(plate.multiplier - multiplier) < Math.abs(best.multiplier - multiplier) ? plate : best
  );
}

/**
 * Reads the portion multiplier from the most specific bucket that clears the
 * reporting threshold. Returns `null` when nothing qualifies, so the caller has
 * to decide what to say rather than silently receiving a 1.0 it cannot
 * distinguish from a real measurement.
 */
function resolveMultiplier(signals, dish, family) {
  const buckets = [
    { level: "dish", bucket: signals?.byDish?.[dish] },
    { level: "menu-family", bucket: signals?.byMenuFamily?.[family] },
  ];

  for (const { level, bucket } of buckets) {
    if (bucket && bucket.responses >= MIN_DISH_SAMPLE && Number.isFinite(bucket.portionMultiplier)) {
      return { multiplier: bucket.portionMultiplier, level, responses: bucket.responses };
    }
  }

  const global = signals?.global;
  if (global && Number.isFinite(global.portionMultiplier) && signals?.totalResponses >= MIN_DISH_SAMPLE) {
    return { multiplier: global.portionMultiplier, level: "cafeteria", responses: signals.totalResponses };
  }

  return null;
}

/** Plain-language reason, so the employee is told where the advice came from. */
function explain(level, responses, plate) {
  if (level === "dish") return `${responses} diners rated this dish, and ${plate.name.toLowerCase()} plates matched their appetite best.`;
  if (level === "menu-family") return `Based on ${responses} ratings for similar dishes.`;
  if (level === "cafeteria") return `Based on ${responses} ratings across the cafeteria.`;
  return "Not enough ratings yet, so this is the standard serving.";
}

/**
 * Advice for every dish on the menu.
 *
 * `measured` separates a learned suggestion from the fallback default. The UI
 * uses it to decide between "AI recommended" and "standard serving", so the two
 * are never presented as the same claim.
 */
function buildPortionAdvice() {
  const signals = readSignals();

  const advice = listMenu().map((item) => {
    const resolved = resolveMultiplier(signals, item.dish, item.menuFamily);
    const plate = resolved ? nearestPlate(resolved.multiplier) : PLATE_SIZES.find((size) => size.name === DEFAULT_PLATE);

    return {
      dish: item.dish,
      recommendedPlate: plate.name,
      measured: Boolean(resolved),
      basis: resolved?.level ?? "none",
      responses: resolved?.responses ?? 0,
      reason: explain(resolved?.level ?? "none", resolved?.responses ?? 0, plate),
    };
  });

  return { plateSizes: PLATE_SIZES.map((plate) => ({ ...plate })), minSample: MIN_DISH_SAMPLE, advice };
}

module.exports = { PLATE_SIZES, DEFAULT_PLATE, buildPortionAdvice };
