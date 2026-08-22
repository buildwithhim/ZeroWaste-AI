import { useEffect, useState } from "react";
import axios from "axios";
import { BarChart3, ChefHat, FileUp, Gauge, Leaf, LogOut, Menu, ShieldCheck, TrendingDown, Users, Utensils, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import useAuth from "../context/useAuth";

type Forecast = { predictedOrders: number; confidence: number; foodSavedKg: number; workerMeals: number };

const defaultForecast: Forecast = { predictedOrders: 337, confidence: 94, foodSavedKg: 18, workerMeals: 36 };
const navItems = [
  { label: "Overview", icon: Gauge },
  { label: "Kitchen", icon: ChefHat },
  { label: "Analytics", icon: BarChart3 },
  { label: "Invoice Sync", icon: FileUp },
  { label: "ESG Impact", icon: Leaf },
];

export default function AdminDashboard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [forecast, setForecast] = useState<Forecast>(defaultForecast);
  const [isLoading, setIsLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activePanel, setActivePanel] = useState("Overview");

  useEffect(() => {
    axios.get<Forecast>("http://localhost:5000/forecast")
      .then(({ data }) => setForecast(data))
      .catch(() => setForecast(defaultForecast))
      .finally(() => setIsLoading(false));
  }, []);

  const signOut = () => { logout(); navigate("/login", { replace: true }); };

  return (
    <main className="admin-workspace">
      <aside className={`admin-sidebar${isSidebarOpen ? " open" : ""}`}>
        <div className="admin-sidebar-brand"><div className="brand-mark"><Leaf size={20} /></div><span>ZeroWaste AI</span><button type="button" className="sidebar-close" aria-label="Close navigation" onClick={() => setIsSidebarOpen(false)}><X size={18} /></button></div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Admin navigation">{navItems.map(({ label, icon: Icon }) => <button type="button" className={activePanel === label ? "active" : ""} key={label} onClick={() => { setActivePanel(label); setIsSidebarOpen(false); }}><Icon size={18} />{label}</button>)}</nav>
        <div className="sidebar-footer"><div className="sidebar-user"><span className="admin-avatar">AM</span><span><strong>Alex Morgan</strong><small>Administrator</small></span></div><button type="button" className="sidebar-signout" onClick={signOut}><LogOut size={16} /></button></div>
      </aside>
      {isSidebarOpen && <button type="button" className="sidebar-overlay" aria-label="Close navigation" onClick={() => setIsSidebarOpen(false)} />}
      <section className="admin-main">
        <header className="admin-topbar"><button type="button" className="sidebar-toggle" aria-label="Open navigation" onClick={() => setIsSidebarOpen(true)}><Menu size={20} /></button><div className="admin-topbar-title"><span className="eyebrow">ADMIN CONSOLE</span><strong>Operations workspace</strong></div><div className="admin-topbar-actions"><span className="admin-badge"><ShieldCheck size={14} /> Admin workspace</span><span className="topbar-avatar">AM</span></div></header>
        {activePanel === "Overview" || activePanel === "Kitchen" ? <AdminOverview forecast={forecast} isLoading={isLoading} kitchenOnly={activePanel === "Kitchen"} /> : <PlaceholderPanel title={activePanel} />}
      </section>
    </main>
  );
}

function AdminOverview({ forecast, isLoading, kitchenOnly }: { forecast: Forecast; isLoading: boolean; kitchenOnly: boolean }) {
  const metrics = [
    { label: "Predicted Orders", value: forecast.predictedOrders, detail: "Tomorrow's lunch", icon: Utensils, tone: "blue" },
    { label: "Confidence", value: forecast.confidence, suffix: "%", detail: "Forecast certainty", icon: Gauge, tone: "purple" },
    { label: "Food Saved", value: forecast.foodSavedKg, suffix: " kg", detail: "Estimated this week", icon: TrendingDown, tone: "green" },
    { label: "Worker Meals", value: forecast.workerMeals, detail: "Meals preserved", icon: Users, tone: "orange" },
  ];

  return <div className="admin-page-content"><div className="admin-page-heading"><div><span className="eyebrow">{kitchenOnly ? "KITCHEN CONTROL" : "OVERVIEW"}</span><h1>{kitchenOnly ? "Kitchen operations" : "Good morning, Alex."}</h1><p>{kitchenOnly ? "Turn today's demand signal into a confident prep plan." : "Your cafeteria is ready for a smarter service."}</p></div><div className="date-chip">Friday, 22 August 2026</div></div>{!kitchenOnly && <section className="admin-metrics" aria-label="Forecast metrics">{metrics.map(({ label, value, suffix = "", detail, icon: Icon, tone }) => <article className="admin-metric" key={label}><div className={`admin-metric-icon ${tone}`}><Icon size={20} /></div><span>{label}</span><strong>{isLoading ? "--" : `${value}${suffix}`}</strong><small>{detail}</small></article>)}</section>}<section className="admin-content"><article className="admin-panel kitchen-panel"><div className="panel-heading"><div><span className="eyebrow">KITCHEN PANEL</span><h2>Today's preparation plan</h2></div><span className="live-indicator"><i /> Live</span></div><div className="kitchen-stat"><span><strong>Live Orders</strong><small>Orders placed today</small></span><b>{isLoading ? "--" : forecast.predictedOrders}</b></div><div className="kitchen-stat"><span><strong>Recommended Cooking Quantity</strong><small>Based on AI forecast + demand</small></span><b>{isLoading ? "--" : forecast.predictedOrders + 18}</b></div><div className="kitchen-stat"><span><strong>Buffer Meals</strong><small>Recommended service buffer</small></span><b>{isLoading ? "--" : 18}</b></div><div className="kitchen-progress"><div><span>Prep readiness</span><strong>82%</strong></div><div className="progress"><i style={{ width: "82%" }} /></div></div></article><article className="admin-panel admin-callout"><div className="callout-icon"><ChefHat size={23} /></div><span className="eyebrow">AI GUIDANCE</span><h2>Cook with confidence.</h2><p>Plan for <strong>{isLoading ? "--" : forecast.predictedOrders + 18} meals</strong> today. The buffer protects availability while keeping avoidable waste low.</p><div className="callout-foot"><Leaf size={15} /> Waste-aware recommendation</div></article></section></div>;
}

function PlaceholderPanel({ title }: { title: string }) {
  return <div className="admin-page-content"><div className="admin-page-heading"><div><span className="eyebrow">ADMIN CONSOLE</span><h1>{title}</h1><p>This workspace is ready for your next operational insight.</p></div></div><div className="admin-panel placeholder-panel"><div className="callout-icon"><BarChart3 size={23} /></div><h2>{title} tools are coming soon</h2><p>The overview and kitchen forecast are available today.</p></div></div>;
}
