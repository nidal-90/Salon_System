// src/features/reception/pages/ReceptionLiveboardPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../db/index.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";
import styles from "./ReceptionLiveboardPage.module.css";

function safeStr(x) {
  return String(x == null ? "" : x).trim();
}

function fmtClock(iso) {
  const s = safeStr(iso);
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

function useUsbStaffFallback() {
  try {
    const raw = sessionStorage.getItem("usb_session");
    if (!raw) return { staffId: "", staffName: "" };
    const s = JSON.parse(raw);
    return {
      staffId: s?.staffId || "",
      staffName: s?.staffName || s?.name || "",
    };
  } catch {
    return { staffId: "", staffName: "" };
  }
}

async function logCustomerTimerToHistory({
  customerId,
  visitId,
  areaId,
  areaName,
  staffId,
  staffName,
  type, // "WAITING_TIMER" | "ACTIVE_TIMER"
  startedAt,
  endedAt,
  durationMs,
}) {
  if (!customerId) return;
  try {
    await db.customer_history.add({
      id: crypto.randomUUID(),
      customerId: String(customerId),
      createdAt: new Date().toISOString(),
      visitId: String(visitId || ""),
      areaId: String(areaId || ""),
      staffId: String(staffId || ""),
      staffName: String(staffName || ""),
      type: String(type || "TIMER"),
      payload: {
        areaName: String(areaName || ""),
        startedAt: String(startedAt || ""),
        endedAt: String(endedAt || ""),
        durationMs: Number(durationMs || 0),
      },
    });
  } catch {
    // audit must never block UX
  }
}

export default function ReceptionLiveboardPage() {
  const nav = useNavigate();
  const usb = useUsbStaffFallback();

  const [tab, setTab] = useState("waiting"); // waiting | active | checkout
  const [dateKey, setDateKey] = useState(() => toDateKeyISO(new Date()));

  const [areas, setAreas] = useState([]);
  const [staff, setStaff] = useState([]);

  const [selectedAreaIds, setSelectedAreaIds] = useState(new Set()); // empty => all
  const [rows, setRows] = useState([]); // enriched
  const [searchName, setSearchName] = useState("");

  const [activeStaffId, setActiveStaffId] = useState(() => usb.staffId || "");
  const [busyId, setBusyId] = useState("");
  const [toast, setToast] = useState("");

  // tick for live timers
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  function showToast(msg) {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(""), 2200);
  }

  async function loadBase() {
    const [a, st] = await Promise.all([
      db.areas.toArray().catch(() => []),
      db.staff.toArray().catch(() => []),
    ]);

    const cleanAreas = (a || [])
      .filter((x) => Number(x.active) === 1 || x.active === true)
      .sort((x, y) => Number(x.displayNo || 9999) - Number(y.displayNo || 9999));

    const cleanStaff = (st || [])
      .filter((x) => Number(x.active) === 1 || x.active === true)
      .sort((x, y) => String(x.name || "").localeCompare(String(y.name || "")));

    setAreas(cleanAreas);
    setStaff(cleanStaff);

    // if usb session exists and staffId still empty, set it once
    if (!activeStaffId && usb.staffId) setActiveStaffId(usb.staffId);
  }

  async function loadBoard() {
    const [vas, visits, visitServices, areaStatesAll] = await Promise.all([
      db.visit_area_state.where("dateKey").equals(dateKey).toArray().catch(() => []),
      db.visits.where("dateKey").equals(dateKey).toArray().catch(() => []),
      db.visit_services.where("dateKey").equals(dateKey).toArray().catch(() => []),
      // used to compute "all done per visit" for checkout warnings
      db.visit_area_state.where("dateKey").equals(dateKey).toArray().catch(() => []),
    ]);

    const visitById = new Map((visits || []).map((v) => [String(v.id), v]));
    const areaById = new Map((areas || []).map((a) => [String(a.id), a]));
    const staffById = new Map((staff || []).map((s) => [String(s.id), s]));

    // group services by (visitId+areaId)
    const svcMap = new Map();
    for (const s of visitServices || []) {
      const key = `${String(s.visitId)}__${String(s.areaId)}`;
      if (!svcMap.has(key)) svcMap.set(key, []);
      svcMap.get(key).push(s);
    }

    // per visit readiness: all areas done?
    const statesByVisit = new Map();
    for (const stRow of areaStatesAll || []) {
      const vid = String(stRow.visitId || "");
      if (!vid) continue;
      if (!statesByVisit.has(vid)) statesByVisit.set(vid, []);
      statesByVisit.get(vid).push(stRow);
    }
    const readinessByVisit = new Map();
    for (const [vid, list] of statesByVisit.entries()) {
      const any = list.length > 0;
      const allDone = any && list.every((x) => String(x.status) === "done");
      readinessByVisit.set(vid, { any, allDone, pending: list.filter((x) => String(x.status) !== "done").length });
    }

    const enriched = (vas || []).map((x) => {
      const visit = visitById.get(String(x.visitId)) || null;
      const area = areaById.get(String(x.areaId)) || null;

      const displayName =
        safeStr(visit?.displayName) ||
        safeStr(x.displayName) ||
        `Visit ${String(x.visitId).slice(-6)}`;

      const checkInAt = safeStr(visit?.createdAt) || "";

      const areaName = safeStr(area?.name) || "Bereich";

      const assigned = x.assignedStaffId ? staffById.get(String(x.assignedStaffId)) : null;
      const preferred = x.preferredStaffId ? staffById.get(String(x.preferredStaffId)) : null;

      const key = `${String(x.visitId)}__${String(x.areaId)}`;
      const svcs = (svcMap.get(key) || []).map((s) => safeStr(s.title)).filter(Boolean);

      // Timer: starts in current status using startedAt if set, else fallback to visit.createdAt for waiting
      const status = String(x.status || "");
      const startedAt =
        safeStr(x.startedAt) ||
        (status === "waiting" ? safeStr(visit?.createdAt) : "");

      const endedAt = safeStr(x.endedAt);

      let elapsedMs = 0;
      if (startedAt) {
        const st = new Date(startedAt).getTime();
        const en = endedAt ? new Date(endedAt).getTime() : Date.now();
        if (Number.isFinite(st) && Number.isFinite(en)) elapsedMs = Math.max(0, en - st);
      }

      const ready = readinessByVisit.get(String(x.visitId)) || { any: false, allDone: false, pending: 0 };

      return {
        ...x,
        _status: status,
        _displayName: displayName,
        _checkInAt: checkInAt,
        _areaName: areaName,
        _preferredStaffName: safeStr(x.preferredStaffName) || safeStr(preferred?.name) || "",
        _assignedStaffName: safeStr(x.assignedStaffName) || safeStr(assigned?.name) || "",
        _serviceTitles: svcs,
        _timerStart: startedAt,
        _elapsedMs: elapsedMs,
        _visitReadyAllDone: !!ready.allDone,
        _visitPendingCount: Number(ready.pending || 0),
      };
    });

    setRows(enriched);
  }

  useEffect(() => {
    loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!areas.length) return;
    loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, areas.length, staff.length]);

  // live timer refresh
  const liveRows = useMemo(() => {
    void tick;
    return rows.map((r) => {
      if (r._status !== "waiting" && r._status !== "active") return r;
      const startedAt = safeStr(r._timerStart);
      if (!startedAt) return r;
      const st = new Date(startedAt).getTime();
      const en = Date.now();
      const ms = Number.isFinite(st) ? Math.max(0, en - st) : 0;
      return { ...r, _elapsedMs: ms };
    });
  }, [rows, tick]);

  const areaFilterActive = selectedAreaIds.size > 0;
  const searchQ = searchName.trim().toLowerCase();

  // --------- Checkout tab groups by visit (so cashier gets ALL treatments) ----------
  const checkoutVisits = useMemo(() => {
    // gather done items per visit
    const done = (liveRows || []).filter((r) => String(r._status) === "done");
    const byVisit = new Map();
    for (const r of done) {
      const vid = String(r.visitId || "");
      if (!vid) continue;
      if (!byVisit.has(vid)) byVisit.set(vid, []);
      byVisit.get(vid).push(r);
    }

    const out = [];
    for (const [visitId, list] of byVisit.entries()) {
      const first = list[0];
      const displayName = first?._displayName || `Visit ${visitId.slice(-6)}`;
      const checkInAt = first?._checkInAt || "";
      const allDone = list.every((x) => x._visitReadyAllDone); // redundant but safe
      const pending = Math.max(0, Number(first?._visitPendingCount || 0));

      // areas involved (names)
      const areaNames = Array.from(new Set(list.map((x) => x._areaName).filter(Boolean)));

      out.push({
        visitId,
        displayName,
        checkInAt,
        areaNames,
        allDone: !!(first?._visitReadyAllDone) && pending === 0,
        pendingCount: pending,
      });
    }

    // search filter
    return out
      .filter((x) => (searchQ ? String(x.displayName || "").toLowerCase().includes(searchQ) : true))
      .sort((a, b) => String(b.checkInAt || "").localeCompare(String(a.checkInAt || "")));
  }, [liveRows, searchQ]);

  // --------- Waiting / Active tab per area rows ----------
  const filteredRows = useMemo(() => {
    if (tab === "checkout") return [];

    const st = String(tab);
    return (liveRows || [])
      .filter((r) => String(r._status) === st)
      .filter((r) => {
        if (!areaFilterActive) return true;
        return selectedAreaIds.has(String(r.areaId));
      })
      .filter((r) => (searchQ ? String(r._displayName || "").toLowerCase().includes(searchQ) : true))
      .sort((a, b) => {
        // waiting: longest waiting first (oldest at top)
        // active: longest active first
        const ax = Number(a._elapsedMs || 0);
        const bx = Number(b._elapsedMs || 0);
        return bx - ax;
      });
  }, [liveRows, tab, areaFilterActive, selectedAreaIds, searchQ]);

  const kpis = useMemo(() => {
    const base = (liveRows || []).filter((r) => {
      if (!areaFilterActive) return true;
      return selectedAreaIds.has(String(r.areaId));
    });
    const waiting = base.filter((r) => r._status === "waiting").length;
    const active = base.filter((r) => r._status === "active").length;
    const done = base.filter((r) => r._status === "done").length;

    const activeMax = base
      .filter((r) => r._status === "active")
      .reduce((m, r) => Math.max(m, Number(r._elapsedMs || 0)), 0);

    return { waiting, active, done, activeMax };
  }, [liveRows, areaFilterActive, selectedAreaIds]);

  function toggleArea(id) {
    setSelectedAreaIds((prev) => {
      const n = new Set(prev);
      const key = String(id);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function clearAreas() {
    setSelectedAreaIds(new Set());
  }

  async function setRowStaff(rowId, staffId) {
    const sid = safeStr(staffId);
    const s = staff.find((x) => String(x.id) === sid) || null;
    await db.visit_area_state.update(rowId, {
      assignedStaffId: sid || null,
      assignedStaffName: s ? String(s.name || "") : "",
    });
  }

  // WAITING -> ACTIVE:
  // - close waiting timer: [waitingStart -> now] => write to customer_history
  // - start new active timer by setting startedAt = now (and keep endedAt null)
  async function take(row) {
    if (!row?.id) return;
    setBusyId(row.id);
    try {
      const nowIso = new Date().toISOString();

      // staff: prefer activeStaffId (USB), fallback to assigned
      const finalStaffId = safeStr(activeStaffId) || safeStr(row.assignedStaffId) || "";
      const s = finalStaffId ? staff.find((x) => String(x.id) === String(finalStaffId)) : null;
      const staffName = s ? String(s.name || "") : safeStr(row._assignedStaffName);

      // waiting timer close
      const waitingStart = safeStr(row._timerStart) || safeStr(row._checkInAt);
      if (waitingStart) {
        const st = new Date(waitingStart).getTime();
        const en = new Date(nowIso).getTime();
        const ms = Number.isFinite(st) && Number.isFinite(en) ? Math.max(0, en - st) : 0;

        // customerId: comes from visits.customerId (may be null for guests)
        const visit = await db.visits.get(String(row.visitId)).catch(() => null);
        const customerId = visit?.customerId ? String(visit.customerId) : "";

        await logCustomerTimerToHistory({
          customerId,
          visitId: row.visitId,
          areaId: row.areaId,
          areaName: row._areaName,
          staffId: finalStaffId,
          staffName,
          type: "WAITING_TIMER",
          startedAt: waitingStart,
          endedAt: nowIso,
          durationMs: ms,
        });
      }

      await db.visit_area_state.update(row.id, {
        status: "active",
        assignedStaffId: finalStaffId || null,
        assignedStaffName: staffName || "",
        startedAt: nowIso, // new timer for active
        endedAt: null,
      });

      showToast("Übernommen. Aktiv-Timer läuft.");
      await loadBoard();
    } catch (e) {
      showToast(String(e?.message || e));
    } finally {
      setBusyId("");
    }
  }

  // ACTIVE -> DONE:
  // - close active timer: [row.startedAt -> now] => write to customer_history
  async function finish(row) {
    if (!row?.id) return;
    setBusyId(row.id);
    try {
      const nowIso = new Date().toISOString();

      const activeStart = safeStr(row.startedAt) || safeStr(row._timerStart);
      if (activeStart) {
        const st = new Date(activeStart).getTime();
        const en = new Date(nowIso).getTime();
        const ms = Number.isFinite(st) && Number.isFinite(en) ? Math.max(0, en - st) : 0;

        const visit = await db.visits.get(String(row.visitId)).catch(() => null);
        const customerId = visit?.customerId ? String(visit.customerId) : "";

        await logCustomerTimerToHistory({
          customerId,
          visitId: row.visitId,
          areaId: row.areaId,
          areaName: row._areaName,
          staffId: safeStr(row.assignedStaffId),
          staffName: safeStr(row._assignedStaffName),
          type: "ACTIVE_TIMER",
          startedAt: activeStart,
          endedAt: nowIso,
          durationMs: ms,
        });
      }

      await db.visit_area_state.update(row.id, {
        status: "done",
        endedAt: nowIso,
      });

      showToast("Fertig. Für Checkout gesammelt.");
      await loadBoard();
    } catch (e) {
      showToast(String(e?.message || e));
    } finally {
      setBusyId("");
    }
  }

  async function undoToWaiting(row) {
    if (!row?.id) return;
    const ok = window.confirm("Zurück auf Wartend setzen? (Aktiv-Timer wird verworfen)");
    if (!ok) return;

    setBusyId(row.id);
    try {
      // We set waiting timer start to visit.createdAt fallback on render; here keep startedAt empty
      await db.visit_area_state.update(row.id, {
        status: "waiting",
        startedAt: null,
        endedAt: null,
      });
      showToast("Zurück auf Wartend.");
      await loadBoard();
    } catch (e) {
      showToast(String(e?.message || e));
    } finally {
      setBusyId("");
    }
  }

  async function undoToActiveFromDone(row) {
    if (!row?.id) return;
    const ok = window.confirm("Zurück auf Aktiv setzen? (Done wird entfernt)");
    if (!ok) return;

    setBusyId(row.id);
    try {
      const nowIso = new Date().toISOString();
      await db.visit_area_state.update(row.id, {
        status: "active",
        startedAt: nowIso,
        endedAt: null,
      });
      showToast("Zurück auf Aktiv.");
      await loadBoard();
    } catch (e) {
      showToast(String(e?.message || e));
    } finally {
      setBusyId("");
    }
  }

  // Smart top tabs (above list)
  const smartTabs = [
    { key: "waiting", title: "Warteliste", hint: "Ankunft & Queue", kpi: kpis.waiting },
    { key: "active", title: "In Behandlung", hint: "Chair Time", kpi: kpis.active },
    { key: "checkout", title: "Checkout", hint: "Alles gesammelt", kpi: checkoutVisits.length || 0 },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.top}>
          <div>
            <h1 className={styles.h1}>Liveboard</h1>
            <div className={styles.sub}>
              Wartend → Aktiv → Checkout. Bereich-Filter, Suche, Staff-Zuweisung und sauberes Timing-Tracking.
            </div>
          </div>

          <div className={styles.controls}>
            <label className={styles.fLabel}>
              Datum
              <input className={styles.input} type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
            </label>

            <label className={styles.fLabel}>
              Aktiver Mitarbeiter
              <select className={styles.input} value={activeStaffId} onChange={(e) => setActiveStaffId(e.target.value)}>
                <option value="">(USB / nicht gewählt)</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <button className={styles.btnGhost} type="button" onClick={() => nav("/reception")}>
              Zurück
            </button>
          </div>
        </div>

        {toast ? <div className={styles.alertOk}>{toast}</div> : null}

        <div className={styles.kpis}>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Wartend</div>
            <div className={styles.kpiVal}>{kpis.waiting}</div>
            <div className={styles.kpiMeta}>Queue Items</div>
          </div>

          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Aktiv</div>
            <div className={styles.kpiVal}>{kpis.active}</div>
            <div className={styles.kpiMeta}>In Behandlung</div>
          </div>

          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Done</div>
            <div className={styles.kpiVal}>{kpis.done}</div>
            <div className={styles.kpiMeta}>Bereiche fertig</div>
          </div>

          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Längste Aktivzeit</div>
            <div className={styles.kpiVal}>{fmtDuration(kpis.activeMax)}</div>
            <div className={styles.kpiMeta}>Heute (Filter)</div>
          </div>
        </div>

        <div className={styles.grid}>
          {/* LEFT: areas */}
          <div className={styles.card}>
            <div className={styles.cardHeadRow}>
              <div className={styles.cardTitle}>Bereiche</div>
              <button className={styles.btnGhostSm} type="button" onClick={clearAreas}>
                Alle
              </button>
            </div>

            <div className={styles.areaGrid}>
              {areas.map((a) => {
                const id = String(a.id);
                const checked = selectedAreaIds.has(id);
                return (
                  <label key={id} className={`${styles.areaPill} ${checked ? styles.areaPillOn : ""}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleArea(id)} />
                    <span className={styles.areaName}>{a.name}</span>
                  </label>
                );
              })}
            </div>

            <div className={styles.note}>
              Wenn keine Checkbox gewählt ist, werden automatisch <b>alle Bereiche</b> angezeigt.
            </div>
          </div>

          {/* RIGHT: board */}
          <div className={styles.card}>
            {/* smart header: tabs + search */}
            <div className={styles.boardTop}>
              <div className={styles.smartTabs} role="tablist" aria-label="Liveboard Tabs">
                {smartTabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.key}
                    className={`${styles.smartTab} ${tab === t.key ? styles.smartTabOn : ""}`}
                    onClick={() => setTab(t.key)}
                  >
                    <div className={styles.smartTabRow}>
                      <div>
                        <div className={styles.smartTabTitle}>{t.title}</div>
                        <div className={styles.smartTabHint}>{t.hint}</div>
                      </div>
                      <div className={styles.smartTabKpi}>{t.kpi}</div>
                    </div>
                  </button>
                ))}
              </div>

              <div className={styles.boardActions}>
                <input
                  className={styles.search}
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  placeholder="Kunde suchen…"
                />
                <button className={styles.btnGhostSm} type="button" onClick={loadBoard}>
                  Aktualisieren
                </button>
              </div>
            </div>

            {/* list container scrollable */}
            <div className={styles.table}>
              {/* HEAD */}
              {tab !== "checkout" ? (
                <div className={styles.trHead}>
                  <div>Kunde</div>
                  <div>Bereich</div>
                  <div>Wunsch</div>
                  <div>Mitarbeiter</div>
                  <div className={styles.taRight}>Timer</div>
                  <div className={styles.taRight}>Aktion</div>
                </div>
              ) : (
                <div className={styles.trHeadCheckout}>
                  <div>Kunde</div>
                  <div>Bereiche</div>
                  <div>Status</div>
                  <div className={styles.taRight}>Aktion</div>
                </div>
              )}

              <div className={styles.scrollBody}>
                {tab === "checkout" ? (
                  checkoutVisits.length === 0 ? (
                    <div className={styles.empty}>Keine Checkout-Kandidaten gefunden.</div>
                  ) : (
                    checkoutVisits.map((v) => {
                      const warn = !v.allDone;
                      return (
                        <div key={v.visitId} className={styles.trRowCheckout}>
                          <div>
                            <div className={styles.bold}>{v.displayName}</div>
                            <div className={styles.mutedMini}>
                              Check-in: <b>{fmtClock(v.checkInAt)}</b> 
                              <span className={styles.mono}></span>
                            </div>
                          </div>

                          <div className={styles.areaList}>
                            {(v.areaNames || []).slice(0, 6).map((n) => (
                              <span key={n} className={styles.chip}>{n}</span>
                            ))}
                            {(v.areaNames || []).length > 6 ? (
                              <span className={styles.chipMuted}>+{(v.areaNames || []).length - 6}</span>
                            ) : null}
                          </div>

                          <div>
                            {warn ? (
                              <div className={styles.warnBadge}>
                                Nicht fertig ({v.pendingCount} offen)
                              </div>
                            ) : (
                              <div className={styles.okBadge}>Bereit</div>
                            )}
                          </div>

                          <div className={`${styles.taRight} ${styles.actionCell}`}>
                            <button
                              className={styles.btnPrimarySm}
                              type="button"
                              onClick={() => nav(`/reception/checkout?visitId=${encodeURIComponent(v.visitId)}`)}
                              title={warn ? "Es sind noch Bereiche offen – Kasse zeigt Warnung." : "Zur Kasse"}
                            >
                              Zur Kasse
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )
                ) : filteredRows.length === 0 ? (
                  <div className={styles.empty}>Keine Einträge. Prüfe Filter oder Suche.</div>
                ) : (
                  filteredRows.map((r) => {
                    const services = r._serviceTitles || [];
                    const wish = services.length ? services.slice(0, 3).join(" · ") : "—";
                    const wishMore = services.length > 3 ? ` +${services.length - 3}` : "";

                    const staffValue = safeStr(r.assignedStaffId || "");
                    const isBusy = String(busyId) === String(r.id);

                    return (
                      <div key={r.id} className={styles.trRow}>
                        <div>
                          <div className={styles.bold}>{r._displayName}</div>

                          {/* NEW: Check-in Zeit unter Name (Warteliste) */}
                          <div className={styles.mutedMini}>
                            Check-in: <b>{fmtClock(r._checkInAt)}</b> 
                            <span className={styles.mono}></span>
                          </div>
                        </div>

                        <div>
                          <div className={styles.areaTag}>{r._areaName}</div>
                          <div className={styles.mutedMini}>
                            Wunsch: {r._preferredStaffName ? <b>{r._preferredStaffName}</b> : "—"}
                          </div>
                        </div>

                        <div className={styles.wishCell} title={services.join(" · ")}>
                          {wish}
                          {wishMore ? <span className={styles.wishMore}>{wishMore}</span> : null}
                        </div>

                        <div>
                          <select
                            className={styles.select}
                            value={staffValue}
                            onChange={async (e) => {
                              await setRowStaff(r.id, e.target.value);
                              await loadBoard();
                            }}
                            disabled={isBusy}
                            title="Zuständigen Mitarbeiter festlegen"
                          >
                            <option value="">—</option>
                            {staff.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                          <div className={styles.mutedMini}>{staffValue ? "Zugewiesen" : "Nicht zugewiesen"}</div>
                        </div>

                        <div className={`${styles.taRight} ${styles.mono}`}>
                          {fmtDuration(Number(r._elapsedMs || 0))}
                        </div>

                        <div className={`${styles.taRight} ${styles.actionCell}`}>
                          {tab === "waiting" ? (
                            <button
                              className={styles.btnPrimarySm}
                              type="button"
                              onClick={() => take(r)}
                              disabled={isBusy}
                              title="Übernehmen (Wartezeit wird geloggt, Aktiv-Timer startet neu)"
                            >
                              {isBusy ? "…" : "Übernehmen"}
                            </button>
                          ) : (
                            <>
                              <button
                                className={styles.btnPrimarySm}
                                type="button"
                                onClick={() => finish(r)}
                                disabled={isBusy}
                                title="Fertig (Aktivzeit wird geloggt)"
                              >
                                {isBusy ? "…" : "Fertig"}
                              </button>

                              <button
                                className={styles.btnGhostSm}
                                type="button"
                                onClick={() => undoToWaiting(r)}
                                disabled={isBusy}
                                title="Zurück zu Wartend"
                              >
                                Zurück
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className={styles.note}>
              Timer-Tracking:
              <b> Wartend</b> wird bei “Übernehmen” als <b>WAITING_TIMER</b> im Kundenprofil gespeichert.
              <b> Aktiv</b> wird bei “Fertig” als <b>ACTIVE_TIMER</b> gespeichert.
              Gäste (ohne customerId) werden nicht in customer_history geschrieben.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
