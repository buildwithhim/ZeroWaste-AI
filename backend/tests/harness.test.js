/**
 * Harness smoke test.
 *
 * This suite exists to prove the plumbing before anything is asserted about the
 * application: that an ESM test file can import the CommonJS backend, that the
 * data sandbox really redirects writes away from the repository, and that the
 * admin gate is configured with a non-default token.
 *
 * If this file fails, no other failure in the suite means anything.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ADMIN_TOKEN, SHIPPED_DEFAULT_TOKEN, asAdmin } from "./helpers/client.js";
import { REPO_ROOT } from "./helpers/setup.js";
import { modelAvailable, pythonAvailable, useDataSandbox } from "./helpers/sandbox.js";

describe("test harness", () => {
  const sandbox = useDataSandbox();

  it("imports the CommonJS express app from an ESM test file", async () => {
    const response = await asAdmin().get("/health");
    expect(response.status).toBe(200);
  });

  it("redirects backend writes into a disposable directory", async () => {
    const store = await import("../lib/operations/bookingStore.js");
    expect(store.storePath()).toBe(path.join(sandbox.dir, "bookings.json"));
    expect(store.storePath().startsWith(REPO_ROOT)).toBe(false);
  });

  it("gives each test a directory of its own", () => {
    expect(fs.existsSync(sandbox.dir)).toBe(true);
    expect(fs.readdirSync(sandbox.dir)).toEqual([]);
  });

  it("runs against a configured admin token rather than the shipped default", () => {
    expect(ADMIN_TOKEN).toBeTruthy();
    expect(ADMIN_TOKEN).not.toBe(SHIPPED_DEFAULT_TOKEN);
  });

  it("reports whether the Python toolchain is usable", () => {
    // Not an assertion about the environment, just a visible signal: the
    // prediction and invoice suites skip themselves when this is false.
    expect(typeof pythonAvailable()).toBe("boolean");
    expect(typeof modelAvailable()).toBe("boolean");
  });
});
