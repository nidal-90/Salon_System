// src/features/staff/staff.routes.js
import RequireRole from "../../app/guards/RequireRole.jsx";
import { Roles } from "../../app/config/roles.js";
import StaffDashboardPage from "./pages/StaffDashboardPage.jsx";

export function staffRoutes() {
  const guard = (el) => <RequireRole allow={[Roles.STAFF, Roles.ADMIN]}>{el}</RequireRole>;

  return [
    { path: "/staff", element: guard(<StaffDashboardPage />) },
    { path: "/staff/today", element: guard(<StaffDashboardPage />) },
  ];
}
