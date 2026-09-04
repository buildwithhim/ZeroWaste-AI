/**
 * Thin wrapper around the prediction model.
 *
 * The planner needs one forecast per menu family on the board, so it always
 * uses the batch path: the model and encoders are loaded once and answer every
 * family, instead of paying that cost per dish.
 *
 * Transport -- a spawned `predict.py` in development, the containerised AI
 * service in production -- is decided in lib/aiService.js. Nothing here changes
 * between the two.
 */

const aiService = require("../aiService");

/** Resolves with a Map keyed by menu family. Rejects if the predictor fails. */
async function predictFamilies(weekday, families) {
  const unique = [...new Set(families)];
  if (!unique.length) return new Map();

  const parsed = await aiService.predictBatch(unique.map((menu) => ({ weekday, menu })));
  return new Map((parsed.predictions || []).map((row) => [row.menu, row]));
}

module.exports = { predictFamilies };
