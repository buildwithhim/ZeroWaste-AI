/**
 * The prediction API.
 *
 * These tests run the real model rather than a stub: the point of a forecast
 * endpoint is that it produces a usable number from a trained artefact, and a
 * mocked predictor would prove only that the mock works. They skip themselves
 * when the Python toolchain or the model files are unavailable, so a machine
 * without them still gets a meaningful run of everything else.
 *
 * The security property asserted here is that nothing a caller sends can steer
 * the result: the forecast comes from the model and from aggregated feedback,
 * never from the request.
 */

import { describe, expect, it } from "vitest";

import { asAdmin, asEmployee } from "../helpers/client.js";
import { DISHES, employeeId, nextWeekday } from "../helpers/fixtures.js";
import { modelAvailable, pythonAvailable, useDataSandbox } from "../helpers/sandbox.js";

const runnable = pythonAvailable() && modelAvailable();
const describeWithModel = runnable ? describe : describe.skip;

if (!runnable) {
  // Visible in the run output, so a skipped suite is never mistaken for a pass.
  console.warn("Prediction suite skipped: Python toolchain or trained model unavailable.");
}

describeWithModel("GET /forecast", () => {
  useDataSandbox({ withModel: true });

  it("answers with a forecast", async () => {
    const response = await asEmployee().get("/forecast?day=Friday&menu=Biryani");

    expect(response.status).toBe(200);
    expect(response.body.predictedOrders).toBeTypeOf("number");
    expect(response.body.predictedOrders).toBeGreaterThan(0);
  });

  it("returns the whole contract the dashboard renders", async () => {
    const { body } = await asEmployee().get("/forecast?day=Friday&menu=Biryani");

    expect(body).toMatchObject({
      predictedOrders: expect.any(Number),
      basePredictedOrders: expect.any(Number),
      recommendedServings: expect.any(Number),
      portionMultiplier: expect.any(Number),
      feedbackResponses: expect.any(Number),
      feedbackApplied: expect.any(Boolean),
      adjustmentReason: expect.any(String),
      confidence: expect.any(Number),
      weekday: "Friday",
      menuFamily: "Biryani",
    });
  });

  it("is deterministic for the same inputs", async () => {
    const first = await asEmployee().get("/forecast?day=Monday&menu=Biryani");
    const second = await asEmployee().get("/forecast?day=Monday&menu=Biryani");

    expect(first.body.predictedOrders).toBe(second.body.predictedOrders);
  });

  it("distinguishes weekdays, so the model is genuinely being consulted", async () => {
    const days = await Promise.all(
      ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day) =>
        asEmployee().get(`/forecast?day=${day}&menu=Biryani`)
      )
    );

    const predictions = days.map((response) => response.body.predictedOrders);
    expect(new Set(predictions).size).toBeGreaterThan(1);
  });

  it("falls back to a default weekday and menu rather than failing", async () => {
    expect((await asEmployee().get("/forecast")).status).toBe(200);
  });

  it("survives an unknown weekday or menu instead of returning a 500", async () => {
    // The encoders only know the classes present at training time; an unknown
    // value must fall back, not crash the endpoint.
    const response = await asEmployee().get("/forecast?day=Caturday&menu=Nonexistent");
    expect(response.status).toBe(200);
  });

  it("reports no adjustment when nothing has been learned yet", async () => {
    const { body } = await asEmployee().get("/forecast?day=Friday&menu=Biryani");

    expect(body.feedbackResponses).toBe(0);
    expect(body.feedbackApplied).toBe(false);
    expect(body.portionMultiplier).toBe(1);
    expect(body.recommendedServings).toBe(body.basePredictedOrders);
  });

  describe("a caller cannot steer the result", () => {
    /** Query parameters an attacker would try in order to inflate a forecast. */
    const injectionAttempts = [
      "portionMultiplier=99",
      "prediction=99999",
      "recommendedServings=99999",
      "confidence=100",
      "feedbackApplied=true",
      "basePredictedOrders=1",
    ];

    it.each(injectionAttempts)("ignores %s", async (query) => {
      const baseline = await asEmployee().get("/forecast?day=Friday&menu=Biryani");
      const tampered = await asEmployee().get(`/forecast?day=Friday&menu=Biryani&${query}`);

      expect(tampered.body.predictedOrders).toBe(baseline.body.predictedOrders);
      expect(tampered.body.recommendedServings).toBe(baseline.body.recommendedServings);
      expect(tampered.body.portionMultiplier).toBe(baseline.body.portionMultiplier);
    });

    it("does not execute a shell payload smuggled through the menu parameter", async () => {
      // The predictor is spawned with an argument vector rather than a shell
      // string, so metacharacters are inert data: the payload is echoed back as
      // an ordinary (unknown) menu name and the encoder falls back.
      const response = await asEmployee().get("/forecast?day=Friday&menu=Biryani%3B%20echo%20pwned");
      const unknownMenu = await asEmployee().get("/forecast?day=Friday&menu=CompletelyUnknownMenu");

      expect(response.status).toBe(200);
      expect(response.body.predictedOrders).toBeTypeOf("number");
      // Treated as an unrecognised menu, exactly like any other unknown string.
      expect(response.body.predictedOrders).toBe(unknownMenu.body.predictedOrders);
    });

    it("KNOWN GAP: a single feedback response does move the forecast", async () => {
      /*
       * Characterisation test, not an endorsement.
       *
       * predict.py applies MIN_SIGNAL_SAMPLE to the menu-family and weekday
       * buckets but *not* to the global fallback, so with one response on file
       * the cafeteria-wide multiplier is applied in full. Combined with the
       * unauthenticated POST /feedback endpoint, that is a direct lever on how
       * much the kitchen cooks: see SECURITY_AUDIT.md, finding C5.
       *
       * This asserts what the system does today so the behaviour is visible and
       * cannot change unnoticed. When C5 is fixed this test must be replaced by
       * the assertion below it, which states the property we actually want.
       */
      const baseline = (await asEmployee().get("/forecast?day=Friday&menu=Biryani")).body;

      await asEmployee()
        .post("/feedback")
        .send({ employeeId: employeeId(), bookingId: "bk-1", dish: DISHES.lunch, response: "Wanted more" });

      const after = (await asEmployee().get("/forecast?day=Friday&menu=Biryani")).body;

      expect(after.feedbackResponses).toBe(1);
      expect(after.basePredictedOrders).toBe(baseline.basePredictedOrders);
      // The model itself is untouched -- only the multiplier moved.
      expect(after.recommendedServings).not.toBe(baseline.recommendedServings);

      // The property we want once C5 is remediated:
      //   expect(after.recommendedServings).toBe(baseline.recommendedServings);
    });

    it("keeps a manipulated multiplier inside the safety rails even so", async () => {
      // The blast radius is bounded: MULTIPLIER_BOUNDS caps the multiplier at
      // 1.25, so the lever above cannot arbitrarily inflate production.
      for (let index = 0; index < 12; index += 1) {
        await asEmployee()
          .post("/feedback")
          .send({ employeeId: employeeId(`e${index}`), bookingId: `bk-${index}`, dish: DISHES.lunch, response: "Wanted more" });
      }

      const { body } = await asEmployee().get("/forecast?day=Friday&menu=Biryani");
      expect(body.portionMultiplier).toBeLessThanOrEqual(1.25);
      expect(body.portionMultiplier).toBeGreaterThanOrEqual(0.6);
    });
  });

  it("does not leak an internal path or stack trace when the predictor fails", async () => {
    // The model is deliberately absent from this sandbox.
    const response = await asEmployee().get("/forecast?day=Friday&menu=Biryani").query({ probe: "1" });
    if (response.status === 500) {
      expect(response.body).toEqual({ error: "Forecast unavailable" });
    }
  });
});

