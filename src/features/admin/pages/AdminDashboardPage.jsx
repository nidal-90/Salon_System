import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../db/index.js";
import AdminShell from "../components/AdminShell.jsx";
import styles from "./AdminDashboardPage.module.css";

export default function AdminDashboardPage() {
  const nav = useNavigate();

  const [staff, setStaff] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [areas, setAreas] = useState([]);
  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);

  useEffect(() => {
    (async () => {
      const [s, c, a, svc, p] = await Promise.all([
        db.staff.toArray(),
        db.customers.toArray(),
        db.areas.toArray(),
        db.service_catalog.toArray(),
        db.product_catalog.toArray(),
      ]);

      s.sort(
        (x, y) =>
          Number(x.sortOrder ?? 9999) - Number(y.sortOrder ?? 9999) ||
          String(x.name || "").localeCompare(String(y.name || ""))
      );
      a.sort(
        (x, y) =>
          Number(x.sortOrder ?? 9999) - Number(y.sortOrder ?? 9999) ||
          String(x.name || "").localeCompare(String(y.name || ""))
      );

      setStaff(s);
      setCustomers(c);
      setAreas(a);
      setServices(svc);
      setProducts(p);
    })();
  }, []);

  const activeStaff = useMemo(
    () => staff.filter((s) => Number(s.active) === 1).length,
    [staff]
  );

  return (
    <AdminShell
      title="Admin Control"
      subtitle="Zentrale Verwaltung: Mitarbeiter, Kunden, Bereiche, Katalog und Umsätze. Alles im selben Stil – clean und salon-tauglich."
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
          <div className={styles.kpiLabel}>Bereiche</div>
          <div className={styles.kpiVal}>{areas.length}</div>
          <div className={styles.kpiMeta}>Zonen / Klassen</div>
        </div>

        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Produkte & Services</div>
          <div className={styles.kpiVal}>{services.length + products.length}</div>
          <div className={styles.kpiMeta}>
            Services: {services.length} · Produkte: {products.length}
          </div>
        </div>

        {/* Vollbreite: genau über die Breite der 4 KPI-Karten */}
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

            <button className={styles.action} onClick={() => nav("/admin/areas")}>
              <div className={styles.actionTitle}>Behandlung definieren</div>
              <div className={styles.actionMeta}>
                Haarschnitt, Farbe, Make-up … Sortierung & Aktiv
              </div>
            </button>

            <button className={styles.action} onClick={() => nav("/admin/catalog")}>
              <div className={styles.actionTitle}>Produkte & Services verwalten</div>
              <div className={styles.actionMeta}>
                Kategorien (Dropdown), Services pro Bereich, Produkte
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
