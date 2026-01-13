// src/features/admin/components/AdminShell.jsx
import styles from "./AdminShell.module.css";

export default function AdminShell({ title, subtitle, left, right, children }) {
  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <div className={styles.topLeft}>
          <div>
            <div className={styles.h1}>{title}</div>
            {subtitle ? <div className={styles.sub}>{subtitle}</div> : null}
          </div>

          {/* LEFT SLOT: z.B. ← Zurück / ← Admin unter Titel */}
          {left ? <div className={styles.leftSlot}>{left}</div> : null}
        </div>

        <div className={styles.right}>{right}</div>
      </div>

      {/* NAV IST ENTFERNT: keine Dashboard/Mitarbeiter/... Leiste mehr */}

      <div className={styles.content}>{children}</div>
    </div>
  );
}
