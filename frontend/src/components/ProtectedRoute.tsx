import { Navigate, Outlet } from "react-router-dom";
import { useAuth, type Role } from "../context/AuthContext";

export default function ProtectedRoute({ allowedRole }: { allowedRole: Role }) {
  const { role } = useAuth();
  return role === allowedRole ? <Outlet /> : <Navigate to="/login" replace />;
}
