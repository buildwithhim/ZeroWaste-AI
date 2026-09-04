/**
 * Harness smoke test.
 *
 * Proves jsdom, the React plugin, Testing Library and the localStorage reset
 * are all wired up before any real component test depends on them.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

describe("frontend test harness", () => {
  it("renders a component into jsdom", () => {
    render(<h1>ZeroWaste AI</h1>);
    expect(screen.getByRole("heading", { name: "ZeroWaste AI" })).toBeInTheDocument();
  });

  it("provides a working localStorage", () => {
    localStorage.setItem("probe", "value");
    expect(localStorage.getItem("probe")).toBe("value");
  });

  it("clears localStorage between tests", () => {
    expect(localStorage.getItem("probe")).toBeNull();
  });

  it("provides crypto.randomUUID", () => {
    expect(typeof crypto.randomUUID()).toBe("string");
  });
});
