import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../../components/common/Sidebar.jsx";
import OfflineBadge from "../../components/ui/OfflineBadge.jsx";
import styles from "./AppShell.module.css";

function isKioskRoute(pathname) {
  return (
    pathname === "/start" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/order" ||
    pathname.startsWith("/order/")
  );
}

export default function AppShell() {
  const loc = useLocation();
  const kiosk = isKioskRoute(loc.pathname);

  return (
    <div className={styles.shell}>
      <OfflineBadge />

      {kiosk ? (
        <main className={styles.kioskMain}>
          <Outlet />
        </main>
      ) : (
        <div className={styles.app}>
          <Sidebar />
          <main className={styles.main}>
            <div className={styles.content}>
              <Outlet />
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
