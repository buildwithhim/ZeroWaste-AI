import { Outlet } from "react-router-dom";
import FluentLayout from "../layout/FluentLayout";

export default function EmployeeDashboard() {
  return <FluentLayout role="employee"><Outlet /></FluentLayout>;
}
