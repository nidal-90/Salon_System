// src/features/admin/admin.routes.jsx
import AdminDashboardPage from "./pages/AdminDashboardPage.jsx";
import StaffAdminPage from "./pages/StaffAdminPage.jsx";
import CustomerAdminPage from "./pages/CustomerAdminPage.jsx";
import CatalogAdminPage from "./pages/CatalogAdminPage.jsx";
import ReportsAdminPage from "./pages/ReportsAdminPage.jsx";
import VoucherAdminPage from "./pages/VoucherAdminPage.jsx";

export function adminRoutes() {
  return [
    { path: "/admin", element: <AdminDashboardPage /> },
    { path: "/admin/staff", element: <StaffAdminPage /> },
    { path: "/admin/customers", element: <CustomerAdminPage /> },
    { path: "/admin/catalog", element: <CatalogAdminPage /> },
    { path: "/admin/vouchers", element: <VoucherAdminPage /> },
    { path: "/admin/reports", element: <ReportsAdminPage /> },
  ];
}
