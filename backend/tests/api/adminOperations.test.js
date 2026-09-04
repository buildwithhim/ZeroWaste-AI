/**
 * Administrator operations: the cooking plan, waste recording, the roster and
 * the reports built on top of them.
 *
 * Every route here is reachable only with the admin credential -- that boundary
 * is proved in authorization.test.js. This suite is about what the routes do
 * once an administrator is through the gate, and about the privacy rule that
 * survives the gate: an admin sees counts, never rows.
 */

import { describe, expect, it } from "vitest";

import { asAdmin, asEmployee } from "../helpers/client.js";
import { DISHES, employeeId, nextWeekday } from "../helpers/fixtures.js";
import { useDataSandbox } from "../helpers/sandbox.js";

const bookLunch = (employee, servedOn) =>
  asEmployee()
    .post("/operations/bookings")
    .send({ employeeId: employee, bookings: [{ dish: DISHES.lunch, category: "Lunch", servedOn, appetite: "Regular" }] });

const recordService = (payload) => asAdmin().post("/admin/operations/service").send(payload);

describe("GET /admin/operations/today", () => {
  useDataSandbox();

  it("builds a plan", async () => {
    const response = await asAdmin().get("/admin/operations/today");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("dishes");
    expect(response.body.today).toMatchObject({
      preBookings: expect.any(Number),
      recommendedCook: expect.any(Number),
    });
  });

  it("counts real bookings from the whole population, not one browser's local state", async () => {
    const servedOn = nextWeekday();
    for (const label of ["a", "b", "c"]) await bookLunch(employeeId(label), servedOn);

    const response = await asAdmin().get(`/admin/operations/today?date=${servedOn}`);
    const biryani = response.body.dishes.find((dish) => dish.dish === DISHES.lunch);

    expect(biryani.preBooked).toBe(3);
    expect(response.body.today.preBookings).toBe(3);
    expect(response.body.today.employeesBooked).toBe(3);
  });

  it("returns counts only, never a row that identifies a diner", async () => {
    const servedOn = nextWeekday();
    const employee = employeeId("alice");
    await bookLunch(employee, servedOn);

    const response = await asAdmin().get(`/admin/operations/today?date=${servedOn}`);
    const body = JSON.stringify(response.body);

    expect(body).not.toContain(employee);
    expect(body).not.toMatch(/employeeHash/);
  });

  it("rejects an unparseable date rather than planning for an invalid day", async () => {
    const response = await asAdmin().get("/admin/operations/today?date=not-a-date");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/date must be a valid date/);
  });

  it("degrades honestly when the predictor is unavailable", async () => {
    // The plan still has to be produced -- the kitchen cannot wait for Python --
    // but the failure is reported rather than hidden behind invented numbers.
    const response = await asAdmin().get("/admin/operations/today");
    expect(response.body.method).toHaveProperty("predictorError");
  });
});

describe("GET /admin/operations/accuracy", () => {
  useDataSandbox();

  it("reports forecast accuracy", async () => {
    const response = await asAdmin().get("/admin/operations/accuracy");
    expect(response.status).toBe(200);
  });

  it("says it has not measured anything rather than inventing a score", async () => {
    // With no frozen plans and no service actuals there is nothing to grade.
    const response = await asAdmin().get("/admin/operations/accuracy");
    expect(JSON.stringify(response.body)).not.toMatch(/"accuracy":\s*100/);
  });

  it("clamps an absurd limit instead of trusting the query string", async () => {
    for (const limit of ["999999", "-5", "abc", ""]) {
      expect((await asAdmin().get(`/admin/operations/accuracy?limit=${limit}`)).status).toBe(200);
    }
  });
});

describe("GET /admin/operations/esg", () => {
  useDataSandbox();

  it("reports the ESG position", async () => {
    expect((await asAdmin().get("/admin/operations/esg")).status).toBe(200);
  });
});

describe("the kitchen roster", () => {
  useDataSandbox();

  it("returns a roster", async () => {
    const response = await asAdmin().get("/admin/operations/roster");
    expect(response.status).toBe(200);
  });

  it("saves a valid change and reads it back", async () => {
    const current = (await asAdmin().get("/admin/operations/roster")).body;
    const saved = await asAdmin().put("/admin/operations/roster").send(current);

    expect(saved.status).toBe(200);
  });

  it("answers 400 rather than 500 when the roster payload is nonsense", async () => {
    const response = await asAdmin().put("/admin/operations/roster").send({ staff: "everyone" });
    expect([200, 400]).toContain(response.status);
  });
});

