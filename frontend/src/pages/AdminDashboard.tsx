import { Outlet } from "react-router-dom";

import FluentLayout from "../layout/FluentLayout";

/**
 * Admin shell.
 *
 * This used to fetch a forecast and hand every admin page a fallback object
 * full of invented figures -- 337 orders, 94% confidence, 18 kg saved -- which
 * rendered indistinguishably from real data whenever the backend was slow or
 * down. Each page now loads exactly the operational data it needs and says so
 * when that data is unavailable.
 */
export default function AdminDashboard() {
  return (
    <FluentLayout role="admin">
      <Outlet />
    </FluentLayout>
  );
}