import { useEffect, useState } from "react";
import { db } from "../../../db/index.js";
import styles from "./AreasAdminPage.module.css";

export default function AreasAdminPage() {
  const [areas, setAreas] = useState([]);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState(10);
  const [active, setActive] = useState(true);

  async function reload() {
    const a = await db.areas.toArray();
    a.sort(
      (x, y) =>
        (Number(x.sortOrder || 0) - Number(y.sortOrder || 0)) ||
        String(x.name || "").localeCompare(String(y.name || ""))
    );
    setAreas(a);
  }

  useEffect(() => {
    reload();
  }, []);

  async function addArea() {
    const c = code.trim().toUpperCase();
    const n = name.trim();
    if (!c || !n) return;

    // unique code check
    const existing = await db.areas.where("code").equals(c).first();
    if (existing) return;

    await db.areas.put({
      id: crypto.randomUUID(),
      code: c,
      name: n,
      active: active ? 1 : 0,
      sortOrder: Number(sortOrder || 0),
    });

    setCode("");
    setName("");
    setSortOrder(10);
    setActive(true);
    reload();
  }

  async function toggleActive(a) {
    await db.areas.update(a.id, { active: a.active ? 0 : 1 });
    reload();
  }

  async function removeArea(id) {
    await db.areas.delete(id);
    reload();
  }

  async function updateArea(id, patch) {
    await db.areas.update(id, patch);
    reload();
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.top}>
          <div>
            <h1 className={styles.h1}>Bereiche</h1>
            <div className={styles.sub}>Definiere die Bereiche im Laden (z.B. Haare, Make-up, Pflege).</div>
          </div>
          <div className={styles.badge}>{areas.length} Bereiche</div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Bereich hinzufügen</div>
          <div className={styles.form}>
            <label className={styles.fLabel}>
              Code (unique)
              <input className={styles.input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="z.B. HAIR" />
            </label>

            <label className={styles.fLabel}>
              Name
              <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Haare" />
            </label>

            <label className={styles.fLabel}>
              Sortierung
              <input className={styles.input} type="number" step="1" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </label>

            <label className={styles.check}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Aktiv
            </label>

            <div className={styles.actions}>
              <button className={styles.btnPrimary} onClick={addArea}>Hinzufügen</button>
            </div>
          </div>

          <div className={styles.sep} />

          <div className={styles.table}>
            <div className={styles.trHead}>
              <div>Code</div>
              <div>Name</div>
              <div>Aktiv</div>
              <div className={styles.taRight}>Sort</div>
              <div className={styles.taRight}>Aktion</div>
            </div>

            {areas.map((a) => (
              <div key={a.id} className={styles.tr}>
                <div className={styles.mono}>{a.code}</div>

                <input
                  className={styles.inlineInput}
                  value={a.name || ""}
                  onChange={(e) => updateArea(a.id, { name: e.target.value })}
                />

                <button className={styles.toggle} onClick={() => toggleActive(a)}>
                  {a.active ? "ja" : "nein"}
                </button>

                <input
                  className={styles.inlineInputRight}
                  type="number"
                  value={Number(a.sortOrder || 0)}
                  onChange={(e) => updateArea(a.id, { sortOrder: Number(e.target.value || 0) })}
                />

                <div className={styles.taRight}>
                  <button className={styles.btnDanger} onClick={() => removeArea(a.id)}>Löschen</button>
                </div>
              </div>
            ))}

            {areas.length === 0 ? <div className={styles.empty}>Keine Bereiche.</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
