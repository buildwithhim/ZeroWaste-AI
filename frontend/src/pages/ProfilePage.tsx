/**
 * The employee's profile and personal impact.
 *
 * Two things were removed here rather than kept. "Notifications: Meal reminders
 * enabled" described a feature that does not exist -- there are no reminders to
 * enable, and the page offered no way to change it, so it was a claim rather
 * than a setting. And sign-out fired on a single click with no confirmation, in
 * a spot easy to hit by accident on a phone.
 *
 * What replaces the notification row is the plate preference, which is a real
 * setting: it is the portion a booking gets when the cafeteria has too little
 * feedback to recommend one.
 */

import { Building2, LogOut, Mail, ShieldCheck, UserRound, UtensilsCrossed } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import ConfirmDialog from "../components/ConfirmDialog";
import SustainabilityScore from "../components/SustainabilityScore";
import { useAuth } from "../context/AuthContext";
import { useBookings, type Appetite } from "../context/BookingContext";

const plates: { name: Appetite; hint: string }[] = [
  { name: "Light", hint: "Smaller plate" },
  { name: "Regular", hint: "Standard serving" },
  { name: "Heavy", hint: "Fuller plate" },
];

export default function ProfilePage() {
  const { logout } = useAuth();
  const { appetitePreference, setAppetitePreference } = useBookings();
  const navigate = useNavigate();
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const signOut = () => {
    setConfirmSignOut(false);
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="page-frame profile-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">PROFILE</span>
          <h1>Your profile</h1>
          <p>Your details, your default plate size, and the impact of your planning.</p>
        </div>
      </div>

      <SustainabilityScore />

      <section className="profile-card">
        <div className="large-avatar">JL</div>
        <div>
          <h2>Jordan Lee</h2>
          <p>Employee · Redmond campus</p>
        </div>
        <span className="profile-active">Active</span>
      </section>

      <section className="profile-preference" aria-labelledby="plate-preference-title">
        <div>
          <span className="detail-icon">
            <UtensilsCrossed size={18} />
          </span>
          <span>
            <small>Default plate size</small>
            <strong id="plate-preference-title">Used when we have no suggestion for a dish</strong>
          </span>
        </div>
        <div className="plate-picker" role="group" aria-labelledby="plate-preference-title">
          {plates.map((plate) => (
            <button
              key={plate.name}
              type="button"
              className={`plate-chip${appetitePreference === plate.name ? " selected" : ""}`}
              onClick={() => setAppetitePreference(plate.name)}
              aria-pressed={appetitePreference === plate.name}
            >
              <strong>{plate.name}</strong>
              <small>{plate.hint}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="profile-details">
        <div>
          <span className="detail-icon">
            <Mail size={18} />
          </span>
          <span>
            <small>Work email</small>
            <strong>jordan.lee@contoso.com</strong>
          </span>
        </div>
        <div>
          <span className="detail-icon">
            <Building2 size={18} />
          </span>
          <span>
            <small>Department</small>
            <strong>Workplace services</strong>
          </span>
        </div>
        <div>
          <span className="detail-icon">
            <ShieldCheck size={18} />
          </span>
          <span>
            <small>Your privacy</small>
            <strong>Your bookings and ratings are only ever shared as counts</strong>
          </span>
        </div>
        <div>
          <span className="detail-icon">
            <UserRound size={18} />
          </span>
          <span>
            <small>Account type</small>
            <strong>Employee workspace</strong>
          </span>
        </div>
      </section>

      <button type="button" className="sign-out-button" onClick={() => setConfirmSignOut(true)}>
        <LogOut size={17} /> Sign out
      </button>

      {confirmSignOut && (
        <ConfirmDialog
          title="Sign out?"
          message="You will be returned to the sign-in screen. Your saved meal plan is kept."
          confirmLabel="Sign out"
          cancelLabel="Stay signed in"
          onConfirm={signOut}
          onCancel={() => setConfirmSignOut(false)}
        />
      )}
    </div>
  );
}
