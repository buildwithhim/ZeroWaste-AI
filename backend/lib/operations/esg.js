/**
 * Environmental impact of the food that was not wasted.
 *
 * The conversion factors below are the only assumptions on this page, and they
 * are constants of the physical world rather than performance figures: a
 * kilogram of avoided food waste embodies roughly this much carbon, water and
 * money. They are declared here, server-side, with their sources, so the
 * dashboard can state what it multiplied by instead of quietly baking the
 * arithmetic into a React component.
 *
 * What they multiply is measured, not assumed: kilograms are taken from the
 * close-of-service record and the feedback-attributable saving, never from a
 * projection or a growth curve.
 */

const { wastePrevented, historicalWaste } = require("./accuracy");
const { round } = require("./operationsModel");

/**
 * Per kilogram of food waste avoided.
 *
 * CO2e and water are mid-range figures for mixed vegetarian catering waste
 * (FAO Food Wastage Footprint); cost is an internal catering estimate for this
 * site. All three are order-of-magnitude planning figures, not audited
 * accounting, and the API labels them as such.
 */
const FACTORS = {
  co2eKgPerKg: 2.5,
  waterLitresPerKg: 1200,
  costInrPerKg: 180,
  /** A served meal weighs roughly this much, so saved food converts to meals. */
  mealKg: 0.5,
};

const FACTOR_BASIS =
  "Per kilogram of food waste avoided: 2.5 kg CO2e and 1,200 L water (FAO Food Wastage Footprint, mixed vegetarian catering), and an internal cost estimate of INR 180. Planning estimates, not audited figures.";

/**
 * Impact is reported against two different bases, kept apart on purpose.
 *
 * `attributable` is food not cooked because feedback reduced portion sizes --
 * the saving this system can honestly claim. `totalRecorded` is all leftover
 * food the kitchen has logged, which is a measure of the remaining problem, not
 * of an achievement. Adding them together, or presenting the second as a
 * saving, would overstate the result several times over.
 */
function buildEsgReport(options = {}) {
  const prevented = wastePrevented(options);
  const waste = historicalWaste(options);

  const impactOf = (kg) => ({
    foodKg: round(kg, 1),
    mealsPreserved: round(kg / FACTORS.mealKg, 1),
    co2ePreventedKg: round(kg * FACTORS.co2eKgPerKg, 1),
    waterSavedLitres: Math.round(kg * FACTORS.waterLitresPerKg),
    costSavedInr: Math.round(kg * FACTORS.costInrPerKg),
  });

  return {
    generatedAt: new Date().toISOString(),
    factors: { ...FACTORS, basis: FACTOR_BASIS },
    attributable: {
      ...impactOf(prevented.kg),
      daysCovered: prevented.daysCovered,
      basis: prevented.basis,
    },
    stillWasted: {
      ...impactOf(waste.totalLeftoverKg),
      daysCovered: waste.daysRecorded,
      basis: "Food cooked but not served, recorded at close of service. This is the remaining problem, not a saving.",
    },
    weeklyTrend: waste.weekly.map((week) => ({
      weekStart: week.weekStart,
      leftoverKg: week.leftoverKg,
      wasteSharePercent: week.wasteSharePercent,
      co2eKg: round(week.leftoverKg * FACTORS.co2eKgPerKg, 1),
      days: week.days,
    })),
  };
}

module.exports = { buildEsgReport, FACTORS, FACTOR_BASIS };
