// src/app/layout/AppShell.jsx
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import TopBar from "../../components/common/TopBar.jsx";
import OfflineBadge from "../../components/ui/OfflineBadge.jsx";
import styles from "./AppShell.module.css";

export default function AppShell() {
  const loc = useLocation();
  const nav = useNavigate();

  // Diese Routen sind "Kiosk/Start/Auth" ohne TopBar
  const isKiosk =
    loc.pathname === "/start" ||
    loc.pathname === "/login" ||
    loc.pathname === "/register" ||
    loc.pathname === "/order" ||
    loc.pathname.startsWith("/order/");

  return (
    <div className={styles.shell}>
      {/* Optional: OfflineBadge global anzeigen */}
      <OfflineBadge />

      {!isKiosk ? (
        <>
          <div className={styles.top}>
            <TopBar
              onHome={() => nav("/start")}     // oder "/order" – siehe Hinweis unten
              onReception={() => nav("/reception")}
              onStaff={() => nav("/staff")}
              onCashier={() => nav("/cashier")}
              onAdmin={() => nav("/admin")}
            />
          </div>

          <main className={styles.main}>
            <Outlet />
          </main>
        </>
      ) : (
        // Kiosk/Start/Auth Layout (ohne TopBar)
        <main className={styles.mainKiosk}>
          <Outlet />
        </main>
      )}
    </div>
  );
}
