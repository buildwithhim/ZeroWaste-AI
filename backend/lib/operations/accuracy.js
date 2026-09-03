/**
 * Grading the forecast against what actually happened.
 *
 * Every figure here is a join between two independently written records: the
 * plan frozen in predictionLog before service, and the actuals recorded in
 * serviceLog after it. Nothing is recomputed from today's model, because a
 * forecast graded by a later version of itself is not a measurement.
 *
 * When there is not enough graded history, these functions return null and say
 * why. A dashboard that invents an accuracy percentage is worse than one that
 * admits it does not know yet, because the invented number will be trusted.
 */

const predictionLog = require("./predictionLog");
const serviceLog = require("./serviceLog");
const { portionKgFor } = require("./menu");
const { MIN_ACCURACY_SAMPLE, DEFAULT_BUFFER_RATE, MAX_BUFFER_RATE, round, clamp } = require("./operationsModel");

const { weekStart } = require("../analytics");

/**
 * Pairs each logged prediction with its actual outcome.
 *
 * Only dishes that were both predicted and served can be graded; a dish
 * predicted but never recorded is dropped rather than scored as a total miss,
 * since the absence means "nobody filed the paperwork", not "nobody ate".
 */
function gradedRows() {
  const rows = [];

  for (const dateKey of predictionLog.loggedDates()) {
    const actuals = serviceLog.actualsByDish(dateKey);
    if (!actuals.size) continue;

    for (const planned of predictionLog.listForDate(dateKey)) {
      const actual = actuals.get(planned.dish);
      if (!actual) continue;

      // A frozen row predicting nobody is not a forecast anybody acted on; it
      // is what an empty booking store produces. Grading it would score a
      // guaranteed 100% error and drag the reported accuracy down for good.
      if (!(planned.predictedDemand > 0)) continue;

      rows.push({
        servedOn: dateKey,
        dish: planned.dish,
        preBooked: planned.preBooked,
        predictedDemand: planned.predictedDemand,
        recommendedCook: planned.recommendedCook,
        preparedFoodPortions: planned.preparedFoodPortions,
        baselineFoodPortions: planned.baselineFoodPortions,
        actualServed: actual.servedPortions,
        actualCooked: actual.cookedPortions,
        leftoverPortions: actual.leftoverPortions,
        leftoverKg: actual.leftoverKg,
        error: planned.predictedDemand - actual.servedPortions,
      });
    }
  }

  return rows;
}

/**
 * Forecast accuracy as 100 − MAPE, over graded rows with a non-zero actual.
 *
 * Rows where nothing was served are excluded: the percentage error against zero
 * is undefined, and treating it as a 100% miss would punish the model for a
 * dish the kitchen chose not to serve.
 */
function forecastAccuracy(rows = gradedRows()) {
  const scorable = rows.filter((row) => row.actualServed > 0);
  const dates = new Set(scorable.map((row) => row.servedOn));

  if (dates.size < MIN_ACCURACY_SAMPLE) {
    return {
      accuracyPercent: null,
      meanAbsoluteErrorPortions: null,
      gradedDays: dates.size,
      gradedDishes: scorable.length,
      minimumDays: MIN_ACCURACY_SAMPLE,
      reason: `Needs ${MIN_ACCURACY_SAMPLE} graded service days; ${dates.size} recorded so far.`,
    };
  }

  const absolutePercentageError =
    scorable.reduce((total, row) => total + Math.abs(row.error) / row.actualServed, 0) / scorable.length;
  const meanAbsoluteError = scorable.reduce((total, row) => total + Math.abs(row.error), 0) / scorable.length;

  return {
    accuracyPercent: round(Math.max(0, 100 - absolutePercentageError * 100), 1),
    meanAbsoluteErrorPortions: round(meanAbsoluteError, 1),
    gradedDays: dates.size,
    gradedDishes: scorable.length,
    minimumDays: MIN_ACCURACY_SAMPLE,
    reason: null,
  };
}

