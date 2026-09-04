import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],

    // Runs before any test module is imported, which matters: requireAdmin.js
    // reads ADMIN_TOKEN at module load, so the environment has to be correct
    // before the first `import` of the app.
    setupFiles: ["./tests/helpers/setup.js"],

    // Each test file gets its own process, so the per-file data sandbox in
    // helpers/sandbox.js cannot leak into a sibling suite.
    pool: "forks",
    isolate: true,

    // The invoice and prediction suites spawn a real Python interpreter.
    testTimeout: 30_000,
    hookTimeout: 30_000,

    coverage: {
      provider: "v8",
      include: ["lib/**/*.js", "server.js"],
      reporter: ["text", "lcov"],
      // Gates, not aspirations: CI fails below these.
      thresholds: { lines: 70, functions: 70, branches: 60, statements: 70 },
    },
  },
});
