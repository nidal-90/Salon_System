import { Navigate } from "react-router-dom";
import useUsbSession from "../../hooks/useUsbSession.js";
import styles from "./RequireRole.module.css";

export default function RequireRole({ allow, children }) {
  const { role } = useUsbSession();

  if (!role) {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h2>Kein Login aktiv</h2>
          <p>Bitte Key laden (USB) oder Admin-Key verwenden.</p>
        </div>
      </div>
    );
  }

  if (!allow.includes(role)) {
    return <Navigate to="/kiosk" replace />;
  }

  return children;
}