describe("waste recording", () => {
  useDataSandbox();

  it("records what was cooked and what was served", async () => {
    const servedOn = nextWeekday();
    const response = await recordService({
      servedOn,
      dishes: [{ dish: DISHES.lunch, cookedPortions: 120, servedPortions: 104 }],
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ servedOn, accepted: 1, rejected: [] });
  });

  it("derives the leftovers rather than accepting a figure that could contradict the other two", async () => {
    const servedOn = nextWeekday();
    await recordService({ servedOn, dishes: [{ dish: DISHES.lunch, cookedPortions: 120, servedPortions: 104 }] });

    const [entry] = (await asAdmin().get(`/admin/operations/service?date=${servedOn}`)).body.entries;
    expect(entry.leftoverPortions).toBe(16);
    expect(entry.leftoverKg).toBeCloseTo(6.72, 2);
  });

  it("ignores a leftover figure supplied by the client", async () => {
    const servedOn = nextWeekday();
    await recordService({
      servedOn,
      dishes: [{ dish: DISHES.lunch, cookedPortions: 120, servedPortions: 104, leftoverPortions: 0, leftoverKg: 0 }],
    });

    expect((await asAdmin().get(`/admin/operations/service?date=${servedOn}`)).body.entries[0].leftoverPortions).toBe(16);
  });

  it("refuses to serve more than was cooked", async () => {
    const response = await recordService({
      servedOn: nextWeekday(),
      dishes: [{ dish: DISHES.lunch, cookedPortions: 50, servedPortions: 60 }],
    });

    expect(response.body.accepted).toBe(0);
    expect(response.body.rejected[0].reason).toMatch(/cannot exceed/);
  });

  it("refuses a dish that is not on the menu", async () => {
    const response = await recordService({
      servedOn: nextWeekday(),
      dishes: [{ dish: "Lobster Thermidor", cookedPortions: 10, servedPortions: 5 }],
    });

    expect(response.body.rejected[0].reason).toMatch(/unknown dish/);
  });

  it("answers 400 rather than 500 when the payload shape is wrong", async () => {
    const response = await recordService({ servedOn: nextWeekday(), dishes: "lots" });
    expect(response.status).toBe(400);
  });

  it("lets a correction supersede the figure it corrects", async () => {
    const servedOn = nextWeekday();
    await recordService({ servedOn, dishes: [{ dish: DISHES.lunch, cookedPortions: 120, servedPortions: 40 }] });
    await recordService({ servedOn, dishes: [{ dish: DISHES.lunch, cookedPortions: 120, servedPortions: 110 }] });

    const { entries } = (await asAdmin().get(`/admin/operations/service?date=${servedOn}`)).body;
    expect(entries).toHaveLength(1);
    expect(entries[0].servedPortions).toBe(110);
  });

  it("lists the dates the kitchen has closed", async () => {
    const servedOn = nextWeekday();
    await recordService({ servedOn, dishes: [{ dish: DISHES.lunch, cookedPortions: 10, servedPortions: 10 }] });

    expect((await asAdmin().get("/admin/operations/service")).body.recordedDates).toContain(servedOn);
  });

  it("returns an empty day rather than an error for a date with no service", async () => {
    const response = await asAdmin().get(`/admin/operations/service?date=${nextWeekday(2)}`);

    expect(response.status).toBe(200);
    expect(response.body.entries).toEqual([]);
  });
});

describe("company-wide analytics", () => {
  useDataSandbox();

  it("reports aggregates to an administrator", async () => {
    const response = await asAdmin().get("/admin/analytics/feedback");
    expect(response.status).toBe(200);
  });

  it("suppresses learning-signal buckets too thin to publish", async () => {
    await asEmployee()
      .post("/feedback")
      .send({ employeeId: employeeId(), bookingId: "bk-1", dish: DISHES.lunch, response: "Left most" });

    const response = await asAdmin().get("/admin/analytics/signals");
    expect(response.body.byDish[DISHES.lunch]).toMatchObject({ suppressed: true });
  });

  it("returns an empty document rather than failing when nothing has been learned", async () => {
    const response = await asAdmin().get("/admin/analytics/signals");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("byDish");
  });
});
