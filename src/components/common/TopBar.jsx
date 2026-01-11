// src/components/common/TopBar.jsx
import useUsbSession from "../../hooks/useUsbSession.js";
import styles from "./TopBar.module.css";

export default function TopBar({ onHome, onReception, onStaff, onCashier, onAdmin }) {
  const { role, staffName, usbPresent, lock } = useUsbSession();

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <button className={styles.brand} onClick={onHome} type="button">
          Sibel Salon System
        </button>

        <div className={styles.meta}>
          <span className={styles.badge}>USB: {usbPresent ? "aktiv" : "kein"}</span>
          <span className={styles.badge}>Rolle: {role || "guest"}</span>
          {staffName ? <span className={styles.badge}>User: {staffName}</span> : null}
        </div>
      </div>

      <div className={styles.right}>
        <button className={styles.nav} onClick={onReception} type="button">Reception</button>
        <button className={styles.nav} onClick={onStaff} type="button">Mitarbeiter</button>
        <button className={styles.nav} onClick={onCashier} type="button">Kasse</button>
        <button className={styles.nav} onClick={onAdmin} type="button">Admin</button>

        <button
          className={styles.lock}
          onClick={() => (typeof lock === "function" ? lock() : null)}
          type="button"
        >
          Sperren / Key wechseln
        </button>
      </div>
    </div>
  );
}