/** Predicted vs actual per service date, newest last, for the trend chart. */
function predictionVsActual(rows = gradedRows(), { limit = 14 } = {}) {
  const byDate = new Map();

  for (const row of rows) {
    const bucket = byDate.get(row.servedOn) || {
      servedOn: row.servedOn,
      predictedDemand: 0,
      actualServed: 0,
      recommendedCook: 0,
      actualCooked: 0,
      dishes: 0,
    };
    bucket.predictedDemand += row.predictedDemand;
    bucket.actualServed += row.actualServed;
    bucket.recommendedCook += row.recommendedCook;
    bucket.actualCooked += row.actualCooked;
    bucket.dishes += 1;
    byDate.set(row.servedOn, bucket);
  }

  return [...byDate.values()]
    .sort((first, second) => first.servedOn.localeCompare(second.servedOn))
    .slice(-limit)
    .map((bucket) => ({
      ...bucket,
      variance: bucket.predictedDemand - bucket.actualServed,
      accuracyPercent: bucket.actualServed
        ? round(Math.max(0, 100 - (Math.abs(bucket.predictedDemand - bucket.actualServed) / bucket.actualServed) * 100), 1)
        : null,
    }));
}

/**
 * Food not cooked because feedback lowered the portion recommendation.
 *
 * This is deliberately the narrow, attributable definition: the same number of
 * servings at the portion size feedback recommends, against the same servings
 * at full size. It does not claim credit for waste avoided by the cafeteria's
 * own judgement, and it is not a comparison against some imagined worse
 * cafeteria.
 */
function wastePrevented({ from = null } = {}) {
  /**
   * Only plans that were actually served count. The prediction log holds
   * today's plan from the moment an admin opens the dashboard -- hours before
   * anything is cooked -- plus any day where service never happened or was
   * never closed out. Counting those would claim a saving for food that was
   * never prepared, and the figure is presented (and multiplied into CO2e,
   * water and rupees) as measured from close-of-service records.
   */
  const entries = predictionLog.listAll().filter((entry) => {
    if (from && entry.servedOn < from) return false;
    const actuals = serviceLog.actualsByDish(entry.servedOn);
    return actuals.has(entry.dish);
  });

  let portions = 0;
  let kg = 0;
  const dates = new Set();

  for (const entry of entries) {
    const baseline = entry.baselineFoodPortions ?? entry.recommendedCook ?? 0;
    const prepared = entry.preparedFoodPortions ?? baseline;
    const saved = Math.max(0, baseline - prepared);
    if (saved > 0) {
      portions += saved;
      kg += saved * portionKgFor(entry.dish);
    }
    dates.add(entry.servedOn);
  }

  return {
    portions: round(portions, 1),
    kg: round(kg, 1),
    daysCovered: dates.size,
    basis: "Food not cooked because post-meal feedback reduced the recommended portion size, at the same number of servings.",
  };
}

/** Measured leftovers per service date, from close-of-service records. */
function historicalWaste({ limit = 14 } = {}) {
  const byDate = new Map();

  for (const entry of serviceLog.listAll()) {
    const bucket = byDate.get(entry.servedOn) || { servedOn: entry.servedOn, leftoverPortions: 0, leftoverKg: 0, cookedPortions: 0 };
    bucket.leftoverPortions += entry.leftoverPortions;
    bucket.leftoverKg += entry.leftoverKg;
    bucket.cookedPortions += entry.cookedPortions;
    byDate.set(entry.servedOn, bucket);
  }

  const series = [...byDate.values()]
    .sort((first, second) => first.servedOn.localeCompare(second.servedOn))
    .map((bucket) => ({
      ...bucket,
      leftoverKg: round(bucket.leftoverKg, 1),
      wasteSharePercent: bucket.cookedPortions ? round((bucket.leftoverPortions / bucket.cookedPortions) * 100, 1) : 0,
    }));

  const weekly = new Map();
  for (const day of series) {
    const key = weekStart(day.servedOn);
    const bucket = weekly.get(key) || { weekStart: key, leftoverKg: 0, cookedPortions: 0, leftoverPortions: 0, days: 0 };
    bucket.leftoverKg += day.leftoverKg;
    bucket.cookedPortions += day.cookedPortions;
    bucket.leftoverPortions += day.leftoverPortions;
    bucket.days += 1;
    weekly.set(key, bucket);
  }

  return {
    daily: series.slice(-limit),
    weekly: [...weekly.values()]
      .sort((first, second) => first.weekStart.localeCompare(second.weekStart))
      .map((bucket) => ({
        ...bucket,
        leftoverKg: round(bucket.leftoverKg, 1),
        wasteSharePercent: bucket.cookedPortions ? round((bucket.leftoverPortions / bucket.cookedPortions) * 100, 1) : 0,
      })),
    totalLeftoverKg: round(series.reduce((total, day) => total + day.leftoverKg, 0), 1),
    daysRecorded: series.length,
  };
}

