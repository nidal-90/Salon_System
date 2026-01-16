// src/features/reception/reception.routes.jsx
import RequireRole from "../../app/guards/RequireRole.jsx";
import { Roles } from "../../app/config/roles.js";
import ReceptionHome from "./pages/ReceptionHome.jsx";
import ReceptionDashboardPage from "./pages/ReceptionDashboardPage.jsx";
import ReceptionCheckInPage from "./pages/ReceptionCheckInPage.jsx";
import RegisterPage from "../registration/pages/RegisterPage.jsx";
import ReceptionLiveboardPage from "./pages/ReceptionLiveboardPage.jsx";
import CashierCheckoutPage from "./pages/CashierCheckoutPage.jsx";


// Später ersetzt du die elemente durch echte Pages
export function receptionRoutes() {
  const guard = (el) => (
    <RequireRole allow={[Roles.STAFF, Roles.CASHIER, Roles.ADMIN]}>{el}</RequireRole>
  );

  return [
    { path: "/reception", element: guard(<ReceptionHome/>) },
    { path: "/reception/checkin", element: guard(<ReceptionCheckInPage />) },
    { path: "/reception/register", element: guard(<RegisterPage />) },
    { path: "/reception/dashboard", element: guard(<ReceptionLiveboardPage/>) },
    { path: "/reception/checkout", element: guard(<CashierCheckoutPage />) },
    /// später echte Pages
    
    { path: "/reception/summary", element: guard(<ReceptionDashboardPage />) },
    { path: "/reception/vouchers", element: guard(<ReceptionDashboardPage />) },
  ];
}
