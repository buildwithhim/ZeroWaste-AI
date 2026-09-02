import { createContext, useContext, useState, type ReactNode } from "react";

export type Role = "employee" | "admin";

type AuthContextValue = {
  role: Role | null;
  login: (role: Role) => void;
  logout: () => void;
};

const ROLE_KEY = "zerowaste-role";
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(() => {
    const storedRole = localStorage.getItem(ROLE_KEY);
    return storedRole === "employee" || storedRole === "admin" ? storedRole : null;
  });

  const login = (nextRole: Role) => {
    localStorage.setItem(ROLE_KEY, nextRole);
    setRole(nextRole);
  };

  const logout = () => {
    localStorage.removeItem(ROLE_KEY);
    setRole(null);
  };

  return <AuthContext.Provider value={{ role, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
