/**
 * The operational planner: "how much should the cafeteria prepare today?"
 *
 * This is the module the admin dashboard is built on. It answers one question
 * per dish -- how many portions to cook -- and shows its working, because a
 * number a chef cannot interrogate is a number a chef will ignore.
 *
 * HOW A DISH NUMBER IS BUILT
 * --------------------------
 *   pre-booked        employees who booked the dish for this service date
 *   predicted demand  pre-booked scaled by measured turnout (walk-ins less
 *                     no-shows). With no turnout history yet, the forecasting
 *                     model's family-level prediction is split across the
 *                     dishes in that family by booking share.
 *   recommended cook  predicted demand adjusted by the learned portion
 *                     multiplier, plus a safety buffer sized from how far the
 *                     forecast has actually missed low in the past.
 *
 * Each dish reports which of those paths it took, so "measured" and "assumed"
 * are never presented as the same thing.
 *
 * PRIVACY
 * -------
 * The planner reads the unredacted signal document because it needs every
 * bucket to size portions well. It must not leak thin buckets back out: with a
 * single response, a dish's leftover rate *is* that person's answer. So the
 * expected-waste maths falls back to the menu family, then the cafeteria-wide
 * rate, whenever a dish is below the reporting threshold, and no per-dish rate
 * below that threshold is ever returned.
 */

const bookingStore = require("./bookingStore");
const serviceLog = require("./serviceLog");
const predictionLog = require("./predictionLog");
const { listMenu, portionKgFor, CATEGORIES } = require("./menu");
const { readRoster } = require("./roster");
const { buildAttendanceModel } = require("./attendance");
const { measureBufferRate, measuredWasteShareByDish, measuredWasteShareOverall } = require("./accuracy");
const { predictFamilies } = require("./predictor");
const { readSignals } = require("../signals");
const { MIN_DISH_SAMPLE } = require("../feedbackModel");
const { DEMAND_BASIS, DEMAND_BASIS_LABEL, riskFromWasteShare, round, MIN_RISK_HISTORY_DAYS } = require("./operationsModel");

const { toDateKey, weekdayOf } = require("./serviceDate");

/**
 * Resolves a statistic from the most specific bucket that clears the reporting
 * threshold: dish, then menu family, then cafeteria-wide.
 */
function resolveSignal(signals, dish, family, field, fallback) {
  const dishBucket = signals?.byDish?.[dish];
  if (dishBucket && dishBucket.responses >= MIN_DISH_SAMPLE && Number.isFinite(dishBucket[field])) {
    return { value: dishBucket[field], level: "dish", responses: dishBucket.responses };
  }

  const familyBucket = signals?.byMenuFamily?.[family];
  if (familyBucket && familyBucket.responses >= MIN_DISH_SAMPLE && Number.isFinite(familyBucket[field])) {
    return { value: familyBucket[field], level: "menu-family", responses: familyBucket.responses };
  }

  const globalBucket = signals?.global;
  // The cafeteria-wide bucket needs the same threshold as the narrower ones.
  // Without it, one to three responses in the entire system would put every
  // dish on "cafeteria" level, and at n=1 the shrunk multiplier maps one to one
  // back onto that individual's answer -- the exact leak the dish and family
  // thresholds exist to prevent, just moved one level up the chain.
  if (globalBucket && Number.isFinite(globalBucket[field]) && signals?.totalResponses >= MIN_DISH_SAMPLE) {
    return { value: globalBucket[field], level: "cafeteria", responses: signals.totalResponses };
  }

  return { value: fallback, level: "none", responses: 0 };
}

/** Dishes to plan for: those booked today, or the whole menu if none are. */
function dishesOnBoard(bookingCounts) {
  const booked = listMenu().filter((item) => (bookingCounts.get(item.dish) || 0) > 0);
  return booked.length ? booked : listMenu();
}

/**
 * Builds today's cooking plan.
 *
 * `freeze` writes the resulting plan to the prediction log so it can be graded
 * later. It is a no-op once a plan exists for the date -- the first plan issued
 * is the one that gets marked, not a flattering later revision.
 */
