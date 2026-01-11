import { useEffect, useMemo, useState } from "react";
import { db } from "../../../db/index.js";
import { createVisitFromReception } from "../api/receptionApi.js";
import styles from "./ReceptionDashboardPage.module.css";

export default function ReceptionDashboardPage() {
  const [areas, setAreas] = useState([]);
  const [staff, setStaff] = useState([]);
  const [selectedAreas, setSelectedAreas] = useState({}); // areaId -> { preferredStaffId, note }

  const [displayName, setDisplayName] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    db.areas.orderBy("sortOrder").toArray().then(setAreas);
    db.staff.toArray().then(setStaff);
  }, []);

  const staffByArea = useMemo(() => {
    const map = {};
    staff.forEach((s) => {
      let ids = [];
      try { ids = JSON.parse(s.areaIds || "[]"); } catch { ids = []; }
      ids.forEach((a) => {
        if (!map[a]) map[a] = [];
        map[a].push(s);
      });
    });
    return map;
  }, [staff]);

  function toggleArea(areaId) {
    setSelectedAreas((prev) => {
      const next = { ...prev };
      if (next[areaId]) delete next[areaId];
      else next[areaId] = { preferredStaffId: "", note: "" };
      return next;
    });
  }

  async function create() {
    setMsg("");
    const requestedAreas = Object.entries(selectedAreas).map(([areaId, v]) => {
      const pref = (staffByArea[areaId] || []).find((x) => x.id === v.preferredStaffId);
      return {
        areaId,
        preferredStaffId: v.preferredStaffId || null,
        preferredStaffName: pref?.name || null,
        note: v.note || "",
      };
    });

    if (!displayName.trim() || requestedAreas.length === 0) {
      setMsg("Bitte Name und mindestens einen Bereich wählen.");
      return;
    }

    await createVisitFromReception({ displayName, note, requestedAreas });
    setMsg("Visit erstellt und in Wartelisten eingetragen.");

    setDisplayName("");
    setNote("");
    setSelectedAreas({});
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h2 className={styles.title}>Reception Dashboard</h2>
          <p className={styles.sub}>Neuen Kunden/Visit erstellen und Bereiche zuweisen.</p>
        </div>

        <div className={styles.form}>
          <label className={styles.field}>
            <span>Kunde / Anzeige</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Name oder Gast" />
          </label>

          <label className={styles.field}>
            <span>Notiz (optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Bitte schnell" />
          </label>
        </div>

        <div className={styles.areaGrid}>
          {areas.filter(a => a.active).map((a) => {
            const on = !!selectedAreas[a.id];
            const list = staffByArea[a.id] || [];
            return (
              <div key={a.id} className={`${styles.areaCard} ${on ? styles.on : ""}`}>
                <div className={styles.areaHead}>
                  <div className={styles.areaName}>{a.name}</div>
                  <button className={styles.toggle} onClick={() => toggleArea(a.id)} type="button">
                    {on ? "Entfernen" : "Hinzufügen"}
                  </button>
                </div>

                {on && (
                  <>
                    <div className={styles.row}>
                      <span className={styles.small}>Wunsch-Mitarbeiter</span>
                      <select
                        className={styles.select}
                        value={selectedAreas[a.id]?.preferredStaffId || ""}
                        onChange={(e) =>
                          setSelectedAreas((p) => ({
                            ...p,
                            [a.id]: { ...p[a.id], preferredStaffId: e.target.value },
                          }))
                        }
                      >
                        <option value="">Freilassen</option>
                        {list.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>

                    <label className={styles.field}>
                      <span>Notiz (optional)</span>
                      <input
                        value={selectedAreas[a.id]?.note || ""}
                        onChange={(e) => setSelectedAreas((p) => ({ ...p, [a.id]: { ...p[a.id], note: e.target.value } }))}
                      />
                    </label>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {msg && <div className={styles.msg}>{msg}</div>}

        <div className={styles.footer}>
          <button className={styles.primary} onClick={create} type="button">
            Visit erstellen
          </button>
        </div>
      </div>
    </div>
  );
}
