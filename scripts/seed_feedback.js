/**
 * Generates a realistic, fully anonymised feedback history so the analytics and
 * trend views have something to show before real responses accumulate.
 *
 * Usage: node scripts/seed_feedback.js [weeks]
 */

const path = require("path");

const feedbackStore = require(path.join(__dirname, "..", "backend", "lib", "feedbackStore"));
const { refreshSignals } = require(path.join(__dirname, "..", "backend", "lib", "signals"));
const { hashEmployee } = feedbackStore;

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

/**
 * Per-dish response weights [Finished, Left some, Left most, Wanted more].
 * Heavier dishes over-serve; lighter dishes leave people hungry.
 */
const DISH_PROFILES = {
  "Veg Biryani": [0.42, 0.34, 0.18, 0.06],
  "Rajma Chawal": [0.68, 0.2, 0.06, 0.06],
  "Paneer Butter Masala + Roti": [0.55, 0.28, 0.11, 0.06],
  "Dal Khichdi": [0.74, 0.14, 0.04, 0.08],
  "South Indian Thali": [0.38, 0.33, 0.23, 0.06],
};
const RESPONSES = ["Finished", "Left some", "Left most", "Wanted more"];

/** Deterministic PRNG so repeated seeding produces a stable demo dataset. */
function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function pickResponse(weights, random) {
  const roll = random();
  let cumulative = 0;
  for (let index = 0; index < weights.length; index += 1) {
    cumulative += weights[index];
    if (roll <= cumulative) return RESPONSES[index];
  }
  return RESPONSES[0];
}

function mondayOfWeeksAgo(weeksAgo) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) - weeksAgo * 7);
  return date;
}

function seed(weeks = 6) {
  const random = makeRandom(20260902);
  const dishes = Object.keys(DISH_PROFILES);
  const entries = [];

  for (let weekIndex = weeks - 1; weekIndex >= 0; weekIndex -= 1) {
    const monday = mondayOfWeeksAgo(weekIndex);
    // Portions improve as the loop learns, so older weeks waste more.
    const improvement = (weeks - 1 - weekIndex) * 0.035;

    WEEKDAYS.forEach((weekday, dayOffset) => {
      const servedDate = new Date(monday);
      servedDate.setUTCDate(monday.getUTCDate() + dayOffset);
      const servedOn = servedDate.toISOString().slice(0, 10);

      dishes.forEach((dish) => {
        const [finished, some, most, more] = DISH_PROFILES[dish];
        const weights = [
          Math.min(0.9, finished + improvement),
          Math.max(0.03, some - improvement * 0.7),
          Math.max(0.01, most - improvement * 0.3),
          more,
        ];
        const total = weights.reduce((sum, value) => sum + value, 0);
        const normalised = weights.map((value) => value / total);
        const respondents = 5 + Math.floor(random() * 6);

        for (let person = 0; person < respondents; person += 1) {
          const employeeId = `employee-${Math.floor(random() * 260)}`;
          entries.push({
            id: `seed-${weekIndex}-${dayOffset}-${dish}-${person}`,
            employeeHash: hashEmployee(employeeId),
            bookingId: `${weekday}-Lunch`,
            dish,
            category: "Lunch",
            weekday,
            portionSize: "Regular",
            response: pickResponse(normalised, random),
            servedOn,
            submittedAt: `${servedOn}T13:30:00.000Z`,
          });
        }
      });
    });
  }

  const count = feedbackStore.replaceAll(entries);
  const signals = refreshSignals(entries);
  console.log(`Seeded ${count} anonymised responses across ${weeks} weeks.`);
  console.log(`Global portion multiplier: ${signals.global.portionMultiplier} (leftover ${signals.global.averageLeftoverRate}%)`);
}

if (require.main === module) {
  seed(Number(process.argv[2]) || 6);
}

module.exports = { seed };
