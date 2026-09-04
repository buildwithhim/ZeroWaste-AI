/**
 * The administrator gate, tested in isolation.
 *
 * This is the single chokepoint every admin route depends on, so it is worth
 * testing directly as well as through the API: a regression here is a
 * regression in every protected route at once.
 */

import { describe, expect, it, vi } from "vitest";

import { adminGate, presentedToken, tokenMatches } from "../../lib/requireAdmin.js";

/** Minimal express-shaped request. `get` is what the gate reads headers with. */
const requestWith = (headers = {}) => {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => lower[name.toLowerCase()] };
};

const responseSpy = () => {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

describe("presentedToken", () => {
  it("reads the x-admin-token header", () => {
    expect(presentedToken(requestWith({ "x-admin-token": "abc" }))).toBe("abc");
  });

  it("trims surrounding whitespace, which a copy-paste from a console adds", () => {
    expect(presentedToken(requestWith({ "x-admin-token": "  abc  " }))).toBe("abc");
  });

  it("falls back to a bearer authorization header", () => {
    expect(presentedToken(requestWith({ authorization: "Bearer abc" }))).toBe("abc");
    expect(presentedToken(requestWith({ authorization: "bearer abc" }))).toBe("abc");
  });

  it("prefers the dedicated header when both are present", () => {
    expect(presentedToken(requestWith({ "x-admin-token": "header", authorization: "Bearer bearer" }))).toBe("header");
  });

  it("returns an empty string when no credential is offered at all", () => {
    expect(presentedToken(requestWith({}))).toBe("");
    expect(presentedToken(requestWith({ authorization: "Basic abc" }))).toBe("");
  });
});

describe("tokenMatches", () => {
  const configured = process.env.ADMIN_TOKEN;

  it("accepts the configured token", () => {
    expect(tokenMatches(configured)).toBe(true);
  });

  it("rejects an absent credential", () => {
    expect(tokenMatches("")).toBe(false);
  });

  it("rejects a token that differs by a single character", () => {
    const nearMiss = `${configured.slice(0, -1)}${configured.endsWith("a") ? "b" : "a"}`;
    expect(nearMiss).toHaveLength(configured.length);
    expect(tokenMatches(nearMiss)).toBe(false);
  });

  it("rejects a prefix of the real token", () => {
    expect(tokenMatches(configured.slice(0, -1))).toBe(false);
  });

  it("rejects the insecure fallback that ships in the source", () => {
    // The literal is compiled into both the backend default and the frontend
    // bundle. Once ADMIN_TOKEN is configured it must carry no authority.
    expect(tokenMatches("zerowaste-local-admin-token")).toBe(false);
  });

  it("rejects a token padded with a null byte", () => {
    // Not expressible over HTTP -- Node refuses to transmit a header containing
    // a null byte -- so the gate itself is asserted directly.
    expect(tokenMatches(`${configured}\u0000`)).toBe(false);
  });
});

describe("adminGate", () => {
  it("passes a correctly credentialed request through", () => {
    const next = vi.fn();
    const req = requestWith({ "x-admin-token": process.env.ADMIN_TOKEN });
    adminGate()(req, responseSpy(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("answers 403 and does not call the handler when the credential is wrong", () => {
    const next = vi.fn();
    const res = responseSpy();
    adminGate()(requestWith({ "x-admin-token": "nope" }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("names the protected data in the refusal, without disclosing anything about it", () => {
    const res = responseSpy();
    adminGate("Administrator access is required for invoice data")(requestWith({}), res, vi.fn());

    expect(res.body.error).toBe("Administrator access is required for invoice data");
    // The refusal must not hint at the expected credential.
    expect(JSON.stringify(res.body)).not.toContain(process.env.ADMIN_TOKEN);
  });

  it("labels the actor for the audit trail, defaulting when none is supplied", () => {
    const req = requestWith({ "x-admin-token": process.env.ADMIN_TOKEN });
    adminGate()(req, responseSpy(), vi.fn());
    expect(req.actor).toBe("admin");
  });

  it("truncates an over-long actor label so it cannot bloat the audit log", () => {
    const req = requestWith({ "x-admin-token": process.env.ADMIN_TOKEN, "x-admin-actor": "a".repeat(500) });
    adminGate()(req, responseSpy(), vi.fn());
    expect(req.actor).toHaveLength(120);
  });
});
