import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../db/index.js";
import styles from "./KioskServicesPage.module.css";

export default function KioskServicesPage() {
  const nav = useNavigate();
  const [areas, setAreas] = useState([]);
  const [staff, setStaff] = useState([]);

  const [selected, setSelected] = useState({}); // areaId -> { selected: bool, preferredStaffId, note }
  const [displayName, setDisplayName] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    db.areas.orderBy("sortOrder").toArray().then(setAreas);
    db.staff.toArray().then(setStaff);
  }, []);

  useEffect(() => {
    const step0 = JSON.parse(sessionStorage.getItem("kiosk_payload_step0") || "{}");
    if (step0.mode === "profile" && step0.customer) {
      const name = `${step0.customer.firstName || ""} ${step0.customer.lastName || ""}`.trim();
      setDisplayName(name || "Kunde");
    } else {
      setDisplayName("Gast");
    }
  }, []);

  const staffByArea = useMemo(() => {
    const map = {};
    for (const s of staff) {
      let ids = [];
      try { ids = JSON.parse(s.areaIds || "[]"); } catch { ids = []; }
      ids.forEach((a) => {
        if (!map[a]) map[a] = [];
        map[a].push(s);
      });
    }
    return map;
  }, [staff]);

  function toggleArea(areaId) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[areaId]?.selected) {
        delete next[areaId];
      } else {
        next[areaId] = { selected: true, preferredStaffId: "", note: "" };
      }
      return next;
    });
  }

  function next() {
    const step0 = JSON.parse(sessionStorage.getItem("kiosk_payload_step0") || "{}");

    const requestedAreas = Object.entries(selected).map(([areaId, v]) => {
      const preferred = (staffByArea[areaId] || []).find((x) => x.id === v.preferredStaffId);
      return {
        areaId,
        preferredStaffId: v.preferredStaffId || null,
        preferredStaffName: preferred?.name || null,
        note: v.note || "",
      };
    });

    const payload = {
      ...step0,
      displayName: displayName || "Kunde",
      note,
      requestedAreas,
    };

    sessionStorage.setItem("kiosk_payload_step1", JSON.stringify(payload));
    nav("/kiosk/group");
  }

  const selectedCount = Object.keys(selected).length;

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h2 className={styles.title}>Behandlungen auswählen</h2>
          <p className={styles.sub}>Wählen Sie Bereiche und optional Wunsch-Mitarbeiter.</p>
        </div>

        <div className={styles.topGrid}>
          <label className={styles.field}>
            <span>Name / Anzeige</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>

          <label className={styles.field}>
            <span>Notiz (optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        <div className={styles.areaGrid}>
          {areas.filter(a => a.active).map((a) => {
            const isOn = !!selected[a.id]?.selected;
            const staffList = staffByArea[a.id] || [];

            return (
              <div key={a.id} className={`${styles.areaCard} ${isOn ? styles.areaCardOn : ""}`}>
                <div className={styles.areaHead}>
                  <button className={styles.toggle} onClick={() => toggleArea(a.id)}>
                    {isOn ? "Ausgewählt" : "Wählen"}
                  </button>
                  <div className={styles.areaName}>{a.name}</div>
                </div>

                {isOn && (
                  <>
                    <div className={styles.row}>
                      <span className={styles.small}>Wunsch-Mitarbeiter (optional)</span>
                      <select
                        className={styles.select}
                        value={selected[a.id]?.preferredStaffId || ""}
                        onChange={(e) =>
                          setSelected((p) => ({
                            ...p,
                            [a.id]: { ...p[a.id], preferredStaffId: e.target.value },
                          }))
                        }
                      >
                        <option value="">Freilassen</option>
                        {staffList.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <label className={styles.field}>
                      <span>Bereichs-Notiz (optional)</span>
                      <input
                        value={selected[a.id]?.note || ""}
                        onChange={(e) =>
                          setSelected((p) => ({
                            ...p,
                            [a.id]: { ...p[a.id], note: e.target.value },
                          }))
                        }
                      />
                    </label>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className={styles.footer}>
          <div className={styles.hint}>Ausgewählt: {selectedCount}</div>
          <button className={styles.primary} onClick={next} disabled={selectedCount === 0}>
            Weiter
          </button>
        </div>
      </div>
    </div>
  );
}
