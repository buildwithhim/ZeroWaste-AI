/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // vi.fn() mocks created in a module factory are not spies, so restoreMocks
    // leaves their call history in place. Without this, a call recorded by one
    // test is still visible to the next.
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/context/**", "src/components/**", "src/services/**", "src/pages/LoginPage.tsx"],
    },
  },
});
