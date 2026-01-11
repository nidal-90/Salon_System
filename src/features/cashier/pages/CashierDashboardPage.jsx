import { useEffect, useMemo, useState } from "react";
import { db } from "../../../db/index.js";
import useUsbSession from "../../../hooks/useUsbSession.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";
import styles from "./CashierDashboardPage.module.css";
import { useNavigate } from "react-router-dom";

export default function CashierDashboardPage() {
  const { role, usbPresent } = useUsbSession();
  const dateKey = useMemo(() => toDateKeyISO(new Date()), []);
  const [activeAll, setActiveAll] = useState([]);
  const [waitingAll, setWaitingAll] = useState([]);

  const canCheckout = usbPresent && (role === "cashier" || role === "admin");

  async function refresh() {
    const waiting = await db.visit_area_state.where("dateKey").equals(dateKey).and(x => x.status === "waiting").toArray();
    const active = await db.visit_area_state.where("dateKey").equals(dateKey).and(x => x.status === "active").toArray();
    setWaitingAll(waiting);
    setActiveAll(active);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
const nav = useNavigate();
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h2 className={styles.title}>Kasse – Live Board</h2>
          <p className={styles.sub}>Status: wer sitzt wo, seit wann, welcher Mitarbeiter.</p>
        </div>

        <div className={styles.grid}>
          <Panel title="Aktiv" items={activeAll} tone="active" />
          <Panel title="Wartend" items={waitingAll} tone="waiting" />
          <button type="button" onClick={() => nav("/cashier/pos")}>
           Freier Verkauf / POS
          </button>
        </div>

        <div className={styles.footer}>
          <button className={styles.checkout} disabled={!canCheckout} type="button">
            Checkout (nur Cash-USB)
          </button>
          {!canCheckout && (
            <div className={styles.warn}>
              Checkout ist gesperrt. Bitte Cash-USB Key laden.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Panel({ title, items, tone }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <div className={styles.bold}>{title}</div>
        <div className={styles.count}>{items.length}</div>
      </div>

      {items.length === 0 ? (
        <div className={styles.empty}>Keine Einträge.</div>
      ) : (
        items.map((x) => (
          <div key={x.id} className={styles.row}>
            <div className={styles.rowLeft}>
              <div className={styles.rowTitle}>
                Visit: {x.visitId}
              </div>
              <div className={styles.rowMeta}>
                Bereich: <b>{x.areaId}</b>
                {x.assignedStaffName && <span> · Mitarbeiter: <b>{x.assignedStaffName}</b></span>}
                {x.startedAt && (
                  <span> · seit <b>{new Date(x.startedAt).toLocaleTimeString()}</b></span>
                )}
              </div>
            </div>

            <div className={`${styles.pill} ${tone === "active" ? styles.pillActive : styles.pillWaiting}`}>
              {x.status}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
