import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../db/index.js";
import AdminShell from "../components/AdminShell.jsx";
import styles from "./AdminDashboardPage.module.css";

export default function AdminDashboardPage() {
  const nav = useNavigate();

  const [staff, setStaff] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);
  const [vouchers, setVouchers] = useState([]);

  useEffect(() => {
    (async () => {
      const [s, c, svc, p, v] = await Promise.all([
        db.staff.toArray(),
        db.customers.toArray(),
        db.service_catalog.toArray(),
        db.product_catalog.toArray(),
        db.vouchers.toArray(),
      ]);

      s.sort(
        (x, y) =>
          Number(x.sortOrder ?? 9999) - Number(y.sortOrder ?? 9999) ||
          String(x.name || "").localeCompare(String(y.name || ""))
      );

      setStaff(s);
      setCustomers(c);
      setServices(svc);
      setProducts(p);
      setVouchers(v);
    })();
  }, []);

  const activeStaff = useMemo(
    () => staff.filter((s) => Number(s.active) === 1).length,
    [staff]
  );

  return (
    <AdminShell
      title="Admin Control"
      subtitle="Zentrale Verwaltung: Mitarbeiter, Kunden, Katalog, Gutscheine und Umsätze. Alles clean und salon-tauglich."
    >
      <div className={styles.grid}>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Mitarbeiter aktiv</div>
          <div className={styles.kpiVal}>{activeStaff}</div>
          <div className={styles.kpiMeta}>Gesamt: {staff.length}</div>
        </div>

        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Kunden</div>
          <div className={styles.kpiVal}>{customers.length}</div>
          <div className={styles.kpiMeta}>Profile & Historie</div>
        </div>

        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Gutscheine</div>
          <div className={styles.kpiVal}>{vouchers.length}</div>
          <div className={styles.kpiMeta}>Aktiv / eingelöst / storniert</div>
        </div>

        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Produkte & Services</div>
          <div className={styles.kpiVal}>{services.length + products.length}</div>
          <div className={styles.kpiMeta}>
            Services: {services.length} · Produkte: {products.length}
          </div>
        </div>

        <div className={styles.panelWide}>
          <div className={styles.panelHead}>
            <div>
              <div className={styles.panelTitle}>Schnellzugriff</div>
              <div className={styles.panelSub}>Typische Admin-Aktionen in einem Klick.</div>
            </div>
          </div>

          <div className={styles.actions}>
            <button className={styles.action} onClick={() => nav("/admin/staff")}>
              <div className={styles.actionTitle}>Mitarbeiter verwalten</div>
              <div className={styles.actionMeta}>
                Grundlohn, Provision, Urlaub/Krank, Vorschüsse, Reihenfolge
              </div>
            </button>

            <button className={styles.action} onClick={() => nav("/admin/customers")}>
              <div className={styles.actionTitle}>Kundenverwaltung</div>
              <div className={styles.actionMeta}>
                Kontakt, Historie, Notizen, letzte Bedienung
              </div>
            </button>

            <button className={styles.action} onClick={() => nav("/admin/catalog")}>
              <div className={styles.actionTitle}>Produkte & Services verwalten</div>
              <div className={styles.actionMeta}>
                Services pro Bereich, Produkt-Kategorien, Produkte
              </div>
            </button>

            <button className={styles.action} onClick={() => nav("/admin/vouchers")}>
              <div className={styles.actionTitle}>Gutscheine verwalten</div>
              <div className={styles.actionMeta}>
                Neue erstellen, Status sehen, Storno
              </div>
            </button>

            <button className={styles.actionPrimary} onClick={() => nav("/admin/reports")}>
              <div className={styles.actionTitle}>Umsätze & Auswertung</div>
              <div className={styles.actionMeta}>
                Tag/Monat, Mitarbeiter-Performance, Service-Details (Ausbau)
              </div>
            </button>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
