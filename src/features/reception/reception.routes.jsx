// src/features/reception/reception.routes.jsx
import RequireRole from "../../app/guards/RequireRole.jsx";
import { Roles } from "../../app/config/roles.js";
import ReceptionHome from "./pages/ReceptionHome.jsx";
import ReceptionDashboardPage from "./pages/ReceptionDashboardPage.jsx";
import ReceptionCheckInPage from "./pages/ReceptionCheckInPage.jsx";

// Später ersetzt du die elemente durch echte Pages
export function receptionRoutes() {
  const guard = (el) => (
    <RequireRole allow={[Roles.STAFF, Roles.CASHIER, Roles.ADMIN]}>{el}</RequireRole>
  );

  return [
    { path: "/reception", element: guard(<ReceptionHome/>) },
    { path: "/reception/checkin", element: guard(<ReceptionCheckInPage />) },
    { path: "/reception/checkout", element: guard(<ReceptionDashboardPage />) },
    { path: "/reception/liveboard", element: guard(<ReceptionDashboardPage />) },
    { path: "/reception/summary", element: guard(<ReceptionDashboardPage />) },
    { path: "/reception/vouchers", element: guard(<ReceptionDashboardPage />) },
  ];
}
