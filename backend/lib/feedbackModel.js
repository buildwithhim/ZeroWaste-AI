/**
 * Shared vocabulary for the closed-loop learning system.
 *
 * Every downstream stage (analytics, learning signals, forecasting) derives its
 * numbers from these constants so a single response never means two things in
 * two places.
 */

const RESPONSES = ["Finished", "Left some", "Left most", "Wanted more"];

/**
 * `leftoverRate`   share of the served portion that ends up as plate waste.
 * `portionFactor`  how much of the current portion size should have been served.
 * `satisfied`      counts toward portion satisfaction (portion was right).
 */
const RESPONSE_MODEL = {
  Finished: { leftoverRate: 0, portionFactor: 1, satisfied: true, shortfall: false },
  "Left some": { leftoverRate: 0.3, portionFactor: 0.78, satisfied: false, shortfall: false },
  "Left most": { leftoverRate: 0.7, portionFactor: 0.45, satisfied: false, shortfall: false },
  "Wanted more": { leftoverRate: 0, portionFactor: 1.18, satisfied: false, shortfall: true },
};

/** Average cooked weight of one lunch portion, used to convert rates into kg. */
const PORTION_WEIGHT_KG = 0.42;

/** Responses required before a dish may appear in an admin-facing breakdown. */
const MIN_DISH_SAMPLE = 4;

/** Prior strength for Bayesian shrinkage of portion multipliers toward 1.0. */
const SHRINKAGE_PRIOR = 8;

/** Hard safety rails so a noisy week can never starve or flood the kitchen. */
const MULTIPLIER_BOUNDS = { min: 0.6, max: 1.25 };

const isValidResponse = (value) => RESPONSES.includes(value);

module.exports = {
  RESPONSES,
  RESPONSE_MODEL,
  PORTION_WEIGHT_KG,
  MIN_DISH_SAMPLE,
  SHRINKAGE_PRIOR,
  MULTIPLIER_BOUNDS,
  isValidResponse,
};
