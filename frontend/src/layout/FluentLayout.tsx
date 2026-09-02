import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { BarChart3, CalendarDays, FileUp, LayoutDashboard, Leaf, LogOut, Menu, Moon, Settings, Sun, Users, X } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth, type Role } from "../context/AuthContext";

type FluentLayoutProps = { children: ReactNode; role: Role };

const linksByRole = {
  employee: [{ label: "Home", to: "/employee", icon: LayoutDashboard }, { label: "Today's menu", to: "/employee/menu", icon: CalendarDays }, { label: "My Orders", to: "/employee/orders", icon: Users }, { label: "Profile", to: "/employee/profile", icon: Users }],
    admin: [{ label: "Overview", to: "/admin", icon: LayoutDashboard }, { label: "Kitchen", to: "/admin/kitchen", icon: CalendarDays }, { label: "Analytics", to: "/admin/analytics", icon: BarChart3 }, { label: "Invoice Sync", to: "/admin/invoices", icon: FileUp }, { label: "ESG Report", to: "/admin/esg", icon: Leaf }],
} satisfies Record<Role, { label: string; to: string; icon: typeof LayoutDashboard }[]>;

export default function FluentLayout({ children, role }: FluentLayoutProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDark, setIsDark] = useState(() => localStorage.getItem("zerowaste-theme") === "dark");
  const { logout } = useAuth();
  const navigate = useNavigate();
  const links = linksByRole[role];
  const displayName = role === "admin" ? "Alex Morgan" : "Jordan Lee";
  useEffect(() => { localStorage.setItem("zerowaste-theme", isDark ? "dark" : "light"); }, [isDark]);

  const signOut = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return <motion.div className={`fluent-app-shell${isDark ? " dark-mode" : ""}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
    <aside className={`fluent-sidebar${isOpen ? " is-open" : ""}`}>
      <div className="sidebar-brand"><span className="brand-mark"><Leaf size={19} /></span><span>ZeroWaste AI</span><button className="icon-button sidebar-close" onClick={() => setIsOpen(false)} aria-label="Close navigation"><X size={19} /></button></div>
      <div className="sidebar-kicker">{role === "admin" ? "Operations" : "Workspace"}</div>
      <nav className="sidebar-links" aria-label="Primary navigation">{links.map(({ label, to, icon: Icon }) => <NavLink key={to} to={to} end onClick={() => setIsOpen(false)}><Icon size={18} /><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="profile-row"><span className="avatar">{role === "admin" ? "AM" : "JL"}</span><span><strong>{displayName}</strong><small>{role === "admin" ? "Administrator" : "Employee"}</small></span></div><button className="icon-button" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button></div>
    </aside>
    {isOpen && <button className="sidebar-backdrop" onClick={() => setIsOpen(false)} aria-label="Close navigation" />}
    <div className="fluent-content"><header className="fluent-topbar"><button className="icon-button menu-button" onClick={() => setIsOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="topbar-title"><span className="topbar-label">ZERO WASTE AI</span><strong>{role === "admin" ? "Operations hub" : "Employee workspace"}</strong></div><div className="topbar-actions"><span className="status-pill"><span /> Ready</span><button className="icon-button" onClick={() => setIsDark((current) => !current)} aria-label={isDark ? "Use light mode" : "Use dark mode"} title={isDark ? "Use light mode" : "Use dark mode"}>{isDark ? <Sun size={18} /> : <Moon size={18} />}</button><button className="icon-button settings-button" aria-label="Settings" title="Settings"><Settings size={18} /></button><span className="topbar-avatar">{role === "admin" ? "AM" : "JL"}</span></div></header><main>{children}</main></div>
  </motion.div>;
}
