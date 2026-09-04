/**
 * Weekly meal bookings.
 *
 * Two properties matter most here and both are tested directly rather than only
 * through the API: an employee's bookings must be reachable only by that
 * employee, and saving a plan must not destroy bookings the plan does not cover.
 */

import { describe, expect, it } from "vitest";

import bookingStore from "../../lib/operations/bookingStore.js";
import { DISHES, employeeId, nextWeekday, serviceWeek } from "../helpers/fixtures.js";
import { useDataSandbox } from "../helpers/sandbox.js";

const line = (overrides = {}) => ({
  dish: DISHES.lunch,
  category: "Lunch",
  servedOn: nextWeekday(),
  appetite: "Regular",
  ...overrides,
});

describe("bookingStore.saveBookings", () => {
  useDataSandbox();

  it("stores a valid line and reports it as accepted", () => {
    const result = bookingStore.saveBookings({ employeeId: employeeId(), bookings: [line()] });
    expect(result.accepted).toBe(1);
    expect(result.rejected).toEqual([]);
  });

  it("refuses a payload that is not an array, rather than storing nothing silently", () => {
    expect(() => bookingStore.saveBookings({ employeeId: employeeId(), bookings: "lunch" })).toThrow(
      /bookings must be an array/
    );
  });

  describe("line validation", () => {
    const cases = [
      ["a missing dish", line({ dish: undefined }), /dish is required/],
      ["a dish that is not on the menu", line({ dish: "Lobster Thermidor" }), /unknown dish/],
      ["an unrecognised category", line({ category: "Brunch" }), /category must be one of/],
      ["an unparseable date", line({ servedOn: "not-a-date" }), /servedOn must be a valid date/],
    ];

    it.each(cases)("reports %s rather than dropping the line", (_label, booking, expected) => {
      const result = bookingStore.saveBookings({ employeeId: employeeId(), bookings: [booking] });

      expect(result.accepted).toBe(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reason).toMatch(expected);
    });

    it("refuses weekend dates, because the cafeteria is shut", () => {
      // 2024-06-08 is a Saturday, 2024-06-09 a Sunday.
      const result = bookingStore.saveBookings({
        employeeId: employeeId(),
        bookings: [line({ servedOn: "2024-06-08" }), line({ servedOn: "2024-06-09" })],
      });

      expect(result.accepted).toBe(0);
      expect(result.rejected.map((row) => row.reason)).toEqual([
        "the cafeteria is closed at weekends",
        "the cafeteria is closed at weekends",
      ]);
    });

    it("keeps the valid lines of a partly invalid plan", () => {
      const result = bookingStore.saveBookings({
        employeeId: employeeId(),
        bookings: [line(), line({ dish: "Lobster Thermidor" })],
      });

      expect(result.accepted).toBe(1);
      expect(result.rejected).toHaveLength(1);
    });
  });

  it("keeps only the last booking for a category on a given day", () => {
    const employee = employeeId();
    const servedOn = nextWeekday();

    bookingStore.saveBookings({
      employeeId: employee,
      bookings: [line({ servedOn, dish: DISHES.lunch }), line({ servedOn, dish: DISHES.otherLunch })],
    });

    const stored = bookingStore.listForEmployee(employee);
    expect(stored).toHaveLength(1);
    expect(stored[0].dish).toBe(DISHES.otherLunch);
  });

  it("allows one booking in each category on the same day", () => {
    const employee = employeeId();
    const servedOn = nextWeekday();

    bookingStore.saveBookings({
      employeeId: employee,
      bookings: [
        line({ servedOn, dish: DISHES.breakfast, category: "Breakfast" }),
        line({ servedOn, dish: DISHES.lunch, category: "Lunch" }),
        line({ servedOn, dish: DISHES.snack, category: "Snacks" }),
      ],
    });

    expect(bookingStore.listForEmployee(employee)).toHaveLength(3);
  });

  describe("replacement scope", () => {
    it("does not disturb bookings on days the new plan says nothing about", () => {
      const employee = employeeId();
      const [monday, tuesday] = serviceWeek();

      bookingStore.saveBookings({ employeeId: employee, bookings: [line({ servedOn: monday })] });
      bookingStore.saveBookings({ employeeId: employee, bookings: [line({ servedOn: tuesday })] });

      expect(bookingStore.listForEmployee(employee).map((row) => row.servedOn).sort()).toEqual([monday, tuesday]);
    });

    it("cancels a day when scopeDates covers it and the plan is empty", () => {
      // Without scopeDates a cancelled day simply vanishes from the payload and
      // the old booking would stand -- the kitchen would cook a meal nobody
      // intends to collect.
      const employee = employeeId();
      const week = serviceWeek();

      bookingStore.saveBookings({ employeeId: employee, bookings: week.map((servedOn) => line({ servedOn })) });
      expect(bookingStore.listForEmployee(employee)).toHaveLength(5);

      bookingStore.saveBookings({ employeeId: employee, bookings: [], scopeDates: week });
      expect(bookingStore.listForEmployee(employee)).toHaveLength(0);
    });

    it("ignores unparseable scope dates instead of failing the save", () => {
      const employee = employeeId();
      const result = bookingStore.saveBookings({
        employeeId: employee,
        bookings: [line()],
        scopeDates: ["not-a-date"],
      });

      expect(result.accepted).toBe(1);
    });

    it("refuses a scopeDates value that is not an array", () => {
      expect(() =>
        bookingStore.saveBookings({ employeeId: employeeId(), bookings: [], scopeDates: "monday" })
      ).toThrow(/scopeDates must be an array/);
    });
  });
});