async function buildTodayPlan({ date = new Date(), freeze = true } = {}) {
  const dateKey = toDateKey(date);
  const weekday = weekdayOf(dateKey);

  const roster = readRoster();
  const bookingCounts = bookingStore.countsByDish(dateKey);
  const bookingSummary = bookingStore.summariseDate(dateKey);
  const signals = readSignals();
  const attendance = buildAttendanceModel({ upTo: dateKey });
  const buffer = measureBufferRate();
  const measuredWaste = measuredWasteShareByDish();
  const measuredWasteAll = measuredWasteShareOverall();

  const board = dishesOnBoard(bookingCounts);
  const families = board.map((item) => item.menuFamily);

  let familyPredictions = new Map();
  let predictorError = null;
  try {
    familyPredictions = await predictFamilies(weekday, families);
  } catch (error) {
    predictorError = error.message;
  }

  // Booking totals per family, used to split a family-level model prediction
  // across the dishes competing within it.
  const familyBooked = new Map();
  const familyDishCount = new Map();
  for (const item of board) {
    familyBooked.set(item.menuFamily, (familyBooked.get(item.menuFamily) || 0) + (bookingCounts.get(item.dish) || 0));
    familyDishCount.set(item.menuFamily, (familyDishCount.get(item.menuFamily) || 0) + 1);
  }

  const actuals = serviceLog.actualsByDish(dateKey);

  // Raw demand first, so the headcount cap below can be applied across a whole
  // category before any cooking quantity is derived from it.
  const rawDishes = board.map((item) => {
    const preBooked = bookingCounts.get(item.dish) || 0;
    const turnout = attendance.for(item.dish);
    const familyPrediction = familyPredictions.get(item.menuFamily) || null;

    let predictedDemand;
    let demandBasis;

    if (turnout.basis && preBooked > 0) {
      predictedDemand = preBooked * turnout.ratio;
      demandBasis = turnout.basis;
    } else if (familyPrediction) {
      const booked = familyBooked.get(item.menuFamily) || 0;
      const share = booked > 0 ? preBooked / booked : 1 / (familyDishCount.get(item.menuFamily) || 1);
      predictedDemand = familyPrediction.prediction * share;
      demandBasis = DEMAND_BASIS.MODEL_SHARE;
    } else {
      predictedDemand = preBooked;
      demandBasis = DEMAND_BASIS.BOOKINGS_ONLY;
    }

    return { item, preBooked, turnout, predictedDemand: Math.max(0, predictedDemand), demandBasis };
  });

  /**
   * One employee eats at most one meal per category, so predicted demand within
   * a category cannot exceed the headcount. Without this the model's historical
   * family totals -- trained on a larger population than this site -- can add up
   * to more lunches than there are people, which is the kind of number that
   * destroys trust in the whole dashboard.
   */
  const cappedCategories = [];
  for (const category of CATEGORIES) {
    const rows = rawDishes.filter((row) => row.item.category === category);
    const demand = rows.reduce((total, row) => total + row.predictedDemand, 0);
    if (demand > roster.totalEmployees && demand > 0) {
      const scale = roster.totalEmployees / demand;
      for (const row of rows) row.predictedDemand *= scale;
      cappedCategories.push(category);
    }
  }

  const dishes = rawDishes.map(({ item, preBooked, turnout, demandBasis, ...row }) => {
    const predictedDemand = Math.max(0, Math.round(row.predictedDemand));

    const multiplierSignal = resolveSignal(signals, item.dish, item.menuFamily, "portionMultiplier", 1);
    const leftoverSignal = resolveSignal(signals, item.dish, item.menuFamily, "averageLeftoverRate", 0);
    const leftoverRate = Math.max(0, Math.min(1, (leftoverSignal.value || 0) / 100));
    const portionMultiplier = multiplierSignal.value;

    /**
     * Servings and food are deliberately separate quantities.
     *
     * The portion multiplier resizes a serving; it does not change how many
     * people turn up. Folding it into one number -- as the predictor's
     * `recommendedServings` does -- produces a figure below predicted demand
     * whenever feedback says portions are too big, which reads as "cook for
     * fewer people than are coming". So the kitchen is told how many servings
     * to put out, and separately how much food that adds up to.
     */
    const bufferPortions = Math.ceil(predictedDemand * buffer.rate);
    const recommendedCook = predictedDemand + bufferPortions;
    const preparedFood = recommendedCook * portionMultiplier;
    // Same servings at full portions: what would have been cooked with no feedback.
    const baselineFood = recommendedCook;

    /**
     * Plate waste is what a diner is served minus what they would have eaten.
     * Shrinking the portion removes exactly the part people were leaving, so a
     * dish with a 30% leftover rate served at 70% size wastes nothing on plates.
     */
    const residualPerDiner = Math.max(0, portionMultiplier - (1 - leftoverRate));
    const plateWasteFood = predictedDemand * residualPerDiner;

    /**
     * Counter leftovers: food cooked that nobody takes, because the buffer was
     * not needed. This is the only component the kitchen controls on the day,
     * and it is what close-of-service records as `cooked - served`, so risk is
     * graded on it alone. Grading risk on total waste instead would mix in
     * plate waste, which the service log never sees, and would make every dish
     * look the same regardless of how well the counter was planned.
     */
    const counterLeftoverFood = bufferPortions * portionMultiplier;
    const expectedLeftoverFood = plateWasteFood + counterLeftoverFood;
    const counterShare = preparedFood > 0 ? counterLeftoverFood / preparedFood : 0;
    const wasteShare = preparedFood > 0 ? expectedLeftoverFood / preparedFood : 0;

    const actual = actuals.get(item.dish) || null;
    const portionKg = portionKgFor(item.dish);

    /**
     * Waste risk comes from what this dish has actually left on the counter,
     * not from the plan. The planned counter share is
     * `buffer / (demand + buffer)`: the portion multiplier cancels, so it is
     * the same figure for every dish on the board, and the `ceil` on the buffer
     * forces small dishes to "High" on rounding alone. A dish the kitchen has
     * not closed out enough times is marked Unrated rather than guessed at.
     */
    const measured = measuredWaste.get(item.dish);
    const hasRiskHistory = measured && measured.days >= MIN_RISK_HISTORY_DAYS && Number.isFinite(measured.share);
    const risk = hasRiskHistory ? riskFromWasteShare(measured.share) : "Unrated";

    return {
      dish: item.dish,
      category: item.category,
      menuFamily: item.menuFamily,
      preBooked,
      predictedDemand,
      recommendedCook,
      bufferPortions,
      preparedFoodPortions: round(preparedFood, 1),
      preparedFoodKg: round(preparedFood * portionKg, 1),
      baselineFoodPortions: round(baselineFood, 1),
      portionMultiplier: round(portionMultiplier, 3),
      portionSignalLevel: multiplierSignal.level,
      portionSignalResponses: multiplierSignal.responses,
      turnoutRatio: turnout.basis ? turnout.ratio : null,
      demandBasis,
      demandBasisLabel: DEMAND_BASIS_LABEL[demandBasis],
      expectedCounterLeftoverPortions: round(counterLeftoverFood, 1),
      expectedCounterLeftoverKg: round(counterLeftoverFood * portionKg, 1),
      expectedCounterSharePercent: round(counterShare * 100, 1),
      expectedPlateWastePortions: round(plateWasteFood, 1),
      expectedPlateWasteKg: round(plateWasteFood * portionKg, 1),
      expectedLeftoverPortions: round(expectedLeftoverFood, 1),
      expectedLeftoverKg: round(expectedLeftoverFood * portionKg, 1),
      expectedWasteSharePercent: round(wasteShare * 100, 1),
      risk,
      riskBasis: hasRiskHistory ? "measured-dish-history" : "insufficient-history",
      measuredWasteSharePercent: hasRiskHistory ? round(measured.share * 100, 1) : null,
      measuredWasteDays: measured ? measured.days : 0,
      minimumRiskDays: MIN_RISK_HISTORY_DAYS,
      // Present only after the kitchen closes the service for this date.
      actualServed: actual ? actual.servedPortions : null,
      actualCooked: actual ? actual.cookedPortions : null,
    };
  });

  dishes.sort((first, second) => second.recommendedCook - first.recommendedCook || first.dish.localeCompare(second.dish));

  const totals = dishes.reduce(
    (acc, dish) => ({
      preBookings: acc.preBookings + dish.preBooked,
      predictedDemand: acc.predictedDemand + dish.predictedDemand,
      recommendedCook: acc.recommendedCook + dish.recommendedCook,
      preparedFood: acc.preparedFood + dish.preparedFoodPortions,
      preparedFoodKg: acc.preparedFoodKg + dish.preparedFoodKg,
      baselineFood: acc.baselineFood + dish.baselineFoodPortions,
      counterLeftoverPortions: acc.counterLeftoverPortions + dish.expectedCounterLeftoverPortions,
      counterLeftoverKg: acc.counterLeftoverKg + dish.expectedCounterLeftoverKg,
      plateWasteKg: acc.plateWasteKg + dish.expectedPlateWasteKg,
      expectedLeftoverPortions: acc.expectedLeftoverPortions + dish.expectedLeftoverPortions,
      expectedLeftoverKg: acc.expectedLeftoverKg + dish.expectedLeftoverKg,
    }),
    {
      preBookings: 0,
      predictedDemand: 0,
      recommendedCook: 0,
      preparedFood: 0,
      preparedFoodKg: 0,
      baselineFood: 0,
      counterLeftoverPortions: 0,
      counterLeftoverKg: 0,
      plateWasteKg: 0,
      expectedLeftoverPortions: 0,
      expectedLeftoverKg: 0,
    }
  );

  const overallWasteShare = totals.preparedFood > 0 ? totals.expectedLeftoverPortions / totals.preparedFood : 0;
  const overallCounterShare = totals.preparedFood > 0 ? totals.counterLeftoverPortions / totals.preparedFood : 0;

  /**
   * A plan is only worth grading if it rested on real demand. With no bookings
   * yet, every dish predicts 0, and freezing that would permanently record a
   * forecast of zero for the date: the log is immutable, so the real plan issued
   * later that morning could never replace it, and close-of-service would grade
   * the day at 100% error on every dish. An admin simply opening the dashboard
   * early -- certain on day one of a deployment -- would corrupt the accuracy
   * figure for good and inflate the measured buffer toward its ceiling.
   */
  const restsOnRealDemand = totals.preBookings > 0 && totals.predictedDemand > 0;

  const overallRiskRated =
    measuredWasteAll.days >= MIN_RISK_HISTORY_DAYS && Number.isFinite(measuredWasteAll.share);

  if (freeze && dishes.length && restsOnRealDemand && !predictionLog.hasPlanFor(dateKey)) {
    predictionLog.recordPlan({ servedOn: dateKey, weekday, dishes });
  }

  return {
    generatedAt: new Date().toISOString(),
    date: dateKey,
    weekday,
    isServiceDay: bookingStore.WEEKDAYS.includes(weekday),
    today: {
      totalEmployees: roster.totalEmployees,
      rosterSource: roster.source,
      site: roster.site,
      preBookings: totals.preBookings,
      employeesBooked: bookingSummary.employeesBooked,
      bookingsByCategory: bookingSummary.byCategory,
      predictedDemand: totals.predictedDemand,
      recommendedCook: totals.recommendedCook,
      preparedFoodPortions: round(totals.preparedFood, 1),
      preparedFoodKg: round(totals.preparedFoodKg, 1),
      expectedCounterLeftoverPortions: round(totals.counterLeftoverPortions, 1),
      expectedCounterLeftoverKg: round(totals.counterLeftoverKg, 1),
      expectedCounterSharePercent: round(overallCounterShare * 100, 1),
      expectedPlateWasteKg: round(totals.plateWasteKg, 1),
      expectedLeftoverPortions: round(totals.expectedLeftoverPortions, 1),
      expectedLeftoverKg: round(totals.expectedLeftoverKg, 1),
      expectedWasteSharePercent: round(overallWasteShare * 100, 1),
      wasteRisk: overallRiskRated ? riskFromWasteShare(measuredWasteAll.share) : "Unrated",
      wasteRiskBasis: overallRiskRated ? "measured-service-history" : "insufficient-history",
      measuredWasteSharePercent: overallRiskRated ? round(measuredWasteAll.share * 100, 1) : null,
      measuredWasteDays: measuredWasteAll.days,
      minimumRiskDays: MIN_RISK_HISTORY_DAYS,
      participationPercent: roster.totalEmployees
        ? round((bookingSummary.employeesBooked / roster.totalEmployees) * 100, 1)
        : null,
    },
    dishes,
    method: {
      bufferRate: buffer.rate,
      bufferMeasured: buffer.measured,
      bufferGradedDays: buffer.gradedDays,
      turnoutMeasured: attendance.global.measured,
      turnoutRatio: attendance.global.ratio,
      turnoutObservations: attendance.global.observations,
      feedbackResponses: signals?.totalResponses ?? 0,
      cappedCategories,
      predictorError,
      minimumSampleSize: MIN_DISH_SAMPLE,
    },
  };
}

module.exports = { buildTodayPlan, resolveSignal, dishesOnBoard };