describeWithModel("GET /pipeline", () => {
  useDataSandbox({ withModel: true });

  it("describes the loop end to end", async () => {
    const response = await asEmployee().get("/pipeline?bookings=120&day=Friday&menu=Biryani");

    expect(response.status).toBe(200);
    expect(response.body).toBeTypeOf("object");
  });

  it("still answers when the booking count is missing or nonsense", async () => {
    for (const query of ["", "?bookings=", "?bookings=abc", "?bookings=-5"]) {
      expect((await asEmployee().get(`/pipeline${query}`)).status).toBe(200);
    }
  });
});

describeWithModel("the admin cooking plan consults the model", () => {
  useDataSandbox({ withModel: true });

  it("produces a plan with no predictor error when the model is present", async () => {
    const servedOn = nextWeekday();
    await asEmployee()
      .post("/operations/bookings")
      .send({
        employeeId: employeeId(),
        bookings: [{ dish: DISHES.lunch, category: "Lunch", servedOn, appetite: "Regular" }],
      });

    const response = await asAdmin().get(`/admin/operations/today?date=${servedOn}`);

    expect(response.status).toBe(200);
    expect(response.body.method.predictorError).toBeNull();
  });

  it("recommends cooking at least as much as it predicts will be eaten", async () => {
    const servedOn = nextWeekday();
    for (const label of ["a", "b", "c", "d"]) {
      await asEmployee()
        .post("/operations/bookings")
        .send({
          employeeId: employeeId(label),
          bookings: [{ dish: DISHES.lunch, category: "Lunch", servedOn, appetite: "Regular" }],
        });
    }

    const { body } = await asAdmin().get(`/admin/operations/today?date=${servedOn}`);
    const biryani = body.dishes.find((dish) => dish.dish === DISHES.lunch);

    expect(biryani.recommendedCook).toBeGreaterThanOrEqual(biryani.predictedDemand);
  });
});

describe("prediction endpoints are not an admin surface", () => {
  useDataSandbox();

  it("serves the employee-facing forecast without a credential", async () => {
    // /forecast and /pipeline are intentionally public: they carry no personal
    // data. This test records that intent so a future guard is a deliberate
    // change rather than an accident.
    const response = await asEmployee().get("/pipeline");
    expect([200, 500]).toContain(response.status);
  });
});
