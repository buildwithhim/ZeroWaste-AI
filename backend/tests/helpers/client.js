/**
 * HTTP client for the API suites.
 *
 * The two callers are named for the two audiences the API actually has, so a
 * test reads as a statement about who is allowed to do what rather than about
 * which header is attached.
 *
 * `asEmployee` deliberately sends no credential. That is not a shortcut: the
 * application has no employee authentication at all, so "everything an employee
 * legitimately holds" really is an empty credential set. Any admin route that
 * answers an `asEmployee` request is a broken boundary.
 */

import request from "supertest";

import app from "../../server.js";

/** The token configured for the test run. Never the shipped default. */
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

/** The insecure fallback compiled into lib/requireAdmin.js and the frontend bundle. */
export const SHIPPED_DEFAULT_TOKEN = "zerowaste-local-admin-token";

export const asAdmin = () => ({
  get: (url) => request(app).get(url).set("x-admin-token", ADMIN_TOKEN),
  post: (url) => request(app).post(url).set("x-admin-token", ADMIN_TOKEN),
  put: (url) => request(app).put(url).set("x-admin-token", ADMIN_TOKEN),
});

export const asEmployee = () => ({
  get: (url) => request(app).get(url),
  post: (url) => request(app).post(url),
  put: (url) => request(app).put(url),
});

/** A caller presenting an arbitrary token, for negative authorisation tests. */
export const withToken = (token) => ({
  get: (url) => request(app).get(url).set("x-admin-token", token),
  post: (url) => request(app).post(url).set("x-admin-token", token),
  put: (url) => request(app).put(url).set("x-admin-token", token),
});

export { app };
