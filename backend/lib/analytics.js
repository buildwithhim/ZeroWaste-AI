/**
 * Aggregation layer — the privacy boundary of the system.
 *
 * Everything an administrator can see is produced here. The functions below
 * take raw rows and emit counts, rates and rankings only. No employee hash,
 * booking id, timestamp or single response ever survives this module, and
 * per-dish breakdowns are suppressed until a dish has at least
 * MIN_DISH_SAMPLE responses so a small cohort cannot be re-identified.
 */

const {
  RESPONSES,
  RESPONSE_MODEL,
  PORTION_WEIGHT_KG,
  MIN_DISH_SAMPLE,
  SHRINKAGE_PRIOR,
  MULTIPLIER_BOUNDS,
} = require("./feedbackModel");

const round = (value, places = 0) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Monday-anchored week key, so trends line up with the Mon–Fri service week. */
function weekStart(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

/** Collapses a set of rows into the metrics every level of the report shares. */
function summarise(entries) {
  // Discard unrecognised responses up front. Counting them in the denominator
  // while skipping them in every numerator would drag the portion multiplier
  // toward its floor and make the kitchen under-cook.
  const valid = entries.filter((entry) => RESPONSE_MODEL[entry.response]);
  const responses = valid.length;
  if (!responses) {
    return {
      responses: 0,
      portionSatisfaction: 0,
      averageLeftoverRate: 0,
      wantedMoreRate: 0,
      estimatedWasteKg: 0,
      distribution: RESPONSES.reduce((acc, key) => ({ ...acc, [key]: 0 }), {}),
      rawPortionFactor: 1,
    };
  }

  const distribution = RESPONSES.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
  let leftoverTotal = 0;
  let satisfiedTotal = 0;
  let shortfallTotal = 0;
  let portionFactorTotal = 0;

  for (const entry of valid) {
    const model = RESPONSE_MODEL[entry.response];
    distribution[entry.response] += 1;
    leftoverTotal += model.leftoverRate;
    portionFactorTotal += model.portionFactor;
    if (model.satisfied) satisfiedTotal += 1;
    if (model.shortfall) shortfallTotal += 1;
  }

  const averageLeftoverRate = leftoverTotal / responses;

  return {
    responses,
    portionSatisfaction: round((satisfiedTotal / responses) * 100, 1),
    averageLeftoverRate: round(averageLeftoverRate * 100, 1),
    wantedMoreRate: round((shortfallTotal / responses) * 100, 1),
    estimatedWasteKg: round(leftoverTotal * PORTION_WEIGHT_KG, 2),
    distribution,
    rawPortionFactor: portionFactorTotal / responses,
  };
}

/**
 * Portion multiplier for the kitchen, shrunk toward 1.0 by sample size.
 *
 * With few responses the evidence is weak, so the multiplier stays near "cook
 * what you cooked last time"; as responses accumulate it converges on what
 * people actually ate. Bounds stop an outlier week from causing a shortage.
 */
function portionMultiplier(rawPortionFactor, responses) {
  const confidence = responses / (responses + SHRINKAGE_PRIOR);
  const shrunk = 1 + (rawPortionFactor - 1) * confidence;
  return {
    multiplier: round(clamp(shrunk, MULTIPLIER_BOUNDS.min, MULTIPLIER_BOUNDS.max), 3),
    confidence: round(confidence * 100, 1),
  };
}

function groupBy(entries, keyFn) {
  return entries.reduce((groups, entry) => {
    const key = keyFn(entry);
    (groups[key] = groups[key] || []).push(entry);
    return groups;
  }, {});
}

/**
 * Full aggregate used internally by the learning-signal writer. Safe to expose,
 * but `buildAdminReport` is the shape the API actually returns.
 */
function aggregate(entries, { now = new Date() } = {}) {
  const overallSummary = summarise(entries);
  const overallMultiplier = portionMultiplier(overallSummary.rawPortionFactor, overallSummary.responses);

  const dishGroups = groupBy(entries, (entry) => entry.dish);
  const byDish = Object.entries(dishGroups)
    .map(([dish, rows]) => {
      const summary = summarise(rows);
      const { multiplier, confidence } = portionMultiplier(summary.rawPortionFactor, summary.responses);
      return {
        dish,
        responses: summary.responses,
        portionSatisfaction: summary.portionSatisfaction,
        averageLeftoverRate: summary.averageLeftoverRate,
        wantedMoreRate: summary.wantedMoreRate,
        estimatedWasteKg: summary.estimatedWasteKg,
        distribution: summary.distribution,
        portionMultiplier: multiplier,
        signalConfidence: confidence,
        /** Below this threshold the dish is hidden from admin breakdowns. */
        reportable: summary.responses >= MIN_DISH_SAMPLE,
      };
    })
    .sort((first, second) => second.responses - first.responses);

  const byWeekday = Object.entries(groupBy(entries, (entry) => entry.weekday)).map(([weekday, rows]) => {
    const summary = summarise(rows);
    return {
      weekday,
      responses: summary.responses,
      averageLeftoverRate: summary.averageLeftoverRate,
      portionSatisfaction: summary.portionSatisfaction,
      portionMultiplier: portionMultiplier(summary.rawPortionFactor, summary.responses).multiplier,
    };
  });

  const weeklyTrend = Object.entries(groupBy(entries, (entry) => weekStart(entry.servedOn)))
    .map(([week, rows]) => {
      const summary = summarise(rows);
      return {
        weekStart: week,
        responses: summary.responses,
        averageLeftoverRate: summary.averageLeftoverRate,
        portionSatisfaction: summary.portionSatisfaction,
        estimatedWasteKg: summary.estimatedWasteKg,
      };
    })
    .sort((first, second) => first.weekStart.localeCompare(second.weekStart));

  return {
    generatedAt: now.toISOString(),
    minimumSampleSize: MIN_DISH_SAMPLE,
    overall: {
      responses: overallSummary.responses,
      portionSatisfaction: overallSummary.portionSatisfaction,
      averageLeftoverRate: overallSummary.averageLeftoverRate,
      wantedMoreRate: overallSummary.wantedMoreRate,
      estimatedWasteKg: overallSummary.estimatedWasteKg,
      distribution: overallSummary.distribution,
      portionMultiplier: overallMultiplier.multiplier,
      signalConfidence: overallMultiplier.confidence,
    },
    byDish,
    byWeekday,
    weeklyTrend,
  };
}

/** Percentage-point change in leftover rate between the last two full weeks. */
function trendDelta(weeklyTrend) {
  if (weeklyTrend.length < 2) return 0;
  const [previous, latest] = weeklyTrend.slice(-2);
  return round(latest.averageLeftoverRate - previous.averageLeftoverRate, 1);
}

/**
 * Admin-facing report. Individual responses are already gone by this point;
 * this adds ranking, suppression of thin samples, and presentation shaping.
 *
 * Suppression applies to every breakdown, not just dishes. A week or weekday
 * bucket holding a single response reveals that person's exact answer (each
 * response maps to a distinct leftover rate), and a date bucket is precisely
 * the dimension an admin could join against attendance records.
 */
function buildAdminReport(entries, options = {}) {
  const data = aggregate(entries, options);
  const isReportable = (bucket) => bucket.responses >= data.minimumSampleSize;

  const reportable = data.byDish.filter((dish) => dish.reportable);
  const reportableWeeks = data.weeklyTrend.filter(isReportable);
  const reportableWeekdays = data.byWeekday.filter(isReportable);

  const mostWastefulDishes = [...reportable]
    .sort((first, second) => second.averageLeftoverRate - first.averageLeftoverRate || second.responses - first.responses)
    .slice(0, 5)
    .map(({ dish, responses, averageLeftoverRate, estimatedWasteKg, portionMultiplier: multiplier }) => ({
      dish,
      responses,
      averageLeftoverRate,
      estimatedWasteKg,
      recommendedPortionChange: round((multiplier - 1) * 100, 1),
    }));

  const bestPerformingDishes = [...reportable]
    .sort((first, second) => second.portionSatisfaction - first.portionSatisfaction || first.averageLeftoverRate - second.averageLeftoverRate)
    .slice(0, 5)
    .map(({ dish, responses, portionSatisfaction, averageLeftoverRate, wantedMoreRate }) => ({
      dish,
      responses,
      portionSatisfaction,
      averageLeftoverRate,
      wantedMoreRate,
    }));

  return {
    generatedAt: data.generatedAt,
    privacy: {
      scope: "aggregate-only",
      minimumSampleSize: data.minimumSampleSize,
      suppressedDishes: data.byDish.length - reportable.length,
      suppressedWeeks: data.weeklyTrend.length - reportableWeeks.length,
      suppressedWeekdays: data.byWeekday.length - reportableWeekdays.length,
      note: "Individual employee responses are pseudonymised at capture and are never exposed through admin endpoints.",
    },
    totals: {
      responses: data.overall.responses,
      dishesCovered: reportable.length,
    },
    portionSatisfaction: {
      score: data.overall.portionSatisfaction,
      distribution: data.overall.distribution,
      wantedMoreRate: data.overall.wantedMoreRate,
    },
    averageLeftoverRate: data.overall.averageLeftoverRate,
    estimatedWasteKg: data.overall.estimatedWasteKg,
    mostWastefulDishes,
    bestPerformingDishes,
    weeklyWasteTrend: reportableWeeks,
    weeklyTrendDeltaPoints: trendDelta(reportableWeeks),
    byWeekday: reportableWeekdays,
    learningSignal: {
      globalPortionMultiplier: data.overall.portionMultiplier,
      confidence: data.overall.signalConfidence,
    },
  };
}

module.exports = { aggregate, buildAdminReport, summarise, portionMultiplier, weekStart };
