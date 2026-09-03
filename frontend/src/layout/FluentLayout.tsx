import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { BarChart3, CalendarDays, FileUp, LayoutDashboard, Leaf, LogOut, Menu, Moon, ReceiptText, Sun, User, Workflow, X } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth, type Role } from "../context/AuthContext";
import ConfirmDialog from "../components/ConfirmDialog";

type FluentLayoutProps = { children: ReactNode; role: Role };

/**
 * Navigation per role. The two lists never mix: an employee session renders
 * only the employee list, so no administrator destination is reachable, or even
 * nameable, from the employee interface.
 *
 * Labels say what the employee will do there rather than what the screen is
 * called. "Today's menu" led to a page that plans a whole week, which is the
 * kind of small mismatch that makes an app need explaining.
 */
const linksByRole = {
  employee: [{ label: "My week", to: "/employee", icon: LayoutDashboard }, { label: "Book meals", to: "/employee/menu", icon: CalendarDays }, { label: "My bookings", to: "/employee/orders", icon: ReceiptText }, { label: "Profile", to: "/employee/profile", icon: User }],
    admin: [{ label: "Overview", to: "/admin", icon: LayoutDashboard }, { label: "Kitchen", to: "/admin/kitchen", icon: CalendarDays }, { label: "Analytics", to: "/admin/analytics", icon: BarChart3 }, { label: "Data Pipeline", to: "/admin/pipeline", icon: Workflow }, { label: "Invoice Sync", to: "/admin/invoices", icon: FileUp }, { label: "ESG Report", to: "/admin/esg", icon: Leaf }],
} satisfies Record<Role, { label: string; to: string; icon: typeof LayoutDashboard }[]>;

export default function FluentLayout({ children, role }: FluentLayoutProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDark, setIsDark] = useState(() => localStorage.getItem("zerowaste-theme") === "dark");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const { logout } = useAuth();
  const navigate = useNavigate();
  const links = linksByRole[role];
  const displayName = role === "admin" ? "Alex Morgan" : "Jordan Lee";
  useEffect(() => { localStorage.setItem("zerowaste-theme", isDark ? "dark" : "light"); }, [isDark]);

  const signOut = () => {
    setConfirmSignOut(false);
    logout();
    navigate("/login", { replace: true });
  };

  return <motion.div className={`fluent-app-shell${isDark ? " dark-mode" : ""}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
    <aside className={`fluent-sidebar${isOpen ? " is-open" : ""}`}>
      <div className="sidebar-brand"><span className="brand-mark"><Leaf size={19} /></span><span>ZeroWaste AI</span><button className="icon-button sidebar-close" onClick={() => setIsOpen(false)} aria-label="Close navigation"><X size={19} /></button></div>
      <div className="sidebar-kicker">{role === "admin" ? "Operations" : "Workspace"}</div>
      <nav className="sidebar-links" aria-label="Primary navigation">{links.map(({ label, to, icon: Icon }) => <NavLink key={to} to={to} end onClick={() => setIsOpen(false)}><Icon size={18} /><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="profile-row"><span className="avatar">{role === "admin" ? "AM" : "JL"}</span><span><strong>{displayName}</strong><small>{role === "admin" ? "Administrator" : "Employee"}</small></span></div><button className="icon-button" onClick={() => setConfirmSignOut(true)} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button></div>
    </aside>
    {isOpen && <button className="sidebar-backdrop" onClick={() => setIsOpen(false)} aria-label="Close navigation" />}
    <div className="fluent-content"><header className="fluent-topbar"><button className="icon-button menu-button" onClick={() => setIsOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="topbar-title"><span className="topbar-label">ZERO WASTE AI</span><strong>{role === "admin" ? "Operations hub" : "Employee workspace"}</strong></div><div className="topbar-actions"><button className="icon-button" onClick={() => setIsDark((current) => !current)} aria-label={isDark ? "Use light mode" : "Use dark mode"} title={isDark ? "Use light mode" : "Use dark mode"}>{isDark ? <Sun size={18} /> : <Moon size={18} />}</button><span className="topbar-avatar">{role === "admin" ? "AM" : "JL"}</span></div></header><main>{children}</main></div>
    {confirmSignOut && <ConfirmDialog title="Sign out?" message="You will be returned to the sign-in screen. Your saved meal plan is kept." confirmLabel="Sign out" cancelLabel="Stay signed in" onConfirm={signOut} onCancel={() => setConfirmSignOut(false)} />}
  </motion.div>;
}