describe("bookingStore identity handling", () => {
  useDataSandbox();

  it("never stores the raw employee identifier", () => {
    const employee = employeeId("alice");
    bookingStore.saveBookings({ employeeId: employee, bookings: [line()] });

    const raw = JSON.stringify(bookingStore.listAll());
    expect(raw).not.toContain(employee);
    expect(bookingStore.listAll()[0].employeeHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("gives two employees different pseudonyms", () => {
    expect(bookingStore.hashEmployee("alice")).not.toBe(bookingStore.hashEmployee("bob"));
  });

  it("gives one employee a stable pseudonym across calls", () => {
    expect(bookingStore.hashEmployee("alice")).toBe(bookingStore.hashEmployee("alice"));
  });

  it("returns one employee's bookings and nobody else's", () => {
    const alice = employeeId("alice");
    const bob = employeeId("bob");

    bookingStore.saveBookings({ employeeId: alice, bookings: [line({ dish: DISHES.lunch })] });
    bookingStore.saveBookings({ employeeId: bob, bookings: [line({ dish: DISHES.otherLunch })] });

    expect(bookingStore.listForEmployee(alice).map((row) => row.dish)).toEqual([DISHES.lunch]);
    expect(bookingStore.listForEmployee(bob).map((row) => row.dish)).toEqual([DISHES.otherLunch]);
  });

  it("strips the pseudonym from rows it hands back", () => {
    const employee = employeeId();
    bookingStore.saveBookings({ employeeId: employee, bookings: [line()] });
    expect(bookingStore.listForEmployee(employee)[0]).not.toHaveProperty("employeeHash");
  });

  it("returns nothing for an employee who has never booked", () => {
    expect(bookingStore.listForEmployee("stranger")).toEqual([]);
  });
});

describe("bookingStore aggregation", () => {
  useDataSandbox();

  it("counts bookings per dish without exposing who made them", () => {
    const servedOn = nextWeekday();
    for (const label of ["a", "b", "c"]) {
      bookingStore.saveBookings({ employeeId: employeeId(label), bookings: [line({ servedOn })] });
    }

    const counts = bookingStore.countsByDish(servedOn);
    expect(counts.get(DISHES.lunch)).toBe(3);
  });

  it("summarises a date as counts only", () => {
    const servedOn = nextWeekday();
    bookingStore.saveBookings({
      employeeId: employeeId(),
      bookings: [line({ servedOn }), line({ servedOn, dish: DISHES.breakfast, category: "Breakfast" })],
    });

    const summary = bookingStore.summariseDate(servedOn);
    expect(summary).toMatchObject({ date: servedOn, totalBookings: 2, employeesBooked: 1 });
    expect(summary.byCategory).toMatchObject({ Lunch: 1, Breakfast: 1, Snacks: 0 });
    expect(JSON.stringify(summary)).not.toMatch(/employeeHash/);
  });

  it("reports booked dates oldest first", () => {
    const [monday, tuesday, wednesday] = serviceWeek();
    const employee = employeeId();

    bookingStore.saveBookings({ employeeId: employee, bookings: [line({ servedOn: wednesday })] });
    bookingStore.saveBookings({ employeeId: employee, bookings: [line({ servedOn: monday })] });
    bookingStore.saveBookings({ employeeId: employee, bookings: [line({ servedOn: tuesday })] });

    expect(bookingStore.bookedDates()).toEqual([monday, tuesday, wednesday]);
  });

  it("starts empty when no store file exists yet", () => {
    expect(bookingStore.listAll()).toEqual([]);
    expect(bookingStore.bookedDates()).toEqual([]);
  });
});
