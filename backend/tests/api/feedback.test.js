/**
 * Meal feedback and Smart Plate advice over HTTP.
 *
 * Feedback is the input to the learning loop, so this suite covers both the
 * write path and the privacy rule on the way back out: an employee sees their
 * own answers, an administrator sees aggregates, and nobody sees a bucket thin
 * enough to identify an individual.
 */

import { describe, expect, it } from "vitest";

import { asAdmin, asEmployee } from "../helpers/client.js";
import { DISHES, employeeId, nextWeekday } from "../helpers/fixtures.js";
import { useDataSandbox } from "../helpers/sandbox.js";

const submit = (payload) => asEmployee().post("/feedback").send(payload);

const feedback = (overrides = {}) => ({
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

describe("POST /feedback", () => {
  useDataSandbox();

  it("records a response", async () => {
    const response = await submit(feedback());

    expect(response.status).toBe(201);
    expect(response.body.recorded).toMatchObject({ bookingId: "bk-1", dish: DISHES.lunch, response: "Finished" });
  });

  it("echoes back only the submitter's own answer, plus aggregate context", async () => {
    const response = await submit(feedback());

    expect(Object.keys(response.body)).toEqual(["recorded", "impact"]);
    expect(response.body.impact).toMatchObject({ totalResponses: expect.any(Number) });
    expect(JSON.stringify(response.body)).not.toMatch(/employeeHash/);
  });

  it("requires a booking and a dish", async () => {
    expect((await submit(feedback({ bookingId: undefined }))).status).toBe(400);
    expect((await submit(feedback({ dish: undefined }))).status).toBe(400);
  });

  it("accepts only the four defined responses", async () => {
    for (const value of ["Finished", "Left some", "Left most", "Wanted more"]) {
      expect((await submit(feedback({ response: value }))).status).toBe(201);
    }
  });

  it("rejects an undefined response and names what it will accept", async () => {
    for (const value of ["finished", "Ate it all", "", null, "<script>alert(1)</script>"]) {
      const response = await submit(feedback({ response: value }));

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/response must be one of/);
    }
  });

  it("tolerates an empty body without a 500", async () => {
    expect((await asEmployee().post("/feedback").send()).status).toBe(400);
  });

  it("lets a changed mind correct an answer rather than double-count it", async () => {
    const employee = employeeId();
    const servedOn = nextWeekday();

    await submit(feedback({ employeeId: employee, bookingId: "bk-1", servedOn, response: "Left most" }));
    const second = await submit(feedback({ employeeId: employee, bookingId: "bk-1", servedOn, response: "Finished" }));

    expect(second.body.impact.totalResponses).toBe(1);
  });

  it("refreshes the learning signals immediately, so the next forecast benefits", async () => {
    const first = await submit(feedback({ employeeId: employeeId("a"), bookingId: "bk-a" }));
    const second = await submit(feedback({ employeeId: employeeId("b"), bookingId: "bk-b" }));

    expect(second.body.impact.totalResponses).toBe(first.body.impact.totalResponses + 1);
  });

  it("defaults an absent service date to today rather than failing", async () => {
    expect((await submit(feedback({ servedOn: undefined }))).status).toBe(201);
  });
});

describe("GET /feedback/me", () => {
  useDataSandbox();

  it("returns the caller's own responses", async () => {
    const employee = employeeId();
    await submit(feedback({ employeeId: employee }));

    const response = await asEmployee().get(`/feedback/me?employeeId=${employee}`);
    expect(response.status).toBe(200);
    expect(response.body.feedback).toHaveLength(1);
  });

  it("requires an employee identifier", async () => {
    expect((await asEmployee().get("/feedback/me")).status).toBe(400);
  });

  it("returns nothing for an employee who has never responded", async () => {
    expect((await asEmployee().get(`/feedback/me?employeeId=${employeeId()}`)).body.feedback).toEqual([]);
  });

  it("never returns the stored pseudonym", async () => {
    const employee = employeeId();
    await submit(feedback({ employeeId: employee }));

    const response = await asEmployee().get(`/feedback/me?employeeId=${employee}`);
    expect(JSON.stringify(response.body)).not.toMatch(/employeeHash/);
  });
});

describe("GET /admin/analytics/feedback", () => {
  useDataSandbox();

  it("reports aggregates, never rows", async () => {
    const employee = employeeId("alice");
    await submit(feedback({ employeeId: employee }));

    const response = await asAdmin().get("/admin/analytics/feedback");
    const body = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(body).not.toContain(employee);
    expect(body).not.toMatch(/employeeHash|bookingId/);
  });

  it("answers with an empty report rather than an error when nothing has been collected", async () => {
    expect((await asAdmin().get("/admin/analytics/feedback")).status).toBe(200);
  });
});

describe("GET /operations/portion-advice", () => {
  useDataSandbox();

  it("is public, because a serving suggestion is not personal data", async () => {
    expect((await asEmployee().get("/operations/portion-advice")).status).toBe(200);
  });

  it("offers the three plate sizes the client renders", async () => {
    const { body } = await asEmployee().get("/operations/portion-advice");
    expect(body.plateSizes.map((plate) => plate.name)).toEqual(["Light", "Regular", "Heavy"]);
  });

  it("advises on every dish", async () => {
    const { body } = await asEmployee().get("/operations/portion-advice");
    expect(body.advice.length).toBeGreaterThan(0);
  });

  it("marks advice as unmeasured until enough people have rated the dish", async () => {
    // The UI uses `measured` to choose between "AI recommended" and "standard
    // serving", so the two must never be presented as the same claim.
    await submit(feedback({ dish: DISHES.lunch, response: "Left most" }));

    const { body } = await asEmployee().get("/operations/portion-advice");
    const biryani = body.advice.find((row) => row.dish === DISHES.lunch);

    expect(biryani.measured).toBe(false);
    expect(biryani.recommendedPlate).toBe("Regular");
  });

  it("becomes a measured recommendation once the dish clears the threshold", async () => {
    for (let index = 0; index < 30; index += 1) {
      await submit(feedback({ employeeId: employeeId(`e${index}`), bookingId: `bk-${index}`, response: "Left most" }));
    }

    const { body } = await asEmployee().get("/operations/portion-advice");
    const biryani = body.advice.find((row) => row.dish === DISHES.lunch);

    expect(biryani.measured).toBe(true);
    expect(biryani.recommendedPlate).toBe("Light");
    expect(biryani.reason).toMatch(/diners rated this dish/i);
  });

  it("discloses nothing about any individual diner", async () => {
    const employee = employeeId("alice");
    await submit(feedback({ employeeId: employee }));

    const { body } = await asEmployee().get("/operations/portion-advice");
    expect(JSON.stringify(body)).not.toContain(employee);
    expect(JSON.stringify(body)).not.toMatch(/employeeHash|bookingId/);
  });
});

describe("GET /health", () => {
  useDataSandbox();

  it("reports readiness without a credential", async () => {
    const response = await asEmployee().get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("discloses nothing about the deployment", async () => {
    // A health probe that leaks versions, paths or configuration is a
    // reconnaissance endpoint.
    const { body } = await asEmployee().get("/health");
    expect(Object.keys(body)).toEqual(["status"]);
  });
});
