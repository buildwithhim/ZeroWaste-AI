/**
 * Employee booking and the weekly meal planner, over HTTP.
 *
 * The planner posts a whole week at once and relies on `scopeDates` to express
 * cancellation, so the API contract is tested the way the client actually uses
 * it rather than one booking at a time.
 */

import { describe, expect, it } from "vitest";

import { asEmployee } from "../helpers/client.js";
import { DISHES, employeeId, nextWeekday, serviceWeek } from "../helpers/fixtures.js";
import { useDataSandbox } from "../helpers/sandbox.js";

const line = (overrides = {}) => ({
  dish: DISHES.lunch,
  category: "Lunch",
  servedOn: nextWeekday(),
  appetite: "Regular",
  ...overrides,
});

const saveBookings = (payload) => asEmployee().post("/operations/bookings").send(payload);
const myBookings = (employee) => asEmployee().get(`/operations/bookings/me?employeeId=${encodeURIComponent(employee)}`);

describe("GET /operations/menu", () => {
  useDataSandbox();

  it("publishes the dish catalogue", async () => {
    const response = await asEmployee().get("/operations/menu");

    expect(response.status).toBe(200);
    expect(response.body.menu.length).toBeGreaterThan(0);
  });

  it("describes each dish with the category and family the planner uses", async () => {
    const { body } = await asEmployee().get("/operations/menu");

    for (const item of body.menu) {
      expect(item).toMatchObject({ dish: expect.any(String), category: expect.any(String), menuFamily: expect.any(String) });
    }
  });
});

describe("POST /operations/bookings", () => {
  useDataSandbox();

  it("accepts a booking and reports it", async () => {
    const response = await saveBookings({ employeeId: employeeId(), bookings: [line()] });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ accepted: 1, rejected: [] });
  });

  it("requires an employee identifier", async () => {
    const response = await saveBookings({ bookings: [line()] });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/employeeId is required/);
  });

  it("answers 400 rather than 500 when the payload shape is wrong", async () => {
    const response = await saveBookings({ employeeId: employeeId(), bookings: "lunch please" });
    expect(response.status).toBe(400);
  });

  it("tolerates a completely empty body", async () => {
    expect((await asEmployee().post("/operations/bookings").send()).status).toBe(400);
  });

  it("reports rejected lines instead of dropping them", async () => {
    const response = await saveBookings({
      employeeId: employeeId(),
      bookings: [line(), line({ dish: "Lobster Thermidor" })],
    });

    expect(response.body.accepted).toBe(1);
    expect(response.body.rejected[0].reason).toMatch(/unknown dish/);
  });

  it("refuses a weekend service date", async () => {
    const response = await saveBookings({ employeeId: employeeId(), bookings: [line({ servedOn: "2024-06-08" })] });

    expect(response.body.accepted).toBe(0);
    expect(response.body.rejected[0].reason).toMatch(/closed at weekends/);
  });
});

describe("GET /operations/bookings/me", () => {
  useDataSandbox();

  it("returns the caller's own bookings", async () => {
    const employee = employeeId();
    await saveBookings({ employeeId: employee, bookings: [line()] });

    const response = await myBookings(employee);
    expect(response.status).toBe(200);
    expect(response.body.bookings).toHaveLength(1);
  });

  it("returns an empty list for an employee who has booked nothing", async () => {
    expect((await myBookings(employeeId())).body.bookings).toEqual([]);
  });

  it("requires an employee identifier", async () => {
    const response = await asEmployee().get("/operations/bookings/me");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/employeeId is required/);
  });

  it("never discloses the stored pseudonym", async () => {
    const employee = employeeId();
    await saveBookings({ employeeId: employee, bookings: [line()] });

    const response = await myBookings(employee);
    expect(JSON.stringify(response.body)).not.toMatch(/employeeHash/);
    expect(JSON.stringify(response.body)).not.toContain(employee);
  });
});

