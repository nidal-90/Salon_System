// src/app/guards/RequireRole.jsx
import { Navigate } from "react-router-dom";
import useUsbSession from "../../hooks/useUsbSession.js";
import { Roles } from "../config/roles.js";
import styles from "./RequireRole.module.css";

export default function RequireRole({ allow = [], children, fallback = "/login" }) {
  const { role } = useUsbSession();

  // Ohne Login (guest) -> Login/Start zeigen
  if (!role || role === Roles.GUEST) {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h2>Kein Login aktiv</h2>
          <p>Bitte Key laden (USB) oder Admin-Key verwenden.</p>
        </div>
      </div>
    );
  }

  // Erlaubnisprüfung
  const ok = allow.length === 0 || allow.includes(role);

  if (!ok) {
    return <Navigate to={fallback} replace />;
  }

  return children;
}
