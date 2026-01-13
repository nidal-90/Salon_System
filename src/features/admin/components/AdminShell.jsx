import { NavLink } from "react-router-dom";
import styles from "./AdminShell.module.css";

export default function AdminShell({ title, subtitle, right, children }) {
  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <div>
          <div className={styles.h1}>{title}</div>
          <div className={styles.sub}>{subtitle}</div>
        </div>

        <div className={styles.right}>{right}</div>
      </div>

      

      <div className={styles.content}>{children}</div>
    </div>
  );
}
