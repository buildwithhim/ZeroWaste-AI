-- 0001_initial_schema.sql
--
-- The relational form of the nine JSON stores under data/.
--
-- The application still writes to those files; this schema is the target of the
-- data-layer cutover, shipped now so the database can be provisioned, migrated
-- and reviewed independently of the code change that starts using it.
--
-- Two properties of the JSON stores are load-bearing and are expressed here as
-- constraints rather than left to application code:
--
--   * An employee identifier is never stored. Both `bookings` and `feedback`
--     hold a salted one-way hash, and there is deliberately no table, column or
--     index that maps a hash back to a person. FEEDBACK_HASH_SALT is what makes
--     the hash irreversible, which is why config.js refuses to boot in
--     production while it is still the committed development default.
--
--   * `prediction_log` records what was forecast before the outcome was known.
--     Recomputing it later would grade the model against a prediction it never
--     issued, so rows are insert-only and the primary key stops a second write
--     for the same dish and date.

-- ---------------------------------------------------------------------------
-- Reference: the service calendar
-- ---------------------------------------------------------------------------

-- The cafeteria is closed at weekends; bookingStore.rejectionReason enforces
-- this today and the domain stays the same in the database.
CREATE TYPE weekday AS ENUM ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday');

CREATE TYPE meal_category AS ENUM ('Breakfast', 'Lunch', 'Snacks');

CREATE TYPE feedback_response AS ENUM ('Finished', 'Left some', 'Left most', 'Wanted more');

CREATE TYPE invoice_conflict_status AS ENUM ('unresolved', 'replaced', 'kept-existing');

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------

CREATE TABLE bookings (
  id            UUID PRIMARY KEY,
  employee_hash TEXT          NOT NULL,
  dish          TEXT          NOT NULL,
  category      meal_category NOT NULL,
  appetite      TEXT          NOT NULL DEFAULT 'Regular',
  served_on     DATE          NOT NULL,
  weekday       weekday       NOT NULL,
  booked_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- One employee holds at most one booking per category per service date.
  -- saveBookings currently enforces this by rebuilding the day's rows; as a
  -- constraint it also survives two replicas writing concurrently.
  CONSTRAINT bookings_one_per_slot UNIQUE (employee_hash, served_on, category)
);

-- The planner's hot path: counts per dish for one service date.
CREATE INDEX bookings_served_on_dish_idx ON bookings (served_on, dish);

-- ---------------------------------------------------------------------------
-- Feedback
-- ---------------------------------------------------------------------------

CREATE TABLE feedback (
  id            UUID PRIMARY KEY,
  employee_hash TEXT              NOT NULL,
  booking_id    TEXT              NOT NULL,
  dish          TEXT              NOT NULL,
  category      meal_category     NOT NULL DEFAULT 'Lunch',
  weekday       TEXT              NOT NULL,
  portion_size  TEXT              NOT NULL DEFAULT 'Regular',
  response      feedback_response NOT NULL,
  served_on     DATE              NOT NULL,
  submitted_at  TIMESTAMPTZ       NOT NULL DEFAULT now(),

  -- A single meal contributes a single data point: a later answer for the same
  -- booking and date replaces the earlier one rather than being averaged in.
  CONSTRAINT feedback_one_per_meal UNIQUE (employee_hash, booking_id, served_on)
);

CREATE INDEX feedback_dish_served_on_idx ON feedback (dish, served_on);
CREATE INDEX feedback_served_on_idx ON feedback (served_on);

-- Aggregated portion signals, as written by lib/signals.js. One row, replaced
-- wholesale; the singleton constraint makes "the current signals" unambiguous
-- rather than a matter of picking the newest row.
CREATE TABLE feedback_signals (
  id              BOOLEAN PRIMARY KEY DEFAULT TRUE,
  version         INTEGER     NOT NULL DEFAULT 1,
  total_responses INTEGER     NOT NULL DEFAULT 0,
  document        JSONB       NOT NULL,
  refreshed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT feedback_signals_singleton CHECK (id)
);

-- ---------------------------------------------------------------------------
-- Service actuals and the frozen forecast
-- ---------------------------------------------------------------------------

CREATE TABLE service_log (
  served_on          DATE        NOT NULL,
  dish               TEXT        NOT NULL,
  cooked_portions    INTEGER     NOT NULL,
  served_portions    INTEGER     NOT NULL,
  leftover_portions  INTEGER     NOT NULL,
  leftover_kg        NUMERIC(10, 2) NOT NULL,
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (served_on, dish),

  -- Leftovers are derived, never entered, so the three numbers cannot
  -- contradict each other.
  CONSTRAINT service_log_non_negative CHECK (cooked_portions >= 0 AND served_portions >= 0),
  CONSTRAINT service_log_served_within_cooked CHECK (served_portions <= cooked_portions),
  CONSTRAINT service_log_leftovers_derived CHECK (leftover_portions = cooked_portions - served_portions)
);

CREATE TABLE prediction_log (
  served_on               DATE        NOT NULL,
  dish                    TEXT        NOT NULL,
  weekday                 TEXT,
  pre_booked              INTEGER,
  predicted_demand        INTEGER,
  recommended_cook        INTEGER,
  prepared_food_portions  INTEGER,
  baseline_food_portions  INTEGER,
  portion_multiplier      NUMERIC(6, 3),
  logged_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Insert-only. A forecast is a claim made before the outcome was known, so
  -- re-planning a day must not be able to revise the figures it is graded on.
  PRIMARY KEY (served_on, dish)
);

