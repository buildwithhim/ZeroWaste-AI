/**
 * Feedback storage and the learning signals derived from it.
 *
 * The privacy contract is the interesting part: individual responses exist only
 * in feedback.json, are pseudonymised on write, and must not be reconstructable
 * from anything the server hands out. A thin bucket is the leak that matters --
 * with one response, the average leftover rate *is* that person's answer.
 */

import { describe, expect, it } from "vitest";

import feedbackStore from "../../lib/feedbackStore.js";
import { MIN_DISH_SAMPLE, MULTIPLIER_BOUNDS, RESPONSES, isValidResponse } from "../../lib/feedbackModel.js";
import { buildSignals, readSignals, refreshSignals, toPublicSignals } from "../../lib/signals.js";
import { DISHES, employeeId, nextWeekday } from "../helpers/fixtures.js";
import { useDataSandbox } from "../helpers/sandbox.js";

const response = (overrides = {}) => ({
  employeeId: employeeId(),
  bookingId: "bk-1",
  dish: DISHES.lunch,
  category: "Lunch",
  weekday: "Monday",
  response: "Finished",
  servedOn: nextWeekday(),
  portionSize: "Regular",
  ...overrides,
});

/** Records `count` responses for one dish, each from a different employee. */
const recordMany = (count, overrides = {}) => {
  for (let index = 0; index < count; index += 1) {
    feedbackStore.saveFeedback(response({ employeeId: employeeId(`e${index}`), bookingId: `bk-${index}`, ...overrides }));
  }
  return feedbackStore.listAll();
};

describe("feedbackModel", () => {
  it("accepts only the four defined responses", () => {
    for (const value of RESPONSES) expect(isValidResponse(value)).toBe(true);
  });

  it("rejects anything else, including near-misses and injected values", () => {
    for (const value of ["finished", "Left Some", "", null, undefined, "<script>", 1, {}]) {
      expect(isValidResponse(value)).toBe(false);
    }
  });
});

