// src/app/router/routes.jsx
import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "../layout/AppShell.jsx";

import StartPage from "../../features/start/pages/StartPage.jsx";
import KeyLoadPage from "../../features/auth/pages/KeyLoadPage.jsx";
import RegisterPage from "../../features/registration/pages/RegisterPage.jsx";
import KioskOrderPage from "../../features/kiosk/pages/KioskOrderPage.jsx";

import ReceptionDashboardPage from "../../features/reception/pages/ReceptionDashboardPage.jsx";
import StaffDashboardPage from "../../features/staff/pages/StaffDashboardPage.jsx";
import CashierDashboardPage from "../../features/cashier/pages/CashierDashboardPage.jsx";

// Nimm die Datei, die wirklich existiert:
import DailySalesPage from "../../features/cashier/pages/DailySales.jsx";
import DailyHistoryPage from "../../features/cashier/pages/DailyHistory.jsx";

import RequireRole from "../guards/RequireRole.jsx";
import { Roles } from "../config/roles.js";

// Admin Pages (achte auf exakte Dateinamen)
import AdminDashboardPage from "../../features/admin/pages/AdminDashboardPage.jsx";
import StaffAdminPage from "../../features/admin/pages/StaffAdminPage.jsx";
import AreasAdminPage from "../../features/admin/pages/AreasAdminPage.jsx";
import CatalogAdminPage from "../../features/admin/pages/CatalogAdminPage.jsx";
import CustomerAdminPage from "../../features/admin/pages/CustomerAdminPage.jsx";
import ReportsAdminPage from "../../features/admin/pages/ReportsAdminPage.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/start" replace />} />

        <Route path="/start" element={<StartPage />} />
        <Route path="/login" element={<KeyLoadPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/order" element={<KioskOrderPage />} />

        <Route
          path="/reception"
          element={
            <RequireRole allow={[Roles.STAFF, Roles.ADMIN]}>
              <ReceptionDashboardPage />
            </RequireRole>
          }
        />

        <Route
          path="/staff"
          element={
            <RequireRole allow={[Roles.STAFF, Roles.ADMIN]}>
              <StaffDashboardPage />
            </RequireRole>
          }
        />

        <Route
          path="/cashier"
          element={
            <RequireRole allow={[Roles.CASHIER, Roles.ADMIN]}>
              <CashierDashboardPage />
            </RequireRole>
          }
        />
        
        <Route
          path="/cashier/pos"
          element={
            <RequireRole allow={[Roles.CASHIER, Roles.ADMIN]}>
              <DailySalesPage />
            </RequireRole>
          }
        />

        <Route
         path="/cashier/pos/daily"
         element={
           <RequireRole allow={[Roles.CASHIER, Roles.ADMIN]}>
             <DailyHistoryPage/>
           </RequireRole>
          }
        />

        {/* Admin */}
        <Route
          path="/admin"
          element={
            <RequireRole allow={[Roles.ADMIN]}>
              <AdminDashboardPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/staff"
          element={
            <RequireRole allow={[Roles.ADMIN]}>
              <StaffAdminPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/areas"
          element={
            <RequireRole allow={[Roles.ADMIN]}>
              <AreasAdminPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/catalog"
          element={
            <RequireRole allow={[Roles.ADMIN]}>
              <CatalogAdminPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/customers"
          element={
            <RequireRole allow={[Roles.ADMIN]}>
              <CustomerAdminPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/reports"
          element={
            <RequireRole allow={[Roles.ADMIN]}>
              <ReportsAdminPage />
            </RequireRole>
          }
        />

        <Route path="*" element={<Navigate to="/start" replace />} />
      </Route>
    </Routes>
  );
}