describe("the weekly meal planner", () => {
  useDataSandbox();

  /** The payload shape the planner UI submits: a whole week, plus its scope. */
  const weekPlan = (employee, dates, bookings) => ({ employeeId: employee, bookings, scopeDates: dates });

  it("saves a full working week in one request", async () => {
    const employee = employeeId();
    const week = serviceWeek();

    const response = await saveBookings(weekPlan(employee, week, week.map((servedOn) => line({ servedOn }))));

    expect(response.body.accepted).toBe(5);
    expect((await myBookings(employee)).body.bookings).toHaveLength(5);
  });

  it("saves all three categories on a single day", async () => {
    const employee = employeeId();
    const servedOn = nextWeekday();

    await saveBookings(
      weekPlan(employee, [servedOn], [
        line({ servedOn, dish: DISHES.breakfast, category: "Breakfast" }),
        line({ servedOn, dish: DISHES.lunch, category: "Lunch" }),
        line({ servedOn, dish: DISHES.snack, category: "Snacks" }),
      ])
    );

    const { bookings } = (await myBookings(employee)).body;
    expect(bookings.map((row) => row.category).sort()).toEqual(["Breakfast", "Lunch", "Snacks"]);
  });

  it("replaces a previously saved plan for the same week rather than appending to it", async () => {
    const employee = employeeId();
    const week = serviceWeek();

    await saveBookings(weekPlan(employee, week, week.map((servedOn) => line({ servedOn }))));
    await saveBookings(weekPlan(employee, week, week.map((servedOn) => line({ servedOn, dish: DISHES.otherLunch }))));

    const { bookings } = (await myBookings(employee)).body;
    expect(bookings).toHaveLength(5);
    expect(new Set(bookings.map((row) => row.dish))).toEqual(new Set([DISHES.otherLunch]));
  });

  it("cancels a day when the employee clears it", async () => {
    // The cleared day is absent from `bookings` but present in `scopeDates`.
    // Without that, the kitchen would keep cooking for a meal nobody wants.
    const employee = employeeId();
    const week = serviceWeek();
    const [monday] = week;

    await saveBookings(weekPlan(employee, week, week.map((servedOn) => line({ servedOn }))));
    await saveBookings(weekPlan(employee, week, week.filter((date) => date !== monday).map((servedOn) => line({ servedOn }))));

    const { bookings } = (await myBookings(employee)).body;
    expect(bookings).toHaveLength(4);
    expect(bookings.map((row) => row.servedOn)).not.toContain(monday);
  });

  it("does not disturb next week when this week is saved", async () => {
    const employee = employeeId();
    const thisWeek = serviceWeek();
    const nextWeek = serviceWeek(nextWeekday(1));

    await saveBookings(weekPlan(employee, nextWeek, nextWeek.map((servedOn) => line({ servedOn }))));
    await saveBookings(weekPlan(employee, thisWeek, thisWeek.map((servedOn) => line({ servedOn }))));

    expect((await myBookings(employee)).body.bookings).toHaveLength(10);
  });

  it("records the plate size the employee chose", async () => {
    const employee = employeeId();
    await saveBookings({ employeeId: employee, bookings: [line({ appetite: "Light" })] });

    expect((await myBookings(employee)).body.bookings[0].appetite).toBe("Light");
  });

  it("derives the weekday from the service date, so the client cannot disagree with the server", async () => {
    const employee = employeeId();
    const servedOn = "2024-06-03"; // A Monday.
    await saveBookings({ employeeId: employee, bookings: [line({ servedOn })] });

    expect((await myBookings(employee)).body.bookings[0].weekday).toBe("Monday");
  });
});

describe("GET /operations/impact/me", () => {
  useDataSandbox();

  it("reports one employee's own impact", async () => {
    const employee = employeeId();
    const response = await asEmployee().get(`/operations/impact/me?employeeId=${employee}`);

    expect(response.status).toBe(200);
    expect(response.body).toBeTypeOf("object");
  });

  it("requires an employee identifier", async () => {
    expect((await asEmployee().get("/operations/impact/me")).status).toBe(400);
  });

  it("returns nothing about anybody else", async () => {
    const alice = employeeId("alice");
    await saveBookings({ employeeId: alice, bookings: [line()] });

    const response = await asEmployee().get(`/operations/impact/me?employeeId=${employeeId("bob")}`);
    expect(JSON.stringify(response.body)).not.toContain(alice);
  });
});
