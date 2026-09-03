/**
 * Turnout: how pre-bookings translate into people actually served.
 *
 * The previous dashboard assumed a flat 8% walk-in uplift and 3% cancellation
 * rate, typed inline. Both are measurable once bookings and close-of-service
 * actuals are recorded against the same dates, so this module measures them
 * instead of assuming them.
 *
 * The ratio is served / pre-booked, computed over dates that have both. A value
 * above 1 means walk-ins outnumber no-shows for that dish; below 1 means the
 * reverse. Thin evidence is shrunk toward the broader population (dish → menu
 * family → cafeteria-wide → 1.0) so a single observed day cannot swing a
 * cooking decision, and every returned ratio says which level it came from.
 */

const bookingStore = require("./bookingStore");
const serviceLog = require("./serviceLog");
const { findDish } = require("./menu");
const {
  MIN_ATTENDANCE_SAMPLE,
  ATTENDANCE_SHRINKAGE_PRIOR,
  ATTENDANCE_BOUNDS,
  DEMAND_BASIS,
  round,
  clamp,
} = require("./operationsModel");

/**
 * Pairs bookings with actuals across every date holding both.
 *
 * `upTo` excludes the day being planned, so today's own partial service can
 * never be used to predict today.
 */
function collectObservations({ upTo = null } = {}) {
  const perDish = new Map();
  const perFamily = new Map();
  const global = { booked: 0, served: 0, observations: 0 };

  for (const dateKey of serviceLog.recordedDates()) {
    if (upTo && dateKey >= upTo) continue;

    const booked = bookingStore.countsByDish(dateKey);
    for (const entry of serviceLog.listForDate(dateKey)) {
      const preBooked = booked.get(entry.dish) || 0;
      // A zero-booking day carries no ratio information and would divide by zero.
      if (preBooked <= 0) continue;

      const dish = perDish.get(entry.dish) || { booked: 0, served: 0, observations: 0 };
      dish.booked += preBooked;
      dish.served += entry.servedPortions;
      dish.observations += 1;
      perDish.set(entry.dish, dish);

      const familyName = findDish(entry.dish)?.menuFamily || "Unknown";
      const family = perFamily.get(familyName) || { booked: 0, served: 0, observations: 0 };
      family.booked += preBooked;
      family.served += entry.servedPortions;
      family.observations += 1;
      perFamily.set(familyName, family);

      global.booked += preBooked;
      global.served += entry.servedPortions;
      global.observations += 1;
    }
  }

  return { perDish, perFamily, global };
}

/** Shrinks an observed ratio toward `fallback` in proportion to its evidence. */
function shrink(bucket, fallback) {
  if (!bucket || !bucket.booked) return { ratio: fallback, observations: 0, confidence: 0 };
  const raw = bucket.served / bucket.booked;
  const confidence = bucket.observations / (bucket.observations + ATTENDANCE_SHRINKAGE_PRIOR);
  const blended = fallback + (raw - fallback) * confidence;
  return {
    ratio: clamp(blended, ATTENDANCE_BOUNDS.min, ATTENDANCE_BOUNDS.max),
    observations: bucket.observations,
    confidence: round(confidence * 100, 1),
    rawRatio: round(raw, 3),
  };
}

/**
 * Builds a lookup that answers "what turnout should I expect for this dish".
 *
 * Returns a `for(dish)` function so the planner resolves every dish against one
 * consistent snapshot of history rather than re-reading the stores per dish.
 */
function buildAttendanceModel({ upTo = null } = {}) {
  const { perDish, perFamily, global } = collectObservations({ upTo });

  const globalModel = shrink(global, 1);
  const globalRatio = global.observations ? globalModel.ratio : 1;

  return {
    global: {
      ratio: round(globalRatio, 3),
      observations: global.observations,
      confidence: globalModel.confidence,
      measured: global.observations > 0,
    },
    for(dish) {
      const familyName = findDish(dish)?.menuFamily || "Unknown";
      const familyBucket = perFamily.get(familyName);
      const familyModel = shrink(familyBucket, globalRatio);

      const dishBucket = perDish.get(dish);
      if (dishBucket && dishBucket.observations >= MIN_ATTENDANCE_SAMPLE) {
        const model = shrink(dishBucket, familyModel.ratio);
        return { ...model, ratio: round(model.ratio, 3), basis: DEMAND_BASIS.DISH_HISTORY };
      }

      if (familyBucket && familyBucket.observations >= MIN_ATTENDANCE_SAMPLE) {
        return { ...familyModel, ratio: round(familyModel.ratio, 3), basis: DEMAND_BASIS.FAMILY_HISTORY };
      }

      if (global.observations) {
        return { ...globalModel, ratio: round(globalRatio, 3), basis: DEMAND_BASIS.GLOBAL_HISTORY };
      }

      return { ratio: 1, observations: 0, confidence: 0, basis: null };
    },
  };
}

module.exports = { buildAttendanceModel, collectObservations };
