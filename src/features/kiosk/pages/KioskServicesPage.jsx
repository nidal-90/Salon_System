import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../db/index.js";
import styles from "./KioskServicesPage.module.css";

function money(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? x.toFixed(2) : "0.00";
}

export default function KioskServicesPage() {
  const nav = useNavigate();

  const [areas, setAreas] = useState([]);
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);

  const [displayName, setDisplayName] = useState("");
  const [note, setNote] = useState("");

  // NEW: tab + search
  const [activeAreaId, setActiveAreaId] = useState("");
  const [q, setQ] = useState("");

  // Selected services + preferred staff per area
  // areaId -> { selectedServiceIds:Set<string>, preferredStaffId:string, note:string }
  const [selectedByArea, setSelectedByArea] = useState({});

  useEffect(() => {
    (async () => {
      const [a, s, st] = await Promise.all([
        db.areas.toArray(),
        db.service_catalog.toArray(),
        db.staff.toArray(),
      ]);

      const activeAreas = (a || [])
        .filter((x) => x.active === 1 || x.active === true)
        .sort(
          (x, y) =>
            Number(x.sortOrder ?? x.displayNo ?? 9999) - Number(y.sortOrder ?? y.displayNo ?? 9999) ||
            String(x.name || "").localeCompare(String(y.name || ""))
        );

      const activeServices = (s || [])
        .filter((x) => x.active === 1 || x.active === true)
        .map((x) => ({
          ...x,
          title: (x.title || x.name || "").trim(),
          price: Number(x.price || 0),
          areaId: String(x.areaId || ""),
        }))
        .filter((x) => x.title && x.areaId)
        .sort((x, y) => String(x.title).localeCompare(String(y.title)));

      setAreas(activeAreas);
      setServices(activeServices);
      setStaff(st || []);

      // default tab: first area
      if (activeAreas[0]?.id) setActiveAreaId(activeAreas[0].id);
    })();
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
    for (const s of staff || []) {
      let ids = [];
      try {
        ids = JSON.parse(s.areaIds || "[]");
      } catch {
        ids = [];
      }
      for (const aId of ids) {
        if (!map[aId]) map[aId] = [];
        map[aId].push(s);
      }
    }
    // optional: stable sort
    for (const k of Object.keys(map)) {
      map[k].sort((x, y) => String(x.name || "").localeCompare(String(y.name || "")));
    }
    return map;
  }, [staff]);

  const activeArea = useMemo(
    () => areas.find((a) => a.id === activeAreaId) || null,
    [areas, activeAreaId]
  );

  const visibleServices = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = services.filter((x) => x.areaId === activeAreaId);
    if (!s) return list;
    return list.filter((x) => String(x.title || "").toLowerCase().includes(s));
  }, [services, activeAreaId, q]);

  const selectedCount = useMemo(() => {
    let n = 0;
    for (const areaId of Object.keys(selectedByArea)) {
      const ids = selectedByArea[areaId]?.selectedServiceIds;
      if (ids && ids.size) n += ids.size;
    }
    return n;
  }, [selectedByArea]);

  function ensureAreaState(areaId) {
    setSelectedByArea((prev) => {
      if (prev[areaId]) return prev;
      return {
        ...prev,
        [areaId]: { selectedServiceIds: new Set(), preferredStaffId: "", note: "" },
      };
    });
  }

  function toggleService(serviceId) {
    const areaId = activeAreaId;
    if (!areaId) return;

    setSelectedByArea((prev) => {
      const current = prev[areaId] || { selectedServiceIds: new Set(), preferredStaffId: "", note: "" };
      const nextSet = new Set(current.selectedServiceIds || []);
      if (nextSet.has(serviceId)) nextSet.delete(serviceId);
      else nextSet.add(serviceId);

      return {
        ...prev,
        [areaId]: { ...current, selectedServiceIds: nextSet },
      };
    });
  }

  function setPreferredStaff(areaId, staffId) {
    setSelectedByArea((prev) => {
      const current = prev[areaId] || { selectedServiceIds: new Set(), preferredStaffId: "", note: "" };
      return { ...prev, [areaId]: { ...current, preferredStaffId: staffId } };
    });
  }

  function setAreaNote(areaId, text) {
    setSelectedByArea((prev) => {
      const current = prev[areaId] || { selectedServiceIds: new Set(), preferredStaffId: "", note: "" };
      return { ...prev, [areaId]: { ...current, note: text } };
    });
  }

  function next() {
    const step0 = JSON.parse(sessionStorage.getItem("kiosk_payload_step0") || "{}");

    // requestedAreas = areas where at least 1 service is selected
    const requestedAreas = Object.entries(selectedByArea)
      .map(([areaId, v]) => {
        const ids = v?.selectedServiceIds || new Set();
        if (!ids.size) return null;

        const preferred = (staffByArea[areaId] || []).find((x) => x.id === v.preferredStaffId);
        const chosenServices = services
          .filter((s) => s.areaId === areaId && ids.has(s.id))
          .map((s) => ({ id: s.id, title: s.title, price: Number(s.price || 0), areaId }));

        return {
          areaId,
          preferredStaffId: v.preferredStaffId || null,
          preferredStaffName: preferred?.name || null,
          note: v.note || "",
          services: chosenServices, // keep for next step if you want
        };
      })
      .filter(Boolean);

    if (!requestedAreas.length) return;

    const payload = {
      ...step0,
      displayName: displayName || "Kunde",
      note,
      requestedAreas,
    };

    sessionStorage.setItem("kiosk_payload_step1", JSON.stringify(payload));
    nav("/kiosk/group");
  }

  // ensure state exists when switching tabs
  useEffect(() => {
    if (activeAreaId) ensureAreaState(activeAreaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAreaId]);

  const activeAreaState = activeAreaId ? selectedByArea[activeAreaId] : null;
  const activeSelectedIds = activeAreaState?.selectedServiceIds || new Set();

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        {/* Top header (premium) */}
        <div className={styles.top}>
          <div>
            <div className={styles.h1}>Behandlungen auswählen</div>
            <div className={styles.sub}>
              Wählen Sie oben einen Bereich. Unten wählen Sie Services, optional Wunsch-Mitarbeiter und Notiz.
            </div>
          </div>

          <div className={styles.badge}>Ausgewählt: {selectedCount}</div>
        </div>

        {/* Identity card */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.cardTitle}>Check-in</div>
            <div className={styles.cardHint}>Anzeige & Notiz für den gesamten Check-in.</div>
          </div>

          <div className={styles.form2}>
            <label className={styles.fLabel}>
              Name / Anzeige
              <input
                className={styles.input}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="z. B. Kunde / Gast"
              />
            </label>

            <label className={styles.fLabel}>
              Notiz (optional)
              <input
                className={styles.input}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="z. B. Allergie, Wunsch, Info…"
              />
            </label>
          </div>
        </div>

        {/* NEW: Area tabs + search (between header and box content) */}
        <div className={styles.tabsBar}>
          <div className={styles.tabsRow} role="tablist" aria-label="Bereiche">
            {areas.map((a) => (
              <button
                key={a.id}
                className={`${styles.tab} ${a.id === activeAreaId ? styles.tabOn : ""}`}
                type="button"
                onClick={() => {
                  setActiveAreaId(a.id);
                  setQ("");
                }}
              >
                {a.name}
              </button>
            ))}
          </div>

          <div className={styles.searchWrap}>
            <input
              className={styles.search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                activeArea ? `Suche in ${activeArea.name}…` : "Suche…"
              }
            />
          </div>
        </div>

        {/* Content box (services list + area options) */}
        <div className={styles.card}>
          <div className={styles.cardHeadSplit}>
            <div>
              <div className={styles.cardTitle}>
                Services {activeArea ? `· ${activeArea.name}` : ""}
              </div>
              <div className={styles.cardHint}>
                Klicken Sie auf „Wählen“, um einen Service hinzuzufügen/zu entfernen.
              </div>
            </div>

            {/* Area-specific options */}
            <div className={styles.areaTools}>
              <div className={styles.areaTool}>
                <div className={styles.toolLabel}>Wunsch-Mitarbeiter</div>
                <select
                  className={styles.select}
                  value={activeAreaState?.preferredStaffId || ""}
                  onChange={(e) => setPreferredStaff(activeAreaId, e.target.value)}
                  disabled={!activeAreaId}
                >
                  <option value="">Freilassen</option>
                  {(staffByArea[activeAreaId] || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.areaTool}>
                <div className={styles.toolLabel}>Bereichs-Notiz</div>
                <input
                  className={styles.input}
                  value={activeAreaState?.note || ""}
                  onChange={(e) => setAreaNote(activeAreaId, e.target.value)}
                  placeholder="Optional…"
                  disabled={!activeAreaId}
                />
              </div>
            </div>
          </div>

          <div className={styles.itemsGrid}>
            {(!activeAreaId || visibleServices.length === 0) ? (
              <div className={styles.empty}>
                {activeAreaId ? "Keine Services in diesem Bereich gefunden." : "Bitte zuerst einen Bereich wählen."}
              </div>
            ) : (
              visibleServices.map((s) => {
                const on = activeSelectedIds.has(s.id);
                return (
                  <div key={s.id} className={`${styles.item} ${on ? styles.itemOn : ""}`}>
                    <div>
                      <div className={styles.itemTitle}>{s.title}</div>
                      <div className={styles.itemMeta}>Preis: {money(s.price)} €</div>
                    </div>
                    <button
                      className={`${styles.itemBtn} ${on ? styles.itemBtnOn : ""}`}
                      type="button"
                      onClick={() => toggleService(s.id)}
                    >
                      {on ? "Entfernen" : "Wählen"}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className={styles.footer}>
            <button className={styles.secondary} type="button" onClick={() => nav("/kiosk")}>
              Zurück
            </button>
            <button className={styles.primary} type="button" onClick={next} disabled={selectedCount === 0}>
              Weiter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
