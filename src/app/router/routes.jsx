// src/app/router/routes.jsx
import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "../layout/AppShell.jsx";

import { startRoutes } from "../../features/start/start.routes.jsx";
import { receptionRoutes } from "../../features/reception/reception.routes.jsx";
import { staffRoutes } from "../../features/staff/staff.routes.jsx";
import { adminRoutes } from "../../features/admin/admin.routes.jsx"; // ✅ genau so

import KioskOrderPage from "../../features/kiosk/pages/KioskOrderPage.jsx";

function renderRouteList(list) {
  return list.map((r) => <Route key={r.path} path={r.path} element={r.element} />);
}

export default function AppRoutes() {
  const routes = [
    ...startRoutes(),
    ...receptionRoutes(),
    ...staffRoutes(),
    ...adminRoutes(), // ✅ genau so
    { path: "/order", element: <KioskOrderPage /> },
  ];

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/start" replace />} />
        {renderRouteList(routes)}
        <Route path="*" element={<Navigate to="/start" replace />} />
      </Route>
    </Routes>
  );
}
