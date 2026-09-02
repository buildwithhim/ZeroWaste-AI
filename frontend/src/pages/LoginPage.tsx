import { ArrowRight, ShieldCheck, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth, type Role } from "../context/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const continueAs = (role: Role) => { login(role); navigate(`/${role}`, { replace: true }); };

  return <main className="login-page"><section className="login-panel"><div className="login-brand"><span className="brand-mark"><span>ZW</span></span><strong>ZeroWaste AI</strong></div><div className="login-copy"><span className="eyebrow">MICROSOFT FLUENT WORKSPACE</span><h1>Better decisions.<br /><em>Less waste.</em></h1><p>Sign in to your cafeteria operations workspace and turn every forecast into measurable impact.</p></div><div className="login-actions"><button className="role-card" onClick={() => continueAs("employee")}><span className="role-icon"><Users size={21} /></span><span><strong>Continue as Employee</strong><small>See your daily meals and impact</small></span><ArrowRight size={18} /></button><button className="role-card" onClick={() => continueAs("admin")}><span className="role-icon admin"><ShieldCheck size={21} /></span><span><strong>Continue as Admin</strong><small>Manage forecasts and operations</small></span><ArrowRight size={18} /></button></div><p className="demo-note">Demo access · no password required</p></section><aside className="login-aside"><div className="aside-orbit orbit-one" /><div className="aside-orbit orbit-two" /><div className="aside-content"><span className="aside-label">TODAY'S SIGNAL</span><strong>337</strong><span>meals forecast</span><div className="signal-line"><span>Forecast confidence</span><b>94%</b></div><div className="signal-bar"><i /></div><p>AI-guided planning keeps the kitchen ready and resources in motion.</p></div></aside></main>;
}
