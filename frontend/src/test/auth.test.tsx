/**
 * Authentication and client-side authorization.
 *
 * These tests cover the login screen, the auth context and the route guard.
 * Several of them assert behaviour the security audit flags as CRITICAL (C1:
 * the role is a client-controlled localStorage value). They are written as
 * characterization tests -- they pin what the app does today so that a fix is
 * a visible, deliberate test change rather than a silent behaviour drift.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AuthProvider, useAuth } from "../context/AuthContext";
import ProtectedRoute from "../components/ProtectedRoute";
import LoginPage from "../pages/LoginPage";

const ROLE_KEY = "zerowaste-role";

function AdminScreen() {
  return <h1>Admin workspace</h1>;
}

function EmployeeScreen() {
  return <h1>Employee workspace</h1>;
}

function LoginScreen() {
  return <h1>Sign in</h1>;
}

/** Mounts the two guarded areas plus login, so redirects are observable. */
function renderApp(initialEntry: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route element={<ProtectedRoute allowedRole="employee" />}>
            <Route path="/employee" element={<EmployeeScreen />} />
          </Route>
          <Route element={<ProtectedRoute allowedRole="admin" />}>
            <Route path="/admin" element={<AdminScreen />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe("AuthContext", () => {
  function Probe() {
    const { role, login, logout } = useAuth();
    return (
      <div>
        <span data-testid="role">{role ?? "anonymous"}</span>
        <button onClick={() => login("employee")}>be employee</button>
        <button onClick={() => login("admin")}>be admin</button>
        <button onClick={logout}>sign out</button>
      </div>
    );
  }

  it("starts anonymous with no stored role", () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    expect(screen.getByTestId("role")).toHaveTextContent("anonymous");
  });

  it("restores a stored employee role on mount", () => {
    localStorage.setItem(ROLE_KEY, "employee");
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    expect(screen.getByTestId("role")).toHaveTextContent("employee");
  });

  it.each(["", "administrator", "ADMIN", "superuser", "null", "{}"])(
    "ignores the unrecognised stored role %j and stays anonymous",
    (stored) => {
      localStorage.setItem(ROLE_KEY, stored);
      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      );
      expect(screen.getByTestId("role")).toHaveTextContent("anonymous");
    }
  );

  it("persists the role to localStorage on login", async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await user.click(screen.getByRole("button", { name: "be employee" }));
    expect(localStorage.getItem(ROLE_KEY)).toBe("employee");
    expect(screen.getByTestId("role")).toHaveTextContent("employee");
  });

  it("clears the stored role on logout", async () => {
    const user = userEvent.setup();
    localStorage.setItem(ROLE_KEY, "admin");
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await user.click(screen.getByRole("button", { name: "sign out" }));
    expect(localStorage.getItem(ROLE_KEY)).toBeNull();
    expect(screen.getByTestId("role")).toHaveTextContent("anonymous");
  });

  it("throws when used outside a provider", () => {
    // React re-throws through a jsdom error event as well as console.error, so
    // both channels are muted to keep an intentional failure out of the report.
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    const swallow = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", swallow);
    try {
      expect(() => render(<Probe />)).toThrow(/useAuth must be used within an AuthProvider/);
    } finally {
      window.removeEventListener("error", swallow);
      silence.mockRestore();
    }
  });
});

describe("ProtectedRoute", () => {
  it("renders the employee area for an employee", () => {
    localStorage.setItem(ROLE_KEY, "employee");
    renderApp("/employee");
    expect(screen.getByRole("heading", { name: "Employee workspace" })).toBeInTheDocument();
  });

  it("renders the admin area for an admin", () => {
    localStorage.setItem(ROLE_KEY, "admin");
    renderApp("/admin");
    expect(screen.getByRole("heading", { name: "Admin workspace" })).toBeInTheDocument();
  });

  it("redirects an anonymous visitor away from the employee area", () => {
    renderApp("/employee");
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Employee workspace" })).not.toBeInTheDocument();
  });

  it("redirects an anonymous visitor away from the admin area", () => {
    renderApp("/admin");
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  /**
   * Role isolation, client side. An employee session must not render the admin
   * shell -- this is the UI half of the requirement that an employee can never
   * reach admin functionality. The API half lives in
   * backend/tests/api/authorization.test.js, which is the half that actually
   * enforces it.
   */
  it("does not render the admin area for an employee", () => {
    localStorage.setItem(ROLE_KEY, "employee");
    renderApp("/admin");
    expect(screen.queryByRole("heading", { name: "Admin workspace" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("does not render the employee area for an admin", () => {
    localStorage.setItem(ROLE_KEY, "admin");
    renderApp("/employee");
    expect(screen.queryByRole("heading", { name: "Employee workspace" })).not.toBeInTheDocument();
  });

  /**
   * KNOWN GAP (audit C1 -- Critical). The route guard trusts localStorage, so
   * editing one string in devtools promotes an employee to admin without any
   * server involvement. This test documents the vulnerability; it must be
   * inverted once authentication moves to a server-issued session.
   */
  it("KNOWN GAP: grants the admin area to anyone who writes 'admin' into localStorage", () => {
    localStorage.setItem(ROLE_KEY, "admin");
    renderApp("/admin");
    expect(screen.getByRole("heading", { name: "Admin workspace" })).toBeInTheDocument();
  });
});

describe("LoginPage", () => {
  function renderLogin() {
    return render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/login"]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/employee" element={<EmployeeScreen />} />
            <Route path="/admin" element={<AdminScreen />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
  }

  it("offers exactly the two roles", () => {
    renderLogin();
    expect(screen.getByRole("button", { name: /Continue as Employee/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue as Admin/ })).toBeInTheDocument();
  });

  it("signs in as an employee and lands on the employee workspace", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: /Continue as Employee/ }));
    expect(await screen.findByRole("heading", { name: "Employee workspace" })).toBeInTheDocument();
    expect(localStorage.getItem(ROLE_KEY)).toBe("employee");
  });

  it("signs in as an admin and lands on the admin workspace", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: /Continue as Admin/ }));
    expect(await screen.findByRole("heading", { name: "Admin workspace" })).toBeInTheDocument();
    expect(localStorage.getItem(ROLE_KEY)).toBe("admin");
  });

  /**
   * KNOWN GAP (audit C1 -- Critical). There is no password field, no request
   * and no credential of any kind: choosing "Admin" is the whole of the
   * authentication. Asserted explicitly so the absence cannot go unnoticed.
   */
  it("KNOWN GAP: collects no credential at all", () => {
    renderLogin();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    expect(document.querySelector("input[type=password]")).toBeNull();
    expect(screen.getByText(/no password required/i)).toBeInTheDocument();
  });

  it("KNOWN GAP: reaches admin without contacting the server", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderLogin();
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Continue as Admin/ }));
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
