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

      <div className={styles.nav}>
        <NavLink to="/admin" end className={({isActive}) => isActive ? styles.navActive : styles.navItem}>Dashboard</NavLink>
        <NavLink to="/admin/staff" className={({isActive}) => isActive ? styles.navActive : styles.navItem}>Mitarbeiter</NavLink>
        <NavLink to="/admin/customers" className={({isActive}) => isActive ? styles.navActive : styles.navItem}>Kunden</NavLink>
        <NavLink to="/admin/areas" className={({isActive}) => isActive ? styles.navActive : styles.navItem}>Bereiche</NavLink>
        <NavLink to="/admin/catalog" className={({isActive}) => isActive ? styles.navActive : styles.navItem}>Katalog</NavLink>
        <NavLink to="/admin/reports" className={({isActive}) => isActive ? styles.navActive : styles.navItem}>Umsätze</NavLink>
      </div>

      <div className={styles.content}>{children}</div>
    </div>
  );
}
