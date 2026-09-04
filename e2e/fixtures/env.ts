/**
 * Environment shared by the config and the specs.
 *
 * The administrator token is not a free choice: the frontend hardcodes it, so
 * the backend under test has to accept that exact value. That is a security
 * finding in its own right (audit C2), and pinning it here keeps it visible
 * rather than buried in configuration.
 *
 * The ports are free choices, deliberately away from the defaults, so a run
 * never attaches itself to a developer's own server -- which would be writing
 * into the repository's real `data/` directory. The app is pointed at the test
 * backend through VITE_API_BASE.
 */

import os from "node:os";
import path from "node:path";

export const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 5399);
export const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 5273);

/** The literal compiled into the shipped bundle. See SECURITY_AUDIT.md, C2. */
export const E2E_ADMIN_TOKEN = "zerowaste-local-admin-token";

/**
 * A disposable copy of `data/`. Stable across the run so the config, the global
 * setup and the specs all agree, but outside the repository so a journey that
 * books meals or imports an invoice cannot touch committed data.
 */
export const E2E_DATA_DIR = path.join(os.tmpdir(), "zerowaste-e2e-data");

export const API_BASE = `http://localhost:${BACKEND_PORT}`;
export const APP_BASE = `http://localhost:${FRONTEND_PORT}`;

export const adminHeaders = { "x-admin-token": E2E_ADMIN_TOKEN };
