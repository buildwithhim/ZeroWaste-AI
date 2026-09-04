/**
 * Stage 7 of the loop: turn aggregated feedback into learning signals the
 * forecasting pipeline can consume.
 *
 * The signals are materialised to data/feedback_signals.json rather than passed
 * over the wire so that both the live predictor (backend/predict.py) and the
 * offline retrainer (scripts/train_model.py) read exactly the same numbers.
 */

const fs = require("fs");
const path = require("path");

const { aggregate, summarise, portionMultiplier } = require("./analytics");
const { menuFamilyFor, MENU_FAMILIES } = require("./menuTaxonomy");
const { MIN_DISH_SAMPLE } = require("./feedbackModel");

const { dataPath } = require("./dataDir");

const signalsPath = () => dataPath("feedback_signals.json");

/**
 * Builds the signal document. Contains only aggregate statistics — it is
 * written to disk and read by Python, so it must never carry identity.
 */
function buildSignals(entries, options = {}) {
  const data = aggregate(entries, options);

  const byDish = Object.fromEntries(
    data.byDish.map((dish) => [
      dish.dish,
      {
        responses: dish.responses,
        portionMultiplier: dish.portionMultiplier,
        averageLeftoverRate: dish.averageLeftoverRate,
        portionSatisfaction: dish.portionSatisfaction,
        wantedMoreRate: dish.wantedMoreRate,
        signalConfidence: dish.signalConfidence,
      },
    ])
  );

  const familyGroups = entries.reduce((groups, entry) => {
    const family = menuFamilyFor(entry.dish);
    (groups[family] = groups[family] || []).push(entry);
    return groups;
  }, {});

  const byMenuFamily = Object.fromEntries(
    MENU_FAMILIES.map((family) => {
      const rows = familyGroups[family] || [];
      const summary = summarise(rows);
      const { multiplier, confidence } = portionMultiplier(summary.rawPortionFactor, summary.responses);
      return [
        family,
        {
          responses: summary.responses,
          portionMultiplier: multiplier,
          averageLeftoverRate: summary.averageLeftoverRate,
          portionSatisfaction: summary.portionSatisfaction,
          signalConfidence: confidence,
        },
      ];
    })
  );

  const byWeekday = Object.fromEntries(
    data.byWeekday.map((day) => [
      day.weekday,
      { responses: day.responses, portionMultiplier: day.portionMultiplier, averageLeftoverRate: day.averageLeftoverRate },
    ])
  );

  return {
    version: 1,
    generatedAt: data.generatedAt,
    scope: "aggregate-only",
    totalResponses: data.overall.responses,
    global: {
      portionMultiplier: data.overall.portionMultiplier,
      averageLeftoverRate: data.overall.averageLeftoverRate,
      portionSatisfaction: data.overall.portionSatisfaction,
      signalConfidence: data.overall.signalConfidence,
    },
    byDish,
    byMenuFamily,
    byWeekday,
    weeklyTrend: data.weeklyTrend,
  };
}

/** Recomputes and persists the signals. Called after every new response. */
function refreshSignals(entries, options = {}) {
  const signals = buildSignals(entries, options);
  const target = signalsPath();
  const tempPath = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(signals, null, 2));
  fs.renameSync(tempPath, target);
  return signals;
}

function readSignals() {
  try {
    return JSON.parse(fs.readFileSync(signalsPath(), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Redacted view of the signals for admin eyes.
 *
 * The on-disk document is deliberately unsuppressed because predict.py needs
 * every bucket to size portions, and shrinkage already neutralises thin
 * samples there. Exposing it as-is would leak an individual's answer: with one
 * response, `averageLeftoverRate` is exactly that person's response (0, 30 or
 * 70). So anything below the sample threshold is dropped before it leaves the
 * server, and only the response count survives.
 */
function toPublicSignals(signals) {
  if (!signals) return null;

  const redact = (buckets) =>
    Object.fromEntries(
      Object.entries(buckets || {}).map(([key, stats]) => [
        key,
        stats.responses >= MIN_DISH_SAMPLE ? stats : { responses: stats.responses, suppressed: true },
      ])
    );

  return {
    ...signals,
    minimumSampleSize: MIN_DISH_SAMPLE,
    byDish: redact(signals.byDish),
    byMenuFamily: redact(signals.byMenuFamily),
    byWeekday: redact(signals.byWeekday),
    // The cafeteria-wide bucket is redacted on the same threshold. It is an
    // aggregate, but an aggregate over one or two people is still those people:
    // below the threshold the reported rates are simply their own answers.
    global:
      signals.totalResponses >= MIN_DISH_SAMPLE
        ? signals.global
        : { responses: signals.totalResponses || 0, suppressed: true },
    weeklyTrend: (signals.weeklyTrend || []).filter((week) => week.responses >= MIN_DISH_SAMPLE),
  };
}

module.exports = { buildSignals, refreshSignals, readSignals, toPublicSignals, signalsPath };
