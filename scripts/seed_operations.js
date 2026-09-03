/**
 * Seeds bookings, issued forecasts and close-of-service actuals.
 *
 * The operational dashboard reports measured quantities -- turnout, forecast
 * accuracy, waste -- and those need history to exist before they mean anything.
 * This script fabricates a plausible few weeks of it for local development.
 *
 * It deliberately writes the three stores the way the running system would:
 * bookings first, then a forecast frozen *before* service, then actuals that
 * differ from the forecast. Seeding the prediction log with the actuals (or
 * recomputing it afterwards) would manufacture a perfect accuracy score, which
 * is exactly the sort of flattering nonsense this dashboard is meant to avoid.
 *
 * Usage:  node scripts/seed_operations.js [serviceDays]
 */

const path = require("path");

const bookingStore = require(path.join(__dirname, "..", "backend", "lib", "operations", "bookingStore"));
const serviceLog = require(path.join(__dirname, "..", "backend", "lib", "operations", "serviceLog"));
const predictionLog = require(path.join(__dirname, "..", "backend", "lib", "operations", "predictionLog"));
const { saveRoster } = require(path.join(__dirname, "..", "backend", "lib", "operations", "roster"));
const { listMenu, portionKgFor } = require(path.join(__dirname, "..", "backend", "lib", "operations", "menu"));
const { readSignals } = require(path.join(__dirname, "..", "backend", "lib", "signals"));
const { MIN_DISH_SAMPLE } = require(path.join(__dirname, "..", "backend", "lib", "feedbackModel"));
const { DEFAULT_BUFFER_RATE } = require(path.join(__dirname, "..", "backend", "lib", "operations", "operationsModel"));

const HEADCOUNT = 400;
const SERVICE_DAYS = Number(process.argv[2]) || 15;

/** Deterministic PRNG so repeated seeding produces a comparable dataset. */
let seed = 20260903;
function random() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

const pick = (weights) => {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  for (const [key, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return Object.keys(weights)[0];
};

/** Relative popularity within each category. */
const POPULARITY = {
  Breakfast: { "Idli Sambar": 0.32, "Masala Dosa": 0.3, Poha: 0.22, Upma: 0.16 },
  Lunch: {
    "Veg Biryani": 0.34,
    "Rajma Chawal": 0.22,
    "Paneer Butter Masala + Roti": 0.2,
    "Dal Khichdi": 0.14,
    "South Indian Thali": 0.1,
  },
  Snacks: { "Fruit Bowl": 0.3, "Sprouts Chaat": 0.26, Dhokla: 0.24, Samosa: 0.2 },
};

/** Share of the workforce that books each category. */
const PARTICIPATION = { Breakfast: 0.45, Lunch: 0.85, Snacks: 0.4 };

const isWeekend = (date) => date.getUTCDay() === 0 || date.getUTCDay() === 6;

/** The last `count` service weekdays ending today, oldest first. */
function serviceDates(count) {
  const dates = [];
  const cursor = new Date();
  cursor.setUTCHours(12, 0, 0, 0);

  while (dates.length < count) {
    if (!isWeekend(cursor)) dates.unshift(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

function resolveMultiplier(signals, dish, family) {
  const dishBucket = signals?.byDish?.[dish];
  if (dishBucket && dishBucket.responses >= MIN_DISH_SAMPLE) return dishBucket.portionMultiplier;
  const familyBucket = signals?.byMenuFamily?.[family];
  if (familyBucket && familyBucket.responses >= MIN_DISH_SAMPLE) return familyBucket.portionMultiplier;
  return signals?.global?.portionMultiplier ?? 1;
}

function main() {
  const menu = listMenu();
  const byDish = new Map(menu.map((item) => [item.dish, item]));
  const signals = readSignals();
  const dates = serviceDates(SERVICE_DAYS);
  const today = dates[dates.length - 1];

  bookingStore.replaceAll([]);
  serviceLog.replaceAll([]);
  predictionLog.replaceAll([]);
  saveRoster({ totalEmployees: HEADCOUNT, site: "Microsoft Pune - CMZ" });

  const bookingRows = [];
  const predictionRows = [];
  const serviceRows = [];

  for (const date of dates) {
    const weekday = bookingStore.weekdayOf(date);
    const counts = new Map();

    for (let employee = 1; employee <= HEADCOUNT; employee += 1) {
      const employeeHash = bookingStore.hashEmployee(`employee-${employee}`);
      for (const [category, rate] of Object.entries(PARTICIPATION)) {
        if (random() > rate) continue;
        const dish = pick(POPULARITY[category]);
        counts.set(dish, (counts.get(dish) || 0) + 1);
        bookingRows.push({
          id: `${date}-${category}-${employee}`,
          employeeHash,
          dish,
          category,
          appetite: "Regular",
          servedOn: date,
          weekday,
          bookedAt: `${date}T08:15:00.000Z`,
        });
      }
    }

    // Today is still in progress: bookings exist, service has not closed, and
    // the live planner will freeze its own forecast when an admin opens it.
    if (date === today) continue;

    const plannedDishes = [];
    for (const [dish, preBooked] of counts) {
      const item = byDish.get(dish);
      if (!item) continue;

      // The forecast, made before service, with the error a real forecast has.
      const forecastRatio = 0.94 + random() * 0.16;
      const predictedDemand = Math.max(1, Math.round(preBooked * forecastRatio));
      const bufferPortions = Math.ceil(predictedDemand * DEFAULT_BUFFER_RATE);
      const recommendedCook = predictedDemand + bufferPortions;
      const portionMultiplier = resolveMultiplier(signals, dish, item.menuFamily);

      plannedDishes.push({
        dish,
        preBooked,
        predictedDemand,
        recommendedCook,
        preparedFoodPortions: Math.round(recommendedCook * portionMultiplier * 10) / 10,
        baselineFoodPortions: recommendedCook,
        portionMultiplier,
      });

      // What actually happened: turnout independent of the forecast, so the
      // recorded error is genuine rather than assumed.
      const actualTurnout = 0.9 + random() * 0.2;
      const servedPortions = Math.min(recommendedCook, Math.max(0, Math.round(preBooked * actualTurnout)));
      const cookedPortions = recommendedCook;

      serviceRows.push({
        servedOn: date,
        dish,
        cookedPortions,
        servedPortions,
        leftoverPortions: cookedPortions - servedPortions,
        leftoverKg: Math.round((cookedPortions - servedPortions) * portionKgFor(dish) * 100) / 100,
        recordedAt: `${date}T15:30:00.000Z`,
      });
    }

    predictionRows.push(
      ...plannedDishes.map((row) => ({ servedOn: date, weekday, ...row, loggedAt: `${date}T09:00:00.000Z` }))
    );
  }

  bookingStore.replaceAll(bookingRows);
  predictionLog.replaceAll(predictionRows);
  serviceLog.replaceAll(serviceRows);

  const todayCounts = new Map();
  for (const row of bookingRows.filter((row) => row.servedOn === today)) {
    todayCounts.set(row.dish, (todayCounts.get(row.dish) || 0) + 1);
  }

  console.log(`Seeded ${dates.length} service days (${dates[0]} to ${today}).`);
  console.log(`  bookings        ${bookingRows.length}`);
  console.log(`  forecasts       ${predictionRows.length} rows across ${dates.length - 1} graded days`);
  console.log(`  service records ${serviceRows.length}`);
  console.log(`  headcount       ${HEADCOUNT}`);
  console.log(`\nToday (${today}) pre-bookings by dish:`);
  for (const [dish, count] of [...todayCounts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${dish.padEnd(30)} ${count}`);
  }
}

main();
