/**
 * Tests for the production configuration guard.
 *
 * WHY THIS FILE MATTERS MORE THAN ITS SIZE SUGGESTS
 * ------------------------------------------------
 * The security audit found that the admin token is a committed string, that
 * CORS is a wildcard, and that the employee hash salt is a known constant.
 * Those are not fixed by this deployment work -- fixing them means replacing
 * the authentication model, which is a separate change.
 *
 * What this deployment work does guarantee is that none of them can reach
 * production *silently*. loadConfig() refuses to return, server.js exits 78,
 * and the container never serves a request. That guarantee is the entire
 * safety property, and it holds only as long as these rules do. A refactor
 * that reorders validateConfig, or a "helpful" default added to readConfig,
 * could remove a rule without any other test noticing -- every other test in
 * the suite runs with NODE_ENV=test, where all of this is deliberately skipped.
 *
 * So each test below asserts one specific thing that must never be allowed to
 * boot, and the last one asserts a correct production configuration still does.
 * A guard that rejects everything is not a guard, it is an outage.
 */

import { describe, it, expect } from "vitest";

import {
  loadConfig,
  readConfig,
  validateConfig,
  describeConfig,
  ConfigurationError,
} from "../../lib/config.js";

/**
 * A production environment with every rule satisfied. Mutated per test.
 *
 * The secrets are deliberately readable rather than random-looking. A
 * high-entropy literal in a repository is indistinguishable from a real leaked
 * credential -- to a secret scanner and to a human skimming a diff -- so these
 * say what they are while still clearing MIN_SECRET_LENGTH (32).
 */
function validProductionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    PORT: "5000",
    ADMIN_TOKEN: "not-a-real-admin-token-used-only-in-tests",
    FEEDBACK_HASH_SALT: "not-a-real-hash-salt-used-only-in-tests",
    CORS_ALLOWED_ORIGINS: "https://zerowaste.example.com",
    ZEROWASTE_DATA_DIR: "/var/lib/zerowaste",
    STORAGE_DRIVER: "s3",
    STORAGE_BUCKET: "zerowaste-invoices",
    STORAGE_REGION: "ap-south-1",
    ...overrides,
  };
}

/** The problems reported for an environment, or [] if it is accepted. */
function problemsFor(env) {
  try {
    loadConfig(env);
    return [];
  } catch (error) {
    if (error instanceof ConfigurationError) return error.problems;
    throw error;
  }
}

