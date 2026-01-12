// src/features/admin/admin.routes.jsx
import RequireRole from "../../app/guards/RequireRole.jsx";
import { Roles } from "../../app/config/roles.js";

import AdminDashboardPage from "./pages/AdminDashboardPage.jsx";
import StaffAdminPage from "./pages/StaffAdminPage.jsx";
import AreasAdminPage from "./pages/AreasAdminPage.jsx";
import CatalogAdminPage from "./pages/CatalogAdminPage.jsx";
import CustomerAdminPage from "./pages/CustomerAdminPage.jsx";
import ReportsAdminPage from "./pages/ReportsAdminPage.jsx";

export function adminRoutes() {
  const guard = (el) => <RequireRole allow={[Roles.ADMIN]}>{el}</RequireRole>;

  return [
    { path: "/admin", element: guard(<AdminDashboardPage />) },
    { path: "/admin/staff", element: guard(<StaffAdminPage />) },
    { path: "/admin/areas", element: guard(<AreasAdminPage />) },
    { path: "/admin/catalog", element: guard(<CatalogAdminPage />) },
    { path: "/admin/customers", element: guard(<CustomerAdminPage />) },
    { path: "/admin/reports", element: guard(<ReportsAdminPage />) },
  ];
}
