/**
 * Operational planning API.
 *
 * Split into two routers because the two audiences are different: employees
 * write their own bookings and read their own back, administrators read the
 * aggregate plan. Nothing in the admin router returns a row that belongs to an
 * identifiable person -- the planner and the accuracy report both collapse to
 * counts before returning.
 */

const express = require("express");

const { adminGate } = require("../requireAdmin");
const bookingStore = require("./bookingStore");
const serviceLog = require("./serviceLog");
const { buildTodayPlan } = require("./planner");
const { buildAccuracyReport } = require("./accuracy");
const { buildEsgReport } = require("./esg");
const { readRoster, saveRoster } = require("./roster");
const { listMenu } = require("./menu");
const { todayKey } = require("./serviceDate");

const adminRouter = express.Router();
const publicRouter = express.Router();

adminRouter.use(adminGate("Administrator access is required for cafeteria operations"));

/**
 * The cooking plan. `date` is accepted for reviewing another service day, but a
 * plan is only frozen into the prediction log for the current date: writing one
 * for a past day would fabricate a forecast that was never actually issued, and
 * that log is what forecast accuracy is graded against.
 */
adminRouter.get("/today", async (req, res) => {
  const requested = req.query.date ? String(req.query.date) : todayKey();
  if (Number.isNaN(new Date(requested).getTime())) return res.status(400).json({ error: "date must be a valid date" });

  try {
    const plan = await buildTodayPlan({ date: requested, freeze: requested === todayKey() });
    res.json(plan);
  } catch (error) {
    console.error("Operational plan failed:", error.message);
    res.status(500).json({ error: "Could not build today's plan" });
  }
});

adminRouter.get("/accuracy", (req, res) => {
  try {
    const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 14));
    res.json(buildAccuracyReport({ limit }));
  } catch (error) {
    console.error("Accuracy report failed:", error.message);
    res.status(500).json({ error: "Accuracy report unavailable" });
  }
});

adminRouter.get("/esg", (req, res) => {
  try {
    res.json(buildEsgReport());
  } catch (error) {
    console.error("ESG report failed:", error.message);
    res.status(500).json({ error: "ESG report unavailable" });
  }
});

adminRouter.get("/roster", (req, res) => res.json(readRoster()));

adminRouter.put("/roster", (req, res) => {
  try {
    res.json(saveRoster(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/** Close of service: what was actually cooked and served. */
adminRouter.post("/service", (req, res) => {
  try {
    const result = serviceLog.recordService(req.body || {});
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

adminRouter.get("/service", (req, res) => {
  const date = req.query.date ? String(req.query.date) : todayKey();
  res.json({ date, entries: serviceLog.listForDate(date), recordedDates: serviceLog.recordedDates() });
});

/** The dish catalogue. Public: it is the menu, not operational data. */
publicRouter.get("/menu", (req, res) => res.json({ menu: listMenu() }));

/**
 * An employee saves their weekly plan. Rejected lines are reported rather than
 * dropped, so a partly-invalid plan does not silently lose meals.
 */
publicRouter.post("/bookings", (req, res) => {
  const { employeeId, bookings, scopeDates } = req.body || {};
  if (!employeeId) return res.status(400).json({ error: "employeeId is required" });

  try {
    const result = bookingStore.saveBookings({ employeeId, bookings, scopeDates });
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/** An employee may read back only their own bookings. */
publicRouter.get("/bookings/me", (req, res) => {
  const employeeId = req.query.employeeId;
  if (!employeeId) return res.status(400).json({ error: "employeeId is required" });
  res.json({ bookings: bookingStore.listForEmployee(employeeId) });
});

module.exports = { adminRouter, publicRouter };
