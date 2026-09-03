import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminDashboard from "./pages/AdminDashboard";
import AdminOverviewPage from "./pages/AdminOverviewPage";
import KitchenPage from "./pages/KitchenPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import DataPipelinePage from "./pages/DataPipelinePage";
import InvoiceSyncPage from "./pages/InvoiceSyncPage";
import EsgImpactPage from "./pages/EsgImpactPage";
import EmployeeDashboard from "./pages/EmployeeDashboard";
import EmployeeHomePage from "./pages/EmployeeHomePage";
import OrderHistoryPage from "./pages/OrderHistoryPage";
import ProfilePage from "./pages/ProfilePage";
import TodaysMenuPage from "./pages/TodaysMenuPage";
import LoginPage from "./pages/LoginPage";
import NotFound from "./pages/NotFound";
import { useAuth } from "./context/AuthContext";

function HomeRedirect() {
  const { role } = useAuth();
  return <Navigate to={role ? `/${role}` : "/login"} replace />;
}

export default function App() {
  return <Routes>
    <Route path="/" element={<HomeRedirect />} />
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute allowedRole="employee" />}><Route path="/employee" element={<EmployeeDashboard />}><Route index element={<EmployeeHomePage />} /><Route path="menu" element={<TodaysMenuPage />} /><Route path="orders" element={<OrderHistoryPage />} /><Route path="history" element={<OrderHistoryPage />} /><Route path="profile" element={<ProfilePage />} /></Route></Route>
    <Route element={<ProtectedRoute allowedRole="admin" />}><Route path="/admin" element={<AdminDashboard />}><Route index element={<AdminOverviewPage />} /><Route path="kitchen" element={<KitchenPage />} /><Route path="analytics" element={<AnalyticsPage />} /><Route path="pipeline" element={<DataPipelinePage />} /><Route path="invoices" element={<InvoiceSyncPage />} /><Route path="esg" element={<EsgImpactPage />} /></Route></Route>
    <Route path="*" element={<NotFound />} />
  </Routes>;
}
