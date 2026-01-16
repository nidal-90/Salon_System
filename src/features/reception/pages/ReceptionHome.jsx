// src/features/reception/pages/ReceptionHome.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../db/index.js";
import styles from "./ReceptionHome.module.css";

function todayKey() {
  // YYYY-MM-DD
  return new Date().toISOString().slice(0, 10);
}

export default function ReceptionHome() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);

  const [todayVisitsCount, setTodayVisitsCount] = useState(0);
  const [areasCount, setAreasCount] = useState(0);
  const [activeStaffCount, setActiveStaffCount] = useState(0);

  const [waitingCount, setWaitingCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [doneCount, setDoneCount] = useState(0);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      const dk = todayKey();

      try {
        // KPI 1: Heutige Check-ins (visits)
        const visitsToday = await db.visits.where("dateKey").equals(dk).count();

        // KPI 2: Bereiche
        const areas = await db.areas.count();

        // KPI 3: Mitarbeiter aktiv
        const staffAll = await db.staff.toArray();
        const activeStaff = staffAll.filter((s) => Number(s.active) === 1).length;

        // Optional: Live-Zustände pro Bereich (visit_area_state)
        // status values: du nutzt in deinem Schema "status", je nach Implementierung z.B. "waiting"/"active"/"done"
        // Falls deine Statusnamen anders sind, passe hier die Strings an.
        let waiting = 0,
          active = 0,
          done = 0;

        if (db.visit_area_state) {
          const rows = await db.visit_area_state.where("dateKey").equals(dk).toArray();
          for (const r of rows) {
            const st = String(r.status || "").toLowerCase();
            if (st === "waiting" || st === "wartend") waiting++;
            else if (st === "active" || st === "aktiv") active++;
            else if (st === "done" || st === "fertig" || st === "finished") done++;
          }
        }

        if (!alive) return;

        setTodayVisitsCount(visitsToday);
        setAreasCount(areas);
        setActiveStaffCount(activeStaff);

        setWaitingCount(waiting);
        setActiveCount(active);
        setDoneCount(done);
      } catch (e) {
        // Wenn eine Table noch nicht existiert oder du gerade umbaust, crasht die Seite nicht.
        console.error(e);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    // Optional: leichte Live-Aktualisierung (z.B. alle 5s) – kann später raus
    const t = setInterval(load, 5000);

    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const kpis = useMemo(() => {
    return [
      {
        label: "Check-ins heute",
        value: loading ? "…" : String(todayVisitsCount),
        meta: "Alle Kunden & Gruppen",
      },
      {
        label: "Bereiche",
        value: loading ? "…" : String(areasCount),
        meta: "Zonen / Klassen",
      },
      {
        label: "Mitarbeiter aktiv",
        value: loading ? "…" : String(activeStaffCount),
        meta: "Heute verfügbar",
      },
      {
        label: "Live-Status",
        value: loading ? "…" : `${waitingCount} / ${activeCount} / ${doneCount}`,
        meta: "Wartend / Aktiv / Fertig",
      },
    ];
  }, [loading, todayVisitsCount, areasCount, activeStaffCount, waitingCount, activeCount, doneCount]);
  /*
 <button className={styles.secondaryBtn} type="button" onClick={() => nav("/start")}>
            Exit
         </button>
 */
  return (
    <div className={styles.wrap}>
      <div className={styles.headerCard}>
        <div>
          <div className={styles.title}>Reception</div>
          <div className={styles.subtitle}>
            Check-in, Liveboard, Checkout, Kasse und Gutscheine – alles an einem Ort.
          </div>
        </div>

        <div className={styles.headerActions}>
          <button className={styles.primaryBtn} type="button" onClick={() => nav("/reception/register")}>
            +Kunde anlegen
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        {kpis.map((k) => (
          <div key={k.label} className={styles.kpi}>
            <div className={styles.kpiLabel}>{k.label}</div>
            <div className={styles.kpiVal}>{k.value}</div>
            <div className={styles.kpiMeta}>{k.meta}</div>
          </div>
        ))}

        <div className={styles.panelWide}>
          <div className={styles.panelHead}>
            <div>
              <div className={styles.panelTitle}>Schnellzugriff</div>
              <div className={styles.panelSub}>Typische Reception-Aktionen in einem Klick.</div>
            </div>
          </div>

          <div className={styles.actions}>
            <button className={styles.action} type="button" onClick={() => nav("/reception/checkin")}>
              <div className={styles.actionTitle}>Kunde/Gruppe Check-in</div>
              <div className={styles.actionMeta}>Kunde wählen/neu, Bereich, Services, Notizen</div>
            </button>

            <button className={styles.action} type="button" onClick={() => nav("/reception/dashboard")}>
              <div className={styles.actionTitle}>Liveboard</div>
              <div className={styles.actionMeta}>Status: Wartend, Aktiv, Fertig – je Bereich</div>
            </button>

            <button className={styles.action} type="button" onClick={() => nav("/reception/checkout")}>
              <div className={styles.actionTitle}>Check-out</div>
              <div className={styles.actionMeta}>Abschluss je Kunde/Gruppe, ready for payment</div>
            </button>

            <button className={styles.action} type="button" onClick={() => nav("/reception/summary")}>
              <div className={styles.actionTitle}>Tagesübersicht</div>
              <div className={styles.actionMeta}>Umsatz heute, Vorschüsse/Ausgaben, Export</div>
            </button>

            <button className={styles.actionPrimary} type="button" onClick={() => nav("/reception/pos")}>
              <div className={styles.actionTitle}>Kasse</div>
              <div className={styles.actionMeta}>Zahlungen, Produkte, Services, Rabatt/Coupons</div>
            </button>

            <button className={styles.action} type="button" onClick={() => nav("/reception/vouchers")}>
              <div className={styles.actionTitle}>Gutscheine</div>
              <div className={styles.actionMeta}>Gutschein verkaufen & Gutschein einlösen</div>
            </button>
          </div>

          <div className={styles.helperRow}>
            <div className={styles.helper}>
             
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
