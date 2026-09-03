/**
 * Shared vocabulary for operational planning.
 *
 * The old dashboard hard-coded its arithmetic inline: an 8% walk-in rate, a 3%
 * cancellation rate and a 4% safety buffer, all typed straight into JSX. Those
 * numbers are decisions about how much food to cook, so they belong in one
 * reviewable place -- and, where the data supports it, they are now measured
 * rather than assumed (see attendance.js and the buffer notes below).
 */

/**
 * Share of cooked food expected to be wasted, above which a dish is flagged.
 * Below LOW the plan is comfortable; at or above HIGH the kitchen should cut
 * the batch before service rather than after it.
 */
const RISK_THRESHOLDS = { low: 0.08, high: 0.2 };

const RISK_LEVELS = ["Low", "Medium", "High", "Unrated"];

/**
 * Service days of history for a dish before its waste risk is rated.
 *
 * Risk used to be graded on the planned counter share, which is
 * `buffer / (demand + buffer)` -- the portion multiplier cancels out, so it
 * carried no dish-specific information at all and every dish showed the same
 * rating. Worse, `buffer` is rounded up to at least 1 portion, so a dish with
 * demand of 3 was always "High" purely from rounding. Risk is now read from
 * what each dish has actually wasted at the counter, and dishes without that
 * history are honestly marked Unrated rather than given a number that only
 * looks like a measurement.
 */
const MIN_RISK_HISTORY_DAYS = 3;

/**
 * Fallback safety buffer, used only until the prediction log has enough graded
 * days to measure how far the forecast actually misses. Deliberately small: an
 * unmeasured buffer is a guess, and a large guess is exactly the habit that
 * produces the waste this system exists to remove.
 */
const DEFAULT_BUFFER_RATE = 0.04;

/** Ceiling on the measured buffer, so one chaotic day cannot flood the kitchen. */
const MAX_BUFFER_RATE = 0.15;

/**
 * Paired (booking, actual) observations required before a measured attendance
 * ratio is trusted on its own. Below this the ratio is blended toward the
 * broader population, then toward 1.0.
 */
const MIN_ATTENDANCE_SAMPLE = 3;

/** Prior strength for shrinking attendance ratios toward the fallback. */
const ATTENDANCE_SHRINKAGE_PRIOR = 4;

/** Rails on the attendance ratio, matching the spirit of MULTIPLIER_BOUNDS. */
const ATTENDANCE_BOUNDS = { min: 0.5, max: 1.6 };

/** Graded days required before a forecast-accuracy figure is published. */
const MIN_ACCURACY_SAMPLE = 3;

/**
 * How predicted demand for a dish was arrived at, surfaced to the UI so an
 * administrator can see whether a number rests on measurement or on a fallback.
 */
const DEMAND_BASIS = {
  DISH_HISTORY: "dish-history",
  FAMILY_HISTORY: "family-history",
  GLOBAL_HISTORY: "global-history",
  MODEL_SHARE: "model-share",
  BOOKINGS_ONLY: "bookings-only",
};

const DEMAND_BASIS_LABEL = {
  [DEMAND_BASIS.DISH_HISTORY]: "Measured turnout for this dish",
  [DEMAND_BASIS.FAMILY_HISTORY]: "Measured turnout for this menu family",
  [DEMAND_BASIS.GLOBAL_HISTORY]: "Measured turnout across the cafeteria",
  [DEMAND_BASIS.MODEL_SHARE]: "Forecasting model, split by booking share",
  [DEMAND_BASIS.BOOKINGS_ONLY]: "Pre-bookings only, no history yet",
};

const round = (value, places = 0) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Waste risk from the share of cooked food that actually went uneaten. */
function riskFromWasteShare(share) {
  if (!Number.isFinite(share) || share < 0) return "Unrated";
  if (share >= RISK_THRESHOLDS.high) return "High";
  if (share >= RISK_THRESHOLDS.low) return "Medium";
  return "Low";
}

module.exports = {
  RISK_THRESHOLDS,
  RISK_LEVELS,
  MIN_RISK_HISTORY_DAYS,
  DEFAULT_BUFFER_RATE,
  MAX_BUFFER_RATE,
  MIN_ATTENDANCE_SAMPLE,
  ATTENDANCE_SHRINKAGE_PRIOR,
  ATTENDANCE_BOUNDS,
  MIN_ACCURACY_SAMPLE,
  DEMAND_BASIS,
  DEMAND_BASIS_LABEL,
  riskFromWasteShare,
  round,
  clamp,
};