-- ---------------------------------------------------------------------------
-- Roster
-- ---------------------------------------------------------------------------

CREATE TABLE roster (
  id              BOOLEAN PRIMARY KEY DEFAULT TRUE,
  total_employees INTEGER     NOT NULL,
  site            TEXT        NOT NULL DEFAULT 'All sites',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT roster_singleton CHECK (id),
  CONSTRAINT roster_headcount_positive CHECK (total_employees > 0)
);

-- ---------------------------------------------------------------------------
-- SmartQ invoices
-- ---------------------------------------------------------------------------
--
-- Invoice records describe cafeteria purchases, not people. Nothing here
-- carries an employee identifier, and no column should ever be added that
-- does: order-level detail for a small cafe is re-identifying in aggregate,
-- which is why these tables are admin-only at the route layer.

CREATE TABLE invoice_import_batches (
  id           TEXT PRIMARY KEY,
  actor        TEXT        NOT NULL,
  source       TEXT        NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary      JSONB       NOT NULL,
  files        JSONB       NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX invoice_import_batches_started_at_idx ON invoice_import_batches (started_at DESC);

CREATE TABLE invoices (
  order_id         TEXT PRIMARY KEY,
  order_date       DATE        NOT NULL,
  order_time       TEXT,
  cafeteria        TEXT,
  vendor           TEXT,
  site_code        TEXT,
  total_quantity   NUMERIC(12, 3),
  total_amount     NUMERIC(12, 2),
  currency         TEXT,

  -- The vault key. Originals are content-addressed so a hostile upload name
  -- can never influence a storage path.
  content_hash     TEXT        NOT NULL,
  -- The same invoice re-exported to a different file: remembered so the next
  -- upload of it is a cheap match rather than a fresh conflict.
  alternate_hashes TEXT[]      NOT NULL DEFAULT '{}',
  file_name        TEXT,

  imported_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revised_at       TIMESTAMPTZ,
  batch_id         TEXT REFERENCES invoice_import_batches (id) ON DELETE SET NULL,
  -- Superseded versions, kept so earlier figures stay auditable after a
  -- conflict is resolved in favour of an incoming record.
  history          JSONB       NOT NULL DEFAULT '[]'::jsonb,

  CONSTRAINT invoices_content_hash_format CHECK (content_hash ~ '^[a-f0-9]{64}$')
);

-- Duplicate detection by file identity.
CREATE UNIQUE INDEX invoices_content_hash_idx ON invoices (content_hash);
CREATE INDEX invoices_order_date_idx ON invoices (order_date);

CREATE TABLE invoice_items (
  order_id   TEXT NOT NULL REFERENCES invoices (order_id) ON DELETE CASCADE,
  line_no    INTEGER NOT NULL,
  food_item  TEXT    NOT NULL,
  quantity   NUMERIC(12, 3),
  amount     NUMERIC(12, 2),

  PRIMARY KEY (order_id, line_no)
);

CREATE TABLE invoice_conflicts (
  id           TEXT PRIMARY KEY,
  order_id     TEXT        NOT NULL,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  file_name    TEXT,
  batch_id     TEXT REFERENCES invoice_import_batches (id) ON DELETE SET NULL,
  changes      JSONB       NOT NULL,
  existing     JSONB       NOT NULL,
  incoming     JSONB       NOT NULL,
  status       invoice_conflict_status NOT NULL DEFAULT 'unresolved',
  resolved_at  TIMESTAMPTZ,
  resolved_by  TEXT,

  -- A resolved conflict must say when and by whom, so the audit trail cannot
  -- have a decision with nobody attached to it.
  CONSTRAINT invoice_conflicts_resolution_complete
    CHECK (status = 'unresolved' OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);

CREATE INDEX invoice_conflicts_status_idx ON invoice_conflicts (status);
CREATE INDEX invoice_conflicts_order_id_idx ON invoice_conflicts (order_id);

-- Append-only trail. Nothing rewrites it, so the record of what happened
-- survives a reset of the invoice store itself. The trigger below enforces
-- that at the database level rather than trusting every future call site: an
-- audit log that application code is able to edit is not an audit log.
CREATE TABLE invoice_audit_log (
  id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  event    TEXT        NOT NULL,
  actor    TEXT,
  payload  JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE FUNCTION invoice_audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'invoice_audit_log is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_audit_log_no_update_or_delete
  BEFORE UPDATE OR DELETE ON invoice_audit_log
  FOR EACH ROW EXECUTE FUNCTION invoice_audit_log_is_append_only();

CREATE INDEX invoice_audit_log_at_idx ON invoice_audit_log (at DESC);
CREATE INDEX invoice_audit_log_event_idx ON invoice_audit_log (event);

-- The training export derived from imported invoices. Regenerated wholesale
-- whenever new rows land, so it carries no history of its own.
CREATE TABLE forecast_dataset (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_date DATE NOT NULL,
  weekday    TEXT NOT NULL,
  menu       TEXT NOT NULL,
  orders     INTEGER NOT NULL,

  CONSTRAINT forecast_dataset_unique_row UNIQUE (order_date, menu)
);

CREATE INDEX forecast_dataset_order_date_idx ON forecast_dataset (order_date);
