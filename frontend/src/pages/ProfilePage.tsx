import { Bell, Building2, LogOut, Mail, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import SustainabilityScore from "../components/SustainabilityScore";

export default function ProfilePage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const signOut = () => { logout(); navigate("/login", { replace: true }); };
  return <div className="page-frame profile-page"><div className="page-intro"><div><span className="eyebrow">PROFILE</span><h1>Your profile</h1><p>Manage your workspace details and notification preferences.</p></div></div><SustainabilityScore /><section className="profile-card"><div className="large-avatar">JL</div><div><h2>Jordan Lee</h2><p>Employee · Redmond campus</p></div><span className="profile-active">Active</span></section><section className="profile-details"><div><span className="detail-icon"><Mail size={18} /></span><span><small>Work email</small><strong>jordan.lee@contoso.com</strong></span></div><div><span className="detail-icon"><Building2 size={18} /></span><span><small>Department</small><strong>Workplace services</strong></span></div><div><span className="detail-icon"><Bell size={18} /></span><span><small>Notifications</small><strong>Meal reminders enabled</strong></span></div><div><span className="detail-icon"><UserRound size={18} /></span><span><small>Account type</small><strong>Employee workspace</strong></span></div></section><button type="button" className="sign-out-button" onClick={signOut}><LogOut size={17} /> Sign out</button></div>;
}