describe("feedbackStore", () => {
  useDataSandbox();

  it("records a response", () => {
    const entry = feedbackStore.saveFeedback(response());
    expect(entry).toMatchObject({ dish: DISHES.lunch, response: "Finished" });
  });

  it("never stores the raw employee identifier", () => {
    const employee = employeeId("alice");
    feedbackStore.saveFeedback(response({ employeeId: employee }));

    expect(JSON.stringify(feedbackStore.listAll())).not.toContain(employee);
    expect(feedbackStore.listAll()[0].employeeHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("lets one meal contribute exactly one data point", () => {
    // Changing your mind should correct the answer, not double-count it.
    const employee = employeeId();
    const servedOn = nextWeekday();

    feedbackStore.saveFeedback(response({ employeeId: employee, bookingId: "bk-1", servedOn, response: "Left most" }));
    feedbackStore.saveFeedback(response({ employeeId: employee, bookingId: "bk-1", servedOn, response: "Finished" }));

    const stored = feedbackStore.listAll();
    expect(stored).toHaveLength(1);
    expect(stored[0].response).toBe("Finished");
  });

  it("keeps two employees' answers to the same booking id separate", () => {
    const servedOn = nextWeekday();
    feedbackStore.saveFeedback(response({ employeeId: "alice", bookingId: "bk-1", servedOn }));
    feedbackStore.saveFeedback(response({ employeeId: "bob", bookingId: "bk-1", servedOn }));

    expect(feedbackStore.listAll()).toHaveLength(2);
  });

  it("returns an employee their own responses and nobody else's", () => {
    feedbackStore.saveFeedback(response({ employeeId: "alice", dish: DISHES.lunch }));
    feedbackStore.saveFeedback(response({ employeeId: "bob", dish: DISHES.otherLunch }));

    expect(feedbackStore.listForEmployee("alice").map((row) => row.dish)).toEqual([DISHES.lunch]);
    expect(feedbackStore.listForEmployee("bob").map((row) => row.dish)).toEqual([DISHES.otherLunch]);
  });

  it("strips the pseudonym from rows it hands back", () => {
    feedbackStore.saveFeedback(response({ employeeId: "alice" }));
    expect(feedbackStore.listForEmployee("alice")[0]).not.toHaveProperty("employeeHash");
  });

  it("returns nothing for an employee who has never responded", () => {
    expect(feedbackStore.listForEmployee("stranger")).toEqual([]);
  });

  it("defaults the category and plate size rather than storing undefined", () => {
    const entry = feedbackStore.saveFeedback(response({ category: undefined, portionSize: undefined }));
    expect(entry).toMatchObject({ category: "Lunch", portionSize: "Regular" });
  });
});

describe("buildSignals", () => {
  useDataSandbox();

  it("produces an aggregate-only document", () => {
    const signals = buildSignals(recordMany(6));

    expect(signals.scope).toBe("aggregate-only");
    expect(signals.totalResponses).toBe(6);
    // The document is written to disk and read by Python; it must carry no identity.
    expect(JSON.stringify(signals)).not.toMatch(/employeeHash|employeeId/);
  });

  it("keeps the portion multiplier inside the safety rails", () => {
    // A week where everyone leaves most of their food must not be allowed to
    // starve the kitchen, and the reverse must not flood it.
    const starved = buildSignals(recordMany(40, { response: "Left most" }));
    expect(starved.global.portionMultiplier).toBeGreaterThanOrEqual(MULTIPLIER_BOUNDS.min);

    const flooded = buildSignals(recordMany(40, { response: "Wanted more" }));
    expect(flooded.global.portionMultiplier).toBeLessThanOrEqual(MULTIPLIER_BOUNDS.max);
  });

  it("moves the multiplier below one when diners leave food", () => {
    const signals = buildSignals(recordMany(30, { response: "Left some" }));
    expect(signals.global.portionMultiplier).toBeLessThan(1);
  });

  it("moves the multiplier above one when diners want more", () => {
    const signals = buildSignals(recordMany(30, { response: "Wanted more" }));
    expect(signals.global.portionMultiplier).toBeGreaterThan(1);
  });

  it("leaves the multiplier at one when everyone finishes", () => {
    const signals = buildSignals(recordMany(30, { response: "Finished" }));
    expect(signals.global.portionMultiplier).toBeCloseTo(1, 2);
  });

  it("shrinks a thin sample toward one, so two responses cannot swing the kitchen", () => {
    const thin = buildSignals(recordMany(2, { response: "Left most" }));
    const thick = buildSignals(recordMany(40, { response: "Left most" }));

    expect(Math.abs(1 - thin.global.portionMultiplier)).toBeLessThan(Math.abs(1 - thick.global.portionMultiplier));
  });

  it("handles an empty corpus without inventing numbers", () => {
    const signals = buildSignals([]);
    expect(signals.totalResponses).toBe(0);
    expect(signals.global.portionMultiplier).toBeCloseTo(1, 5);
  });
});

describe("refreshSignals and readSignals", () => {
  useDataSandbox();

  it("persists the signals so the predictor and the retrainer read the same numbers", () => {
    refreshSignals(recordMany(5));
    expect(readSignals().totalResponses).toBe(5);
  });

  it("returns null rather than throwing when nothing has been written", () => {
    expect(readSignals()).toBeNull();
  });
});

describe("toPublicSignals", () => {
  useDataSandbox();

  it("suppresses a bucket thin enough to expose one person's answer", () => {
    // With a single response, averageLeftoverRate is exactly that individual's
    // answer. Only the count may survive.
    const published = toPublicSignals(buildSignals(recordMany(1, { response: "Left most" })));
    const bucket = published.byDish[DISHES.lunch];

    expect(bucket).toMatchObject({ responses: 1, suppressed: true });
    expect(bucket).not.toHaveProperty("averageLeftoverRate");
    expect(bucket).not.toHaveProperty("portionMultiplier");
  });

  it("publishes a bucket once it clears the sample threshold", () => {
    const published = toPublicSignals(buildSignals(recordMany(MIN_DISH_SAMPLE)));
    expect(published.byDish[DISHES.lunch]).not.toHaveProperty("suppressed");
    expect(published.byDish[DISHES.lunch].responses).toBe(MIN_DISH_SAMPLE);
  });

  it("suppresses the cafeteria-wide bucket too, because an aggregate over two people is those two people", () => {
    const published = toPublicSignals(buildSignals(recordMany(2)));
    expect(published.global).toMatchObject({ suppressed: true });
  });

  it("applies the same threshold to weekday and menu-family buckets", () => {
    const published = toPublicSignals(buildSignals(recordMany(1)));

    expect(published.byWeekday.Monday).toMatchObject({ suppressed: true });
    expect(Object.values(published.byMenuFamily).every((bucket) => bucket.responses === 0 || bucket.suppressed)).toBe(true);
  });

  it("drops trend weeks that are too thin to publish", () => {
    const published = toPublicSignals(buildSignals(recordMany(1)));
    expect(published.weeklyTrend).toEqual([]);
  });

  it("states the threshold it applied, so a reader can tell a gap from a zero", () => {
    expect(toPublicSignals(buildSignals([])).minimumSampleSize).toBe(MIN_DISH_SAMPLE);
  });

  it("returns null for absent signals rather than an empty-looking document", () => {
    expect(toPublicSignals(null)).toBeNull();
  });
});