describe("production configuration guard", () => {
  it("accepts a correctly configured production environment", () => {
    expect(() => loadConfig(validProductionEnv())).not.toThrow();
  });

  describe("secrets", () => {
    it("refuses to boot with the committed default admin token", () => {
      // The exact string in the repository and in the frontend bundle. This is
      // matched exactly rather than scored heuristically, so a real secret that
      // happens to look weak is still accepted and this one never is.
      const problems = problemsFor(validProductionEnv({ ADMIN_TOKEN: "zerowaste-local-admin-token" }));
      expect(problems.join(" ")).toMatch(/ADMIN_TOKEN is still the committed development default/);
    });

    it("refuses to boot with the committed default hash salt", () => {
      const problems = problemsFor(validProductionEnv({ FEEDBACK_HASH_SALT: "zerowaste-local-development-salt" }));
      expect(problems.join(" ")).toMatch(/FEEDBACK_HASH_SALT is still the committed development default/);
    });

    it("refuses to boot when a secret is unset and falls back to the default", () => {
      // Unset is the dangerous case: readConfig substitutes the development
      // default, so without this rule an empty environment would boot with the
      // published token rather than failing.
      const env = validProductionEnv();
      delete env.ADMIN_TOKEN;
      delete env.FEEDBACK_HASH_SALT;

      const problems = problemsFor(env);
      expect(problems.some((p) => p.startsWith("ADMIN_TOKEN"))).toBe(true);
      expect(problems.some((p) => p.startsWith("FEEDBACK_HASH_SALT"))).toBe(true);
    });

    it("refuses short secrets even when they are not the default", () => {
      const problems = problemsFor(validProductionEnv({ ADMIN_TOKEN: "short-but-custom" }));
      expect(problems.join(" ")).toMatch(/at least \d+ characters/);
    });
  });

  describe("CORS", () => {
    it("refuses to boot with no origin allowlist", () => {
      const env = validProductionEnv();
      delete env.CORS_ALLOWED_ORIGINS;

      // Unset used to mean Access-Control-Allow-Origin: *, which is finding H1.
      expect(problemsFor(env).join(" ")).toMatch(/CORS_ALLOWED_ORIGINS is required in production/);
    });

    it("refuses a wildcard origin", () => {
      const problems = problemsFor(validProductionEnv({ CORS_ALLOWED_ORIGINS: "*" }));
      expect(problems.join(" ")).toMatch(/must name explicit origins/);
    });

    it("refuses a plaintext http origin", () => {
      // An allowlisted http:// origin means the browser will happily send the
      // admin token over a network anyone can read.
      const problems = problemsFor(validProductionEnv({ CORS_ALLOWED_ORIGINS: "http://zerowaste.example.com" }));
      expect(problems.join(" ")).toMatch(/uses plaintext http in production/);
    });

    it("allows http on loopback, which cannot be intercepted remotely", () => {
      expect(problemsFor(validProductionEnv({ CORS_ALLOWED_ORIGINS: "http://localhost:8080" }))).toEqual([]);
    });

    it("refuses an origin with a path, which never matches a browser Origin header", () => {
      // Browsers send scheme://host[:port] and nothing more, so an entry with a
      // path silently matches nothing -- a misconfiguration that looks correct.
      const problems = problemsFor(validProductionEnv({ CORS_ALLOWED_ORIGINS: "https://zerowaste.example.com/app" }));
      expect(problems.join(" ")).toMatch(/scheme and host with no trailing path/);
    });

    it("reports every bad origin in the list, not just the first", () => {
      const problems = problemsFor(
        validProductionEnv({ CORS_ALLOWED_ORIGINS: "http://a.example.com,https://good.example.com,http://b.example.com" })
      );
      expect(problems.filter((p) => p.includes("plaintext http"))).toHaveLength(2);
    });
  });

  describe("storage", () => {
    it("refuses the local invoice vault in production by default", () => {
      const problems = problemsFor(validProductionEnv({ STORAGE_DRIVER: "local" }));
      expect(problems.join(" ")).toMatch(/writes the invoice vault to the container filesystem/);
    });

    it("permits the local vault only when explicitly acknowledged", () => {
      // The single-replica-with-a-volume deployment is legitimate; it just has
      // to be asked for by name rather than arrived at by omission.
      expect(problemsFor(validProductionEnv({ STORAGE_DRIVER: "local", STORAGE_ALLOW_LOCAL: "true" }))).toEqual([]);
    });

    it("requires a bucket when using s3", () => {
      const env = validProductionEnv();
      delete env.STORAGE_BUCKET;
      expect(problemsFor(env).join(" ")).toMatch(/STORAGE_BUCKET is required/);
    });

    it("requires a region or an endpoint when using s3", () => {
      const env = validProductionEnv();
      delete env.STORAGE_REGION;
      expect(problemsFor(env).join(" ")).toMatch(/STORAGE_REGION or STORAGE_ENDPOINT is required/);
    });
  });

  describe("data directory", () => {
    it("refuses to boot without an explicit data directory", () => {
      const env = validProductionEnv();
      delete env.ZEROWASTE_DATA_DIR;
      expect(problemsFor(env).join(" ")).toMatch(/ZEROWASTE_DATA_DIR is required in production/);
    });
  });

  describe("error reporting", () => {
    it("reports every problem at once rather than the first", () => {
      // One restart should reveal the whole picture. Failing on the first
      // problem turns a misconfigured deploy into a sequence of deploys.
      const problems = problemsFor({ NODE_ENV: "production" });

      expect(problems.length).toBeGreaterThanOrEqual(4);
      expect(problems.some((p) => p.startsWith("ADMIN_TOKEN"))).toBe(true);
      expect(problems.some((p) => p.startsWith("FEEDBACK_HASH_SALT"))).toBe(true);
      expect(problems.some((p) => p.startsWith("CORS_ALLOWED_ORIGINS"))).toBe(true);
      expect(problems.some((p) => p.startsWith("ZEROWASTE_DATA_DIR"))).toBe(true);
    });

    it("explains why each default is unsafe, not merely that it is rejected", () => {
      // The message is read by whoever is being paged at the time. "Invalid
      // ADMIN_TOKEN" sends them looking for a typo; naming the actual exposure
      // sends them to generate a secret.
      const problems = problemsFor(validProductionEnv({ ADMIN_TOKEN: "zerowaste-local-admin-token" }));
      expect(problems.join(" ")).toMatch(/compiled into the frontend bundle/);
    });
  });

  describe("development and test remain permissive", () => {
    // Every other test file in this suite runs with NODE_ENV=test and no
    // configuration at all. If the production rules ever leaked into other
    // environments, the whole suite would fail to construct an app.
    it.each(["development", "test"])("accepts a bare %s environment", (nodeEnv) => {
      expect(() => loadConfig({ NODE_ENV: nodeEnv })).not.toThrow();
    });

    it("still validates environment-independent rules outside production", () => {
      // Type errors are wrong everywhere; a bad STORAGE_DRIVER is a typo, not
      // a deployment decision.
      const problems = validateConfig(readConfig({ NODE_ENV: "development", STORAGE_DRIVER: "gcs" }));
      expect(problems.join(" ")).toMatch(/STORAGE_DRIVER must be/);
    });
  });

  describe("describeConfig", () => {
    it("never returns a secret value", () => {
      const config = readConfig(validProductionEnv());
      const described = JSON.stringify(describeConfig(config));

      // This output goes to the boot log and to /health/info, which is
      // unauthenticated. Reporting whether a secret is set is useful;
      // reporting what it is would publish it.
      expect(described).not.toContain(config.security.adminToken);
      expect(described).not.toContain(config.security.hashSalt);
    });
  });
});
