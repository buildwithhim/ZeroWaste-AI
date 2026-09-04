/**
 * Close-of-service waste recording.
 *
 * The kitchen reports what it cooked and what it served; leftovers are derived
 * rather than typed, so the three figures cannot contradict each other. These
 * tests pin that derivation and the guard that keeps it arithmetically sane.
 */

import { describe, expect, it } from "vitest";

import serviceLog from "../../lib/operations/serviceLog.js";
import { DISHES, nextWeekday } from "../helpers/fixtures.js";
import { useDataSandbox } from "../helpers/sandbox.js";

const dish = (overrides = {}) => ({ dish: DISHES.lunch, cookedPortions: 100, servedPortions: 80, ...overrides });

describe("serviceLog.recordService", () => {
  useDataSandbox();

  it("derives leftovers from cooked minus served", () => {
    const servedOn = nextWeekday();
    serviceLog.recordService({ servedOn, dishes: [dish({ cookedPortions: 100, servedPortions: 80 })] });

    const [entry] = serviceLog.listForDate(servedOn);
    expect(entry.leftoverPortions).toBe(20);
  });

  it("converts leftover portions into kilograms using the dish's category weight", () => {
    const servedOn = nextWeekday();
    serviceLog.recordService({ servedOn, dishes: [dish({ cookedPortions: 110, servedPortions: 100 })] });

    // Veg Biryani is a lunch dish, costed at 0.42 kg per portion.
    expect(serviceLog.listForDate(servedOn)[0].leftoverKg).toBeCloseTo(4.2, 2);
  });

  it("records a service with no waste at all", () => {
    const servedOn = nextWeekday();
    serviceLog.recordService({ servedOn, dishes: [dish({ cookedPortions: 90, servedPortions: 90 })] });

    expect(serviceLog.listForDate(servedOn)[0]).toMatchObject({ leftoverPortions: 0, leftoverKg: 0 });
  });

  it("rounds fractional portion counts to whole plates", () => {
    const servedOn = nextWeekday();
    serviceLog.recordService({ servedOn, dishes: [dish({ cookedPortions: 100.4, servedPortions: 79.6 })] });

    expect(serviceLog.listForDate(servedOn)[0]).toMatchObject({ cookedPortions: 100, servedPortions: 80 });
  });

  describe("validation", () => {
    it("refuses a dishes payload that is not an array", () => {
      expect(() => serviceLog.recordService({ dishes: "biryani" })).toThrow(/dishes must be an array/);
    });

    const cases = [
      ["serving more than was cooked", dish({ cookedPortions: 50, servedPortions: 60 }), /servedPortions cannot exceed cookedPortions/],
      ["a negative cooked figure", dish({ cookedPortions: -1 }), /cookedPortions must be zero or more/],
      ["a negative served figure", dish({ servedPortions: -1 }), /servedPortions must be zero or more/],
      ["a non-numeric cooked figure", dish({ cookedPortions: "lots" }), /cookedPortions must be zero or more/],
      ["a dish that is not on the menu", dish({ dish: "Lobster Thermidor" }), /unknown dish/],
      ["a missing dish", dish({ dish: undefined }), /dish is required/],
    ];

    it.each(cases)("rejects %s", (_label, row, expected) => {
      const result = serviceLog.recordService({ servedOn: nextWeekday(), dishes: [row] });

      expect(result.accepted).toBe(0);
      expect(result.rejected[0].reason).toMatch(expected);
    });

    it("accepts the valid rows of a partly invalid submission", () => {
      const result = serviceLog.recordService({
        servedOn: nextWeekday(),
        dishes: [dish(), dish({ dish: "Lobster Thermidor" })],
      });

      expect(result.accepted).toBe(1);
      expect(result.rejected).toHaveLength(1);
    });
  });

  it("supersedes an earlier figure for the same dish and date rather than averaging it", () => {
    // A correction should replace the mistake. Averaging the two would leave a
    // waste figure that was never actually observed.
    const servedOn = nextWeekday();
    serviceLog.recordService({ servedOn, dishes: [dish({ cookedPortions: 100, servedPortions: 50 })] });
    serviceLog.recordService({ servedOn, dishes: [dish({ cookedPortions: 100, servedPortions: 95 })] });

    const entries = serviceLog.listForDate(servedOn);
    expect(entries).toHaveLength(1);
    expect(entries[0].servedPortions).toBe(95);
  });

  it("keeps the same dish recorded on two different dates as two rows", () => {
    const [first, second] = [nextWeekday(), nextWeekday(1)];
    serviceLog.recordService({ servedOn: first, dishes: [dish()] });
    serviceLog.recordService({ servedOn: second, dishes: [dish()] });

    expect(serviceLog.listAll()).toHaveLength(2);
  });

  it("keeps two dishes on the same date as two rows", () => {
    const servedOn = nextWeekday();
    serviceLog.recordService({
      servedOn,
      dishes: [dish({ dish: DISHES.lunch }), dish({ dish: DISHES.otherLunch })],
    });

    expect(serviceLog.listForDate(servedOn)).toHaveLength(2);
  });

  it("reports recorded dates oldest first", () => {
    const [first, second] = [nextWeekday(), nextWeekday(1)];
    serviceLog.recordService({ servedOn: second, dishes: [dish()] });
    serviceLog.recordService({ servedOn: first, dishes: [dish()] });

    expect(serviceLog.recordedDates()).toEqual([first, second]);
  });

  it("keys actuals by dish for planner lookups", () => {
    const servedOn = nextWeekday();
    serviceLog.recordService({ servedOn, dishes: [dish()] });

    expect(serviceLog.actualsByDish(servedOn).get(DISHES.lunch)).toMatchObject({ servedPortions: 80 });
  });

  it("reports nothing for a date the kitchen never closed", () => {
    expect(serviceLog.listForDate(nextWeekday())).toEqual([]);
    expect(serviceLog.recordedDates()).toEqual([]);
  });

  it("carries no employee identity, because service actuals are about food", () => {
    const servedOn = nextWeekday();
    serviceLog.recordService({ servedOn, dishes: [dish()] });

    expect(JSON.stringify(serviceLog.listAll())).not.toMatch(/employee/i);
  });
});
