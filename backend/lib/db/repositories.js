/**
 * The seam between the application and its storage.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Nine modules currently read and write JSON files directly, and every caller
 * knows it: `bookingStore.listAll()` returns an array because the file holds an
 * array, and `countsByDish` walks that array in memory. None of that survives a
 * move to Postgres, where the same question is one `GROUP BY`.
 *
 * Rewriting all nine at once, in the same change that introduces containers and
 * a deployment pipeline, would produce a diff nobody can review and would put
 * the 543-test suite through a rewrite at the same time. So the cutover is
 * staged: this module defines the interface, backs it with the existing JSON
 * stores today, and gives new code something to depend on that will not change
 * shape when the implementation moves.
 *
 * THE RULES THE INTERFACE ENCODES
 * -------------------------------
 * Every method here is `async`, including the ones whose current implementation
 * is synchronous. That is the point: a caller written against this interface
 * already awaits, so swapping in a real database is not a change to any call
 * site. The synchronous stores stay exactly as they are underneath.
 *
 * The privacy contract is part of the interface, not a convention. There is no
 * `bookings.listAll()` returning rows to a caller that might serialise them --
 * the aggregate methods (`countsByDish`, `summariseDate`) collapse identity
 * inside the repository, and `listForEmployee` is the only identity-keyed
 * lookup, mirroring the constraint that admins have no route into it.
 */

const bookingStore = require("../operations/bookingStore");
const feedbackStore = require("../feedbackStore");
const serviceLog = require("../operations/serviceLog");
const predictionLog = require("../operations/predictionLog");
const roster = require("../operations/roster");
const invoiceStore = require("../invoices/invoiceStore");
const importLog = require("../invoices/importLog");

const { readConfig } = require("../config");

/**
 * JSON-file implementation.
 *
 * A thin async facade over the existing stores. It deliberately adds no
 * behaviour: anything clever here would be logic that has to be written twice
 * when the Postgres implementation lands.
 */
function jsonRepositories() {
  return {
    driver: "json",

    bookings: {
      save: async (input) => bookingStore.saveBookings(input),
      listForEmployee: async (employeeId) => bookingStore.listForEmployee(employeeId),
      countsByDish: async (dateKey) => bookingStore.countsByDish(dateKey),
      summariseDate: async (dateKey) => bookingStore.summariseDate(dateKey),
      bookedDates: async () => bookingStore.bookedDates(),
    },

    feedback: {
      save: async (input) => feedbackStore.saveFeedback(input),
      listForEmployee: async (employeeId) => feedbackStore.listForEmployee(employeeId),
      // Aggregation-layer access. Never serialise the result to a client.
      listAllForAggregation: async () => feedbackStore.listAll(),
    },

    serviceLog: {
      record: async (input) => serviceLog.recordService(input),
      listForDate: async (dateKey) => serviceLog.listForDate(dateKey),
      actualsByDish: async (dateKey) => serviceLog.actualsByDish(dateKey),
      recordedDates: async () => serviceLog.recordedDates(),
      listAllForAggregation: async () => serviceLog.listAll(),
    },

    predictionLog: {
      // Insert-only by contract: recording a plan for a date that already has
      // one is a no-op, never an update.
      recordPlan: async (input) => predictionLog.recordPlan(input),
      listForDate: async (dateKey) => predictionLog.listForDate(dateKey),
      hasPlanFor: async (dateKey) => predictionLog.hasPlanFor(dateKey),
      loggedDates: async () => predictionLog.loggedDates(),
      listAllForAggregation: async () => predictionLog.listAll(),
    },

    roster: {
      read: async () => roster.readRoster(),
      save: async (input) => roster.saveRoster(input),
    },

    invoices: {
      insert: async (record, context) => invoiceStore.insert(record, context),
      resolveConflict: async (id, action, actor) => invoiceStore.resolveConflict(id, action, actor),
      listRecords: async () => invoiceStore.listRecords(),
      listConflicts: async (status) => invoiceStore.listConflicts(status),
      findRecord: async (orderId) => invoiceStore.findRecord(orderId),
    },

    importLog: {
      recordBatch: async (batch) => importLog.recordBatch(batch),
      recordResolution: async (input) => importLog.recordResolution(input),
      listBatches: async (limit) => importLog.listBatches(limit),
      findBatch: async (batchId) => importLog.findBatch(batchId),
      readAudit: async (limit) => importLog.readAudit(limit),
      audit: async (event) => importLog.audit(event),
    },
  };
}

/**
 * Selects an implementation.
 *
 * `DATABASE_URL` being set is not yet enough to switch: the Postgres
 * implementations do not exist, and silently falling back would hide that. The
 * flag is explicit so the cutover is a deliberate act with its own change,
 * rather than something that happens the first time someone provisions a
 * database.
 */
function repositories(config = readConfig()) {
  if (config.database.enabled && process.env.REPOSITORY_DRIVER === "postgres") {
    throw new Error(
      "REPOSITORY_DRIVER=postgres is not implemented yet. The schema and migrations are in place (backend/migrations), but the stores still read and write JSON; see docs/DEPLOYMENT.md for the cutover plan."
    );
  }

  return jsonRepositories();
}

module.exports = { repositories, jsonRepositories };
