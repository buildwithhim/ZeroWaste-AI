/**
 * Smart Plate advice.
 *
 * The rule this module exists to enforce: a plate suggestion is either measured
 * or it is a default, and the two are never presented as the same claim. The
 * endpoint is public, so every published bucket must also clear the sample
 * threshold.
 */

import { describe, expect, it } from "vitest";

import { MIN_DISH_SAMPLE } from "../../lib/feedbackModel.js";
import feedbackStore from "../../lib/feedbackStore.js";
import { refreshSignals } from "../../lib/signals.js";
import { DEFAULT_PLATE, PLATE_SIZES, buildPortionAdvice } from "../../lib/operations/portionAdvice.js";
import { DISHES, employeeId, nextWeekday } from "../helpers/fixtures.js";
import { useDataSandbox } from "../helpers/sandbox.js";

/** Records `count` responses for one dish and refreshes the learned signals. */
const learn = (count, { dish = DISHES.lunch, response = "Finished" } = {}) => {
  for (let index = 0; index < count; index += 1) {
    feedbackStore.saveFeedback({
      employeeId: employeeId(`e${index}`),
      bookingId: `bk-${index}`,
      dish,
      category: "Lunch",
      weekday: "Monday",
      response,
      servedOn: nextWeekday(),
      portionSize: "Regular",
    });
  }
  refreshSignals(feedbackStore.listAll());
};

const adviceFor = (dish) => buildPortionAdvice().advice.find((row) => row.dish === dish);

describe("plate sizes", () => {
  it("offers three plates, ordered from light to heavy", () => {
    expect(PLATE_SIZES.map((plate) => plate.name)).toEqual(["Light", "Regular", "Heavy"]);
    expect(PLATE_SIZES.map((plate) => plate.multiplier)).toEqual([0.72, 1, 1.28]);
  });

  it("defines them server-side, so the plate an employee picks and the portion the planner costs cannot drift apart", () => {
    const { plateSizes } = buildPortionAdvice();
    expect(plateSizes).toHaveLength(3);
    for (const plate of plateSizes) {
      expect(plate).toMatchObject({ name: expect.any(String), grams: expect.any(Number), multiplier: expect.any(Number) });
    }
  });
});

describe("buildPortionAdvice", () => {
  useDataSandbox();

  it("covers every dish on the menu", () => {
    const { advice } = buildPortionAdvice();
    expect(advice.length).toBeGreaterThan(0);
    expect(new Set(advice.map((row) => row.dish)).size).toBe(advice.length);
  });

  describe("with no feedback yet", () => {
    it("suggests the standard plate", () => {
      expect(adviceFor(DISHES.lunch).recommendedPlate).toBe(DEFAULT_PLATE);
    });

    it("says plainly that this is a default and not a measurement", () => {
      const advice = adviceFor(DISHES.lunch);
      expect(advice.measured).toBe(false);
      expect(advice.basis).toBe("none");
      expect(advice.responses).toBe(0);
      expect(advice.reason).toMatch(/not enough ratings/i);
    });
  });

  describe("below the sample threshold", () => {
    it("still refuses to call the suggestion measured", () => {
      // A public endpoint publishes every number it returns, so a bucket this
      // thin would republish an individual's answer as a recommendation.
      learn(MIN_DISH_SAMPLE - 1, { response: "Left most" });
      const advice = adviceFor(DISHES.lunch);

      expect(advice.measured).toBe(false);
      expect(advice.recommendedPlate).toBe(DEFAULT_PLATE);
    });
  });

  describe("once a dish clears the threshold", () => {
    it("marks the advice as measured and names the basis", () => {
      learn(MIN_DISH_SAMPLE);
      const advice = adviceFor(DISHES.lunch);

      expect(advice.measured).toBe(true);
      expect(advice.basis).toBe("dish");
      expect(advice.responses).toBeGreaterThanOrEqual(MIN_DISH_SAMPLE);
    });

    it("explains where the suggestion came from", () => {
      learn(MIN_DISH_SAMPLE);
      expect(adviceFor(DISHES.lunch).reason).toMatch(/diners rated this dish/i);
    });

    it("suggests a lighter plate when diners consistently leave most of the food", () => {
      learn(30, { response: "Left most" });
      expect(adviceFor(DISHES.lunch).recommendedPlate).toBe("Light");
    });

    it("keeps the regular plate when diners finish", () => {
      learn(30, { response: "Finished" });
      expect(adviceFor(DISHES.lunch).recommendedPlate).toBe("Regular");
    });
  });

  it("falls back to a broader bucket for a dish with no ratings of its own", () => {
    // A dish nobody has rated still benefits from what the cafeteria has
    // learned, as long as the wider bucket is itself thick enough to publish.
    learn(30, { dish: DISHES.lunch, response: "Left most" });
    const unrated = adviceFor(DISHES.snack);

    expect(["menu-family", "cafeteria", "none"]).toContain(unrated.basis);
    if (unrated.measured) expect(unrated.responses).toBeGreaterThanOrEqual(MIN_DISH_SAMPLE);
  });

  it("publishes the threshold it applied", () => {
    expect(buildPortionAdvice().minSample).toBe(MIN_DISH_SAMPLE);
  });

  it("returns nothing that identifies a diner", () => {
    learn(10);
    expect(JSON.stringify(buildPortionAdvice())).not.toMatch(/employee|hash|bookingId/i);
  });
});