/**
 * Safety buffer derived from how far the forecast has actually missed low.
 *
 * Uses the 90th percentile of under-prediction, so the buffer covers the busy
 * days the model tends to miss rather than an average day it gets right. Falls
 * back to DEFAULT_BUFFER_RATE, flagged as unmeasured, until enough days exist.
 */
function measureBufferRate(rows = gradedRows()) {
  const shortfalls = rows
    .filter((row) => row.actualServed > 0)
    .map((row) => Math.max(0, row.actualServed - row.predictedDemand) / row.actualServed)
    .sort((first, second) => first - second);

  const dates = new Set(rows.map((row) => row.servedOn));
  if (dates.size < MIN_ACCURACY_SAMPLE || !shortfalls.length) {
    return { rate: DEFAULT_BUFFER_RATE, measured: false, gradedDays: dates.size };
  }

  const index = Math.min(shortfalls.length - 1, Math.floor(shortfalls.length * 0.9));
  return {
    rate: round(clamp(shortfalls[index], 0, MAX_BUFFER_RATE), 3),
    measured: true,
    gradedDays: dates.size,
  };
}

/**
 * Per-dish performance over the graded period.
 *
 * Ranked by portions actually served, which is a measure of what people ate --
 * not what they booked and skipped, and not what the kitchen chose to cook.
 */
function dishPerformance(rows = gradedRows()) {
  const byDish = new Map();

  for (const row of rows) {
    const bucket = byDish.get(row.dish) || {
      dish: row.dish,
      servedPortions: 0,
      cookedPortions: 0,
      leftoverPortions: 0,
      leftoverKg: 0,
      days: 0,
    };
    bucket.servedPortions += row.actualServed;
    bucket.cookedPortions += row.actualCooked;
    bucket.leftoverPortions += Math.max(0, row.actualCooked - row.actualServed);
    bucket.leftoverKg += Math.max(0, row.actualCooked - row.actualServed) * portionKgFor(row.dish);
    bucket.days += 1;
    byDish.set(row.dish, bucket);
  }

  return [...byDish.values()]
    .map((bucket) => ({
      ...bucket,
      leftoverKg: round(bucket.leftoverKg, 1),
      wasteSharePercent: bucket.cookedPortions
        ? round((bucket.leftoverPortions / bucket.cookedPortions) * 100, 1)
        : 0,
    }))
    .sort((first, second) => second.servedPortions - first.servedPortions);
}

/**
 * Measured counter-waste share per dish, keyed by dish name.
 *
 * This is what a dish has actually left on the counter across closed service
 * days -- the only dish-specific, measured basis available for rating waste
 * risk. `days` lets the caller refuse to rate a dish it has barely seen.
 */
function measuredWasteShareByDish(rows = gradedRows()) {
  const byDish = new Map();

  for (const entry of dishPerformance(rows)) {
    byDish.set(entry.dish, {
      share: entry.cookedPortions ? entry.leftoverPortions / entry.cookedPortions : null,
      days: entry.days,
    });
  }

  return byDish;
}

/**
 * Cafeteria-wide measured counter-waste share, for the headline risk rating.
 *
 * Weighted by portions cooked rather than averaged across dishes, so a dish
 * the kitchen makes twelve of does not swing the whole-service rating as much
 * as one it makes four hundred of.
 */
function measuredWasteShareOverall(rows = gradedRows()) {
  let cooked = 0;
  let leftover = 0;
  const dates = new Set();

  for (const row of rows) {
    cooked += row.actualCooked;
    leftover += Math.max(0, row.actualCooked - row.actualServed);
    dates.add(row.servedOn);
  }

  return { share: cooked > 0 ? leftover / cooked : null, days: dates.size };
}

/** Everything the accuracy panel needs, in one call. */
function buildAccuracyReport(options = {}) {
  const rows = gradedRows();
  return {
    generatedAt: new Date().toISOString(),
    forecastAccuracy: forecastAccuracy(rows),
    predictionVsActual: predictionVsActual(rows, options),
    wastePrevented: wastePrevented(options),
    historicalWaste: historicalWaste(options),
    dishPerformance: dishPerformance(rows),
    buffer: measureBufferRate(rows),
  };
}

module.exports = {
  gradedRows,
  forecastAccuracy,
  predictionVsActual,
  wastePrevented,
  historicalWaste,
  dishPerformance,
  measuredWasteShareByDish,
  measuredWasteShareOverall,
  measureBufferRate,
  buildAccuracyReport,
};
