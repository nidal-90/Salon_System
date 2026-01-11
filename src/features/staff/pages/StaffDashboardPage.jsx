import { useEffect, useMemo, useState } from "react";
import { db } from "../../../db/index.js";
import useUsbSession from "../../../hooks/useUsbSession.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";
import { listWaiting, listActive, markActive, markDone } from "../api/staffApi.js";
import styles from "./StaffDashboardPage.module.css";

export default function StaffDashboardPage() {
  const { staffId, staffName, role } = useUsbSession();
  const dateKey = useMemo(() => toDateKeyISO(new Date()), []);
  const [areas, setAreas] = useState([]);
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const [waiting, setWaiting] = useState([]);
  const [active, setActive] = useState([]);

  useEffect(() => {
    db.areas.orderBy("sortOrder").toArray().then((arr) => {
      setAreas(arr.filter(a => a.active));
      if (!selectedAreaId && arr.length) setSelectedAreaId(arr[0].id);
    });
  }, [selectedAreaId]);

  async function refresh() {
    if (!selectedAreaId) return;
    const w = await listWaiting(selectedAreaId, dateKey);
    const a = await listActive(selectedAreaId, dateKey);
    setWaiting(w);
    setActive(a);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAreaId]);

  async function start(v) {
    // If staff not logged in, allow manual assignment is optional,
    // but per requirement: staff can only work when USB is inserted.
    if (!staffId && role !== "admin") return;

    await markActive({ visitAreaStateId: v.id, staffId: staffId || "admin", staffName: staffName || "Admin" });
    await refresh();
  }

  async function done(v) {
    await markDone({ visitAreaStateId: v.id });
    await refresh();
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h2 className={styles.title}>Mitarbeiter Dashboard</h2>
          <p className={styles.sub}>Warteliste und Aktivliste pro Bereich.</p>
        </div>

        <div className={styles.controls}>
          <div className={styles.ctrl}>
            <span>Bereich</span>
            <select value={selectedAreaId} onChange={(e) => setSelectedAreaId(e.target.value)} className={styles.select}>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <button className={styles.refresh} onClick={refresh} type="button">
            Refresh
          </button>
        </div>

        <div className={styles.grid}>
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <div className={styles.bold}>Warteliste</div>
              <div className={styles.count}>{waiting.length}</div>
            </div>

            {waiting.length === 0 ? (
              <div className={styles.empty}>Keine wartenden Kunden.</div>
            ) : (
              waiting.map((v) => (
                <Row key={v.id} v={v} actionLabel="Start" onAction={() => start(v)} />
              ))
            )}
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <div className={styles.bold}>Aktiv</div>
              <div className={styles.count}>{active.length}</div>
            </div>

            {active.length === 0 ? (
              <div className={styles.empty}>Keine aktiven Behandlungen.</div>
            ) : (
              active.map((v) => (
                <Row key={v.id} v={v} actionLabel="Fertig" onAction={() => done(v)} />
              ))
            )}
          </div>
        </div>

        <div className={styles.note}>
          Hinweis: “Letzte Behandlung / Letzter Mitarbeiter im Kundenprofil” wird über customer_history + customers.lastServedBy… befüllt (Step-2 Ausbau).
        </div>
      </div>
    </div>
  );
}

function Row({ v, actionLabel, onAction }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLeft}>
        <div className={styles.rowTitle}>{v.visitId}</div>
        <div className={styles.rowMeta}>
          Status: <b>{v.status}</b>
          {v.startedAt && <span> · seit {new Date(v.startedAt).toLocaleTimeString()}</span>}
        </div>
      </div>
      <button className={styles.action} onClick={onAction} type="button">
        {actionLabel}
      </button>
    </div>
  );
}
