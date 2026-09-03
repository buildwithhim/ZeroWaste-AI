/**
 * One employee's own impact, computed server-side.
 *
 * The employee dashboard used to work this out in the browser with its own copy
 * of the conversion factors (2.5 kg CO2e, 1,200 L water) and a flat 0.45 kg per
 * meal. That meant the personal panel and the ESG report could disagree about
 * what a kilogram of avoided waste is worth, and the per-meal weight ignored
 * the fact that a fruit bowl and a thali are not the same amount of food.
 *
 * WHAT AN EMPLOYEE CAN HONESTLY BE CREDITED WITH
 * ----------------------------------------------
 * The first version of this module credited `plannedKg - leftKg`: the weight of
 * every meal the employee booked, minus what they said they left. That is not
 * waste avoided, it is food *eaten* -- an employee who booked five meals and
 * rated none was credited with the entire weight of all five. Summed over the
 * seeded data it came to eleven times the whole cafeteria's attributable saving
 * and thirteen times all the food the kitchen has ever recorded as wasted, and
 * it was then multiplied by factors esg.js defines explicitly as "per kilogram
 * of food waste avoided". esg.js warns about exactly this mistake.
 *
 * The saving this system can actually claim is the one esg.js calls
 * `attributable`: food not cooked because post-meal feedback lowered the
 * recommended portion size. That saving is created by ratings, so it is
 * apportioned here by the employee's share of all ratings. The consequences are
 * the point:
 *
 *   - every employee's figure sums to exactly the cafeteria's attributable
 *     saving, so the personal panels cannot add up to more than really happened;
 *   - somebody who has rated nothing is credited with nothing, which is true,
 *     and the UI can then ask them to rate a meal for a reason that is real;
 *   - the number rises by rating meals, which is precisely the behaviour the
 *     closed loop needs.
 *
 * PRIVACY
 * -------
 * This is strictly self-service. It is reached with the caller's own pseudonym
 * and only ever reads records already stored under that pseudonym; the only
 * cafeteria-wide values it touches are the total saving and the total number of
 * ratings, both of which are already published in aggregate. It exposes no
 * other employee's data, and no aggregate an employee could difference against
 * to isolate someone else. It is deliberately not reachable by the admin
 * routers -- admins get aggregates from esg.js and nothing per-person.
 */

const feedbackStore = require("../feedbackStore");
const bookingStore = require("./bookingStore");
const { portionKgFor } = require("./menu");
const { FACTORS, FACTOR_BASIS } = require("./esg");
const { wastePrevented } = require("./accuracy");
const { RESPONSE_MODEL } = require("../feedbackModel");
const { round } = require("./operationsModel");
const { todayKey } = require("./serviceDate");

/**
 * How much of a portion each answer leaves behind. Falls back to zero for an
 * unrecognised answer so an unknown label cannot inflate the saving.
 */
const leftoverShare = (response) => RESPONSE_MODEL[response]?.leftoverRate ?? 0;

/**
 * Join key between a booking and its rating.
 *
 * These two records are created by different flows and do not share an id: the
 * booking store mints its own ids, while a rating carries the browser's
 * `Weekday-Category` handle. What both agree on is who ate what and when, so
 * that is the key. Matching on ids instead would silently find nothing and
 * report every meal as finished.
 */
const mealKey = (servedOn, dish) => `${servedOn}::${dish}`;

/** The Monday on or before `dateKey`, as a date key. */
function weekStartOf(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

/**
 * Builds the personal impact panel.
 *
 * Two different windows are reported on purpose. `savedKg` and the rating counts
 * cover the employee's whole history, because a saving already banked does not
 * stop counting on Monday morning. `daysPlanned` covers only the current week,
 * because it is a progress figure the employee is being asked to complete --
 * measured over all time it saturated at 5/5 permanently for 399 of the 402
 * seeded employees, so the panel congratulated almost everyone for planning a
 * week they had not planned.
 */
function buildPersonalImpact(employeeId, { weekStart = weekStartOf(todayKey()) } = {}) {
  const bookings = bookingStore.listForEmployee(employeeId);
  const feedback = feedbackStore.listForEmployee(employeeId);
  const answers = new Map(feedback.map((entry) => [mealKey(entry.servedOn, entry.dish), entry]));

  let plannedKg = 0;
  /** Portion weight of the rated meals only -- the denominator for leftovers. */
  let ratedKg = 0;
  let leftKg = 0;
  let ratedMeals = 0;
  let finishedMeals = 0;

  for (const booking of bookings) {
    const portionKg = portionKgFor(booking.dish);
    plannedKg += portionKg;

    const answer = answers.get(mealKey(booking.servedOn, booking.dish));
    if (!answer) continue;

    ratedMeals += 1;
    ratedKg += portionKg;
    if (answer.response === "Finished") finishedMeals += 1;
    leftKg += portionKg * leftoverShare(answer.response);
  }

  /**
   * The employee's share of the cafeteria's attributable saving.
   *
   * Guarded on the total rather than assumed non-zero: before anybody has rated
   * anything there is no saving to divide and no denominator to divide it by.
   */
  const totalRatings = feedbackStore.listAll().length;
  const cafeteriaSavedKg = wastePrevented().kg;
  const ratingShare = totalRatings > 0 ? ratedMeals / totalRatings : 0;
  const savedKg = Math.max(0, cafeteriaSavedKg * ratingShare);

  const thisWeek = bookings.filter((booking) => booking.servedOn >= weekStart);
  const daysPlanned = new Set(thisWeek.map((booking) => booking.weekday)).size;

  return {
    meals: bookings.length,
    mealsThisWeek: thisWeek.length,
    daysPlanned,
    ratedMeals,
    finishedMeals,
    /**
     * Null rather than zero when nothing has been rated: "you finish 0% of your
     * meals" and "you have not rated a meal yet" are different statements.
     */
    finishedSharePercent: ratedMeals ? round((finishedMeals / ratedMeals) * 100, 0) : null,
    /** Over the rated meals only. Dividing by every meal ever booked understated it several-fold. */
    leftoverSharePercent: ratedMeals && ratedKg > 0 ? round((leftKg / ratedKg) * 100, 1) : null,
    plannedKg: round(plannedKg, 2),
    leftKg: round(leftKg, 2),
    savedKg: round(savedKg, 2),
    co2eSavedKg: round(savedKg * FACTORS.co2eKgPerKg, 1),
    waterSavedLitres: Math.round(savedKg * FACTORS.waterLitresPerKg),
    costSavedInr: Math.round(savedKg * FACTORS.costInrPerKg),
    /** The working, so the UI can state what the share is a share of. */
    basis: {
      cafeteriaSavedKg: round(cafeteriaSavedKg, 1),
      totalRatings,
      sharePercent: round(ratingShare * 100, 2),
      explanation:
        "Your share of the food the cafeteria did not cook because post-meal ratings lowered the recommended portion size, apportioned by how many meals you rated.",
    },
    factors: { ...FACTORS, basis: FACTOR_BASIS },
  };
}

module.exports = { buildPersonalImpact };
