/**
 * jsdom shims for the browser APIs this app relies on.
 *
 * The booking flow reads `crypto.randomUUID` and `matchMedia` at module scope,
 * and Recharts measures elements, so all three need to exist before any
 * component renders rather than being patched per test.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
}

if (typeof globalThis.crypto.randomUUID !== "function") {
  let counter = 0;
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    writable: true,
    value: () => `00000000-0000-4000-8000-${String(counter++).padStart(12, "0")}`,
  });
}

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!window.scrollTo) {
  window.scrollTo = (() => {}) as typeof window.scrollTo;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
});
