// src/features/reception/pages/ReceptionCheckInPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../db/index.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";
import { nextGuestDisplayName } from "../../../services/guest/guestCounter.js";
import KioskOrderEmbed from "../../kiosk/pages/KioskOrderEmbed.jsx";
import styles from "./ReceptionCheckInPage.module.css";

/** ---------- Helpers ---------- */
function safeName(c) {
  const a = String(c?.firstName || "").trim();
  const b = String(c?.lastName || "").trim();
  const full = `${a} ${b}`.trim();
  return full || String(c?.displayName || "").trim() || "Unbekannt";
}

function groupTitle(g) {
  if (!g) return "Gruppe";
  return (
    String(g?.group?.title || "").trim() ||
    String(g?.displayName || "").trim() ||
    "Gruppe"
  );
}

function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

function money(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? x.toFixed(2) : "0.00";
}

function buildContactDisplayName(groupRow) {
  const a = String(groupRow?.firstName || "").trim();
  const b = String(groupRow?.lastName || "").trim();
  const full = `${a} ${b}`.trim();
  return full || "Kontakt";
}

/**
 * Create a stable key for a participant (contact/member)
 * - contact: "contact:<groupId>"
 * - member:  "member:<groupId>:<idx>"
 */
function participantKeyOf({ kind, groupId, index }) {
  return kind === "contact" ? `contact:${groupId}` : `member:${groupId}:${index}`;
}

function msToHhMm(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `${mm} Min`;
  return `${h}h ${mm} Min`;
}

/** Robust DB details loader */
async function fetchVisitFullDetails(visitId) {
  if (!visitId) return null;

  const [visit, services, products, areaStates] = await Promise.all([
    db.visits.get(visitId).catch(() => null),
    db.visit_services.where("visitId").equals(visitId).toArray().catch(() => []),
    db.visit_products.where("visitId").equals(visitId).toArray().catch(() => []),
    db.visit_area_state.where("visitId").equals(visitId).toArray().catch(() => []),
  ]);

  const serviceLines = (services || []).map((s) => ({
    id: s.id,
    areaId: s.areaId,
    title: s.title || s.name || "Service",
    staffId: s.staffId || "",
    staffName: s.staffName || "",
    startedAt: s.startedAt || "",
    endedAt: s.endedAt || "",
    price: Number(s.price || 0),
    note: s.note || "",
  }));

  const productLines = (products || []).map((p) => ({
    id: p.id,
    title: p.title || p.name || "Produkt",
    staffId: p.staffId || "",
    staffName: p.staffName || "",
    qty: Number(p.qty || 1),
    price: Number(p.price || 0),
  }));

  const now = Date.now();
  const liveboard = (areaStates || []).map((st) => {
    const started = st.startedAt ? Date.parse(st.startedAt) : null;
    const ended = st.endedAt ? Date.parse(st.endedAt) : null;
    const sinceMs = started && !ended ? Math.max(0, now - started) : 0;

    return {
      id: st.id,
      areaId: st.areaId,
      dateKey: st.dateKey,
      status: st.status || "waiting",
      preferredStaffName: st.preferredStaffName || "",
      assignedStaffName: st.assignedStaffName || "",
      startedAt: st.startedAt || "",
      endedAt: st.endedAt || "",
      sinceMs,
      note: st.note || "",
    };
  });

  const serviceSum = serviceLines.reduce((a, x) => a + (Number.isFinite(x.price) ? x.price : 0), 0);
  const productSum = productLines.reduce((a, x) => a + (Number.isFinite(x.price) ? x.price : 0) * (x.qty || 1), 0);
  const total = Number(visit?.total || visit?.sum || visit?.amount || 0) || (serviceSum + productSum);

  return { visit, serviceLines, productLines, liveboard, total };
}

export default function ReceptionCheckInPage() {
  const nav = useNavigate();

  const [customers, setCustomers] = useState([]);
  const [areasCount, setAreasCount] = useState(0);

  const [mode, setMode] = useState("customer"); // customer|group|guest
  const [query, setQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

  // groups
  const [groups, setGroups] = useState([]);
  const [groupQuery, setGroupQuery] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");

  // group participants flow
  const [selectedParticipantKey, setSelectedParticipantKey] = useState("");
  const [doneMap, setDoneMap] = useState({}); // { [participantKey]: true }

  // today visits / checkins
  const [todayVisits, setTodayVisits] = useState([]);
  const [todayCount, setTodayCount] = useState(0);

  // UX overlays
  const [toast, setToast] = useState("");
  const [openToday, setOpenToday] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState(null);

  // detail modal (browser tabs)
  const [detailTab, setDetailTab] = useState("order"); // customer|order|live
  const [selectedVisitFull, setSelectedVisitFull] = useState(null);
  const [tick, setTick] = useState(0); // triggers timer rerender

  // step2: kiosk embed
  const [profile, setProfile] = useState(null);
  const [activeParticipantKey, setActiveParticipantKey] = useState("");

  function showToast(msg) {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(""), 2200);
  }

  async function reloadBase() {
    const [c, a] = await Promise.all([
      db.customers.toArray().catch(() => []),
      db.areas.count().catch(() => 0),
    ]);

    const clean = (c || []).filter(Boolean);
    clean.sort((x, y) => safeName(x).localeCompare(safeName(y)));
    setCustomers(clean);
    setAreasCount(a);

    const dateKey = toDateKeyISO(new Date());
    const list = await db.visits.where("dateKey").equals(dateKey).toArray().catch(() => []);
    list.sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || "")));
    setTodayVisits(list);
    setTodayCount(list.length);

    const g = clean.filter((row) => {
      const kind = String(row?.kind || "");
      return kind === "group" || !!row?.group;
    });
    g.sort((x, y) => groupTitle(x).localeCompare(groupTitle(y)));
    setGroups(g);
  }

  useEffect(() => {
    reloadBase();
  }, []);

  // Live timer in modal (updates "seit X Min")
  useEffect(() => {
    if (!openToday) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 1000 * 10);
    return () => window.clearInterval(t);
  }, [openToday]);

  /** Map open visit by customer (blocks re-checkin, enables edit) */
  const openVisitByCustomerId = useMemo(() => {
    const m = new Map();
    for (const v of todayVisits) {
      const cid = v?.customerId ? String(v.customerId) : "";
      if (!cid) continue;

      const st = String(v.status || "open").toLowerCase();
      const isClosed = ["done", "closed", "checkout_done", "voided", "canceled"].includes(st);

      if (!isClosed && !m.has(cid)) m.set(cid, v);
    }
    return m;
  }, [todayVisits]);

  /** ---------- Customers search ---------- */
  const filteredCustomers = useMemo(() => {
    const qx = query.trim().toLowerCase();
    const base = customers.filter((x) => String(x?.kind || "") !== "group" && !x?.group);
    if (!qx) return base;
    return base.filter((c) => {
      const n = safeName(c).toLowerCase();
      const p = String(c.phone || "").toLowerCase();
      const e = String(c.email || "").toLowerCase();
      return n.includes(qx) || p.includes(qx) || e.includes(qx);
    });
  }, [customers, query]);

  const selectedCustomer = useMemo(() => {
    return customers.find((c) => String(c.id) === String(selectedCustomerId)) || null;
  }, [customers, selectedCustomerId]);

  /** ---------- Groups search ---------- */
  const filteredGroups = useMemo(() => {
    const qx = groupQuery.trim().toLowerCase();
    if (!qx) return groups;
    return groups.filter((g) => {
      const n = groupTitle(g).toLowerCase();
      const p = String(g.phone || "").toLowerCase();
      const meta = JSON.stringify(g || {}).toLowerCase();
      return n.includes(qx) || p.includes(qx) || meta.includes(qx);
    });
  }, [groups, groupQuery]);

  const selectedGroup = useMemo(() => {
    if (!selectedGroupId) return null;
    return groups.find((g) => String(g.id) === String(selectedGroupId)) || null;
  }, [groups, selectedGroupId]);

  const selectedGroupMembers = useMemo(() => {
    const arr = selectedGroup?.group?.members;
    return Array.isArray(arr) ? arr : [];
  }, [selectedGroup]);

  const groupPaymentMode = useMemo(() => {
    const pm = String(selectedGroup?.group?.paymentMode || "single");
    return pm === "split" ? "split" : "single";
  }, [selectedGroup]);

  /** ---------- Participants list (contact + members) ---------- */
  const participants = useMemo(() => {
    if (!selectedGroup) return [];

    const gid = String(selectedGroup.id);

    const contact = {
      kind: "contact",
      key: participantKeyOf({ kind: "contact", groupId: gid }),
      displayName: buildContactDisplayName(selectedGroup),
      phone: String(selectedGroup.phone || ""),
      customerId: String(selectedGroup.id),
      tag: "Kontakt",
    };

    const members = selectedGroupMembers.map((m, idx) => ({
      kind: "member",
      key: participantKeyOf({ kind: "member", groupId: gid, index: idx }),
      displayName: String(m?.displayName || "").trim() || `Mitglied ${idx + 1}`,
      phone: String(m?.phone || ""),
      customerId: m?.customerId ? String(m.customerId) : "",
      tag: "Mitglied",
      index: idx,
    }));

    return [contact, ...members];
  }, [selectedGroup, selectedGroupMembers]);

  const allDone = useMemo(() => {
    if (!participants.length) return false;
    return participants.every((p) => !!doneMap[p.key]);
  }, [participants, doneMap]);

  const doneCount = useMemo(() => {
    return participants.reduce((acc, p) => acc + (doneMap[p.key] ? 1 : 0), 0);
  }, [participants, doneMap]);

  function resetStep2() {
    setProfile(null);
    setActiveParticipantKey("");
  }

  function resetGroupFlow() {
    setSelectedGroupId("");
    setSelectedParticipantKey("");
    setDoneMap({});
    resetStep2();
  }

  useEffect(() => {
    resetStep2();

    if (mode !== "group") {
      resetGroupFlow();
    }
    if (mode !== "customer") {
      setSelectedCustomerId("");
      setQuery("");
    }
  }, [mode]);

  useEffect(() => {
    setSelectedParticipantKey("");
    setDoneMap({});
    resetStep2();
  }, [selectedGroupId]);

  /** ---------- Next (open kiosk) ---------- */
  async function next() {
    // CUSTOMER
    if (mode === "customer") {
      if (!selectedCustomer) return;

      const openVisit = openVisitByCustomerId.get(String(selectedCustomer.id)) || null;

      setProfile({
        mode: "existing",
        customerId: selectedCustomer.id,
        displayName: safeName(selectedCustomer),
        customer: { phone: String(selectedCustomer.phone || "") },
        meta: {
          visitId: openVisit?.id || null,
          isEdit: !!openVisit,
        },
      });
      setActiveParticipantKey("");
      return;
    }

    // GUEST
    if (mode === "guest") {
      const name = await nextGuestDisplayName("Gast");
      setProfile({
        mode: "guest",
        customerId: null,
        displayName: name,
        customer: { phone: "" },
        meta: { visitId: null, isEdit: false },
      });
      setActiveParticipantKey("");
      return;
    }

    // GROUP
    if (mode === "group") {
      if (!selectedGroup) return;
      if (!selectedParticipantKey) return;

      const p = participants.find((x) => x.key === selectedParticipantKey);
      if (!p) return;

      const title = groupTitle(selectedGroup);
      const display = `${title} · ${p.displayName}`.trim();

      if (p.customerId && p.kind === "member") {
        setProfile({
          mode: "existing",
          customerId: p.customerId,
          displayName: display,
          customer: { phone: String(p.phone || "") },
          meta: {
            groupId: String(selectedGroup.id),
            groupTitle: title,
            paymentMode: groupPaymentMode,
            participantKey: p.key,
            visitId: null,
            isEdit: false,
          },
        });
      } else {
        setProfile({
          mode: "guest",
          customerId: null,
          displayName: display,
          customer: { phone: String(p.phone || "") },
          meta: {
            groupId: String(selectedGroup.id),
            groupTitle: title,
            paymentMode: groupPaymentMode,
            participantKey: p.key,
            visitId: null,
            isEdit: false,
          },
        });
      }

      setActiveParticipantKey(p.key);
      return;
    }
  }

  /** ---------- Called when kiosk finishes check-in ---------- */
  async function onCheckInDone() {
    // Group flow: mark participant done
    if (mode === "group" && selectedGroup && activeParticipantKey) {
      const p = participants.find((x) => x.key === activeParticipantKey);
      const name = p?.displayName || "Person";
      showToast(`${name} eingecheckt.`);

      setDoneMap((prev) => ({ ...prev, [activeParticipantKey]: true }));
      resetStep2();

      await reloadBase();

      const pending = participants.filter((x) => !doneMap[x.key] && x.key !== activeParticipantKey);
      const choose = pending[0] || null;
      if (choose) setSelectedParticipantKey(choose.key);

      const allWillBeDone =
        participants.length > 0 &&
        participants.every((x) => (x.key === activeParticipantKey ? true : !!doneMap[x.key]));

      if (allWillBeDone) {
        showToast("Gruppe vollständig eingecheckt.");
        resetGroupFlow();
      }

      return;
    }

    // customer/guest
    showToast("Vorgang gespeichert.");

    setProfile(null);
    setSelectedCustomerId("");
    setSelectedGroupId("");
    setGroupQuery("");
    setSelectedParticipantKey("");
    setDoneMap({});
    setMode("customer");

    await reloadBase();
  }

  /** ---------- “Check-ins heute” modal: list ---------- */
  const todayList = useMemo(() => {
    return todayVisits.map((v) => {
      const cid = v?.customerId || v?.customer?.id || v?.profile?.customerId || "";
      const dn =
        v?.displayName ||
        v?.customerName ||
        v?.profile?.displayName ||
        (cid ? `Kunde ${cid}` : "Gast");
      return { id: v?.id, customerId: cid ? String(cid) : "", displayName: String(dn || "—"), raw: v };
    });
  }, [todayVisits]);

  async function openVisitDetails(v) {
    const raw = v?.raw || null;
    setSelectedVisit(raw);
    setDetailTab("order");
    setSelectedVisitFull(null);

    const full = await fetchVisitFullDetails(raw?.id);
    setSelectedVisitFull(full);
  }

  /** ---------- UI ---------- */
  const selectedOpenVisit = selectedCustomerId ? openVisitByCustomerId.get(String(selectedCustomerId)) : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.shell}>
        <div className={styles.head}>
          <div>
            <div className={styles.title}>Reception · Check-in</div>
            <div className={styles.sub}>
              Kunde auswählen, Gruppe auswählen oder Gast-Check-in (Gast-Nr. zählt automatisch hoch).
            </div>
          </div>

          <button className={styles.back} onClick={() => nav("/reception")} type="button">
            Zurück
          </button>
        </div>

        {toast ? <div className={styles.toast}>{toast}</div> : null}

        {/* KPI Row */}
        <div className={styles.kpiRow}>
          <button
            className={`${styles.kpi} ${styles.kpiBtn}`}
            type="button"
            onClick={() => {
              setOpenToday(true);
              setSelectedVisit(null);
              setSelectedVisitFull(null);
              setDetailTab("order");
            }}
          >
            <div className={styles.kpiLabel}>Check-ins heute</div>
            <div className={styles.kpiVal}>{todayCount}</div>
            <div className={styles.kpiMeta}>Visits (dateKey)</div>
          </button>

          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Kunden</div>
            <div className={styles.kpiVal}>{customers.filter((x) => String(x?.kind || "") !== "group" && !x?.group).length}</div>
            <div className={styles.kpiMeta}>Profile</div>
          </div>

          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Bereiche</div>
            <div className={styles.kpiVal}>{areasCount}</div>
            <div className={styles.kpiMeta}>Zonen / Klassen</div>
          </div>

          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Modus</div>
            <div className={styles.kpiVal}>
              {mode === "customer" ? "Kunde" : mode === "guest" ? "Gast" : "Gruppe"}
            </div>
            <div className={styles.kpiMeta}>Auswahl</div>
          </div>
        </div>

        {/* Panel: Step 1 */}
        <div className={styles.panelWide}>
          <div className={styles.panelHead}>
            <div>
              <div className={styles.panelTitle}>Check-in starten</div>
              <div className={styles.panelSub}>
                Schritt 1: Identität wählen · Schritt 2: Behandlung/Produkte auswählen.
              </div>
            </div>

            <div className={styles.modeRow}>
              <button
                className={`${styles.pill} ${mode === "customer" ? styles.pillOn : ""}`}
                onClick={() => setMode("customer")}
                type="button"
              >
                Kunde
              </button>
              <button
                className={`${styles.pill} ${mode === "group" ? styles.pillOn : ""}`}
                onClick={() => setMode("group")}
                type="button"
              >
                Gruppe
              </button>
              <button
                className={`${styles.pill} ${mode === "guest" ? styles.pillOn : ""}`}
                onClick={() => setMode("guest")}
                type="button"
              >
                Gast
              </button>
            </div>
          </div>

          {/* CUSTOMER */}
          {mode === "customer" && (
            <div className={styles.step}>
              <div className={styles.searchRow}>
                <input
                  className={styles.search}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    resetStep2();
                  }}
                  placeholder="Suche: Name / Telefon / E-Mail"
                />
              </div>

              <div className={styles.list}>
                {filteredCustomers.map((c) => {
                  const on = String(c.id) === String(selectedCustomerId);
                  const openVisit = openVisitByCustomerId.get(String(c.id)) || null;
                  const isOpenChecked = !!openVisit;

                  return (
                    <button
                      key={c.id}
                      className={`${styles.row} ${on ? styles.rowOn : ""} ${isOpenChecked ? styles.rowChecked : ""}`}
                      onClick={() => {
                        setSelectedCustomerId(c.id);
                        resetStep2();
                      }}
                      type="button"
                    >
                      <div>
                        <div className={styles.rowTitle}>{safeName(c)}</div>
                        <div className={styles.rowMeta}>
                          {c.phone ? `Tel: ${c.phone}` : "—"} · {c.email ? c.email : "keine E-Mail"}
                        </div>
                      </div>

                      <div className={styles.rowRight}>
                        {isOpenChecked ? <div className={styles.badgeChecked}>Bearbeiten</div> : null}
                        
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className={styles.footerRow}>
                <button className={styles.primary} onClick={next} disabled={!selectedCustomerId} type="button">
                  {selectedOpenVisit ? "Bestellung bearbeiten" : "Weiter"}
                </button>
              </div>
            </div>
          )}

          {/* GUEST */}
          {mode === "guest" && (
            <div className={styles.step}>
              <div className={styles.note}>
                Gast-Check-in: Es wird automatisch eine Nummer vergeben (Gast 1, Gast 2, …).
              </div>

              <div className={styles.footerRow}>
                <button className={styles.primary} onClick={next} type="button">
                  Weiter (Gast anlegen)
                </button>
              </div>
            </div>
          )}

          {/* GROUP */}
          {mode === "group" && (
            <div className={styles.step}>
              <div className={styles.groupSplit}>
                <div className={styles.groupListBox}>
                  <div className={styles.groupListHead}>
                    <div className={styles.bold}>Vorhandene Gruppen</div>
                    <button
                      type="button"
                      className={styles.ghost}
                      onClick={() => {
                        setSelectedGroupId("");
                        setGroupQuery("");
                        resetGroupFlow();
                      }}
                    >
                      Auswahl löschen
                    </button>
                  </div>

                  <input
                    className={styles.search}
                    value={groupQuery}
                    onChange={(e) => setGroupQuery(e.target.value)}
                    placeholder="Suche: Gruppenname…"
                  />

                  <div className={styles.listSmall}>
                    {filteredGroups.length === 0 ? (
                      <div className={styles.emptyInline}>Keine Gruppen gefunden.</div>
                    ) : (
                      filteredGroups.map((g) => {
                        const on = String(g.id) === String(selectedGroupId);
                        const pm = String(g?.group?.paymentMode || "single") === "split" ? "Separat" : "Zusammen";
                        const tel = g?.phone ? ` · Tel: ${g.phone}` : "";

                        return (
                          <button
                            key={g.id}
                            type="button"
                            className={`${styles.row} ${on ? styles.rowOn : ""}`}
                            onClick={() => {
                              setSelectedGroupId(String(g.id));
                              resetStep2();
                            }}
                          >
                            <div>
                              <div className={styles.rowTitle}>{groupTitle(g)}</div>
                              <div className={styles.rowMeta}>Zahlungsart: {pm}{tel}</div>
                            </div>
                            <div className={styles.rowRight}>
                              {on ? <div className={styles.badge}>Ausgewählt</div> : null}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className={styles.groupFormBox}>
                  {!selectedGroup ? (
                    <div className={styles.emptyInline}>
                      Wähle links eine Gruppe aus, um Kontakt und Mitglieder separat einzuchecken.
                    </div>
                  ) : (
                    <>
                      <div className={styles.groupHeader}>
                        <div>
                          <div className={styles.groupHeaderTitle}>{groupTitle(selectedGroup)}</div>
                          <div className={styles.groupHeaderSub}>
                            Zahlungsart: {groupPaymentMode === "split" ? "Separat" : "Zusammen"} · Fortschritt:{" "}
                            <b>
                              {doneCount}/{participants.length}
                            </b>
                          </div>
                        </div>
                        {allDone ? (
                          <div className={styles.badgeChecked}>Fertig</div>
                        ) : (
                          <div className={styles.badge}>Offen</div>
                        )}
                      </div>

                      <div className={styles.participantList}>
                        {participants.map((p) => {
                          const on = p.key === selectedParticipantKey;
                          const done = !!doneMap[p.key];
                          const tel = onlyDigits(p.phone).length ? `Tel: ${p.phone}` : "Tel: —";

                          return (
                            <button
                              key={p.key}
                              type="button"
                              className={`${styles.row} ${on ? styles.rowOn : ""} ${done ? styles.rowDone : ""}`}
                              onClick={() => {
                                setSelectedParticipantKey(p.key);
                                resetStep2();
                              }}
                            >
                              <div>
                                <div className={styles.rowTitle}>
                                  {p.displayName} <span className={styles.chip}>{p.tag}</span>
                                </div>
                                <div className={styles.rowMeta}>{tel}</div>
                              </div>
                              <div className={styles.rowRight}>
                                {done ? <div className={styles.badgeChecked}>Gebucht</div> : null}
                                {on ? <div className={styles.badge}>Ausgewählt</div> : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <div className={styles.footerRow}>
                        <button
                          className={styles.primary}
                          onClick={next}
                          type="button"
                          disabled={!selectedParticipantKey || !!doneMap[selectedParticipantKey]}
                          title={doneMap[selectedParticipantKey] ? "Diese Person ist bereits gebucht." : ""}
                        >
                          Weiter
                        </button>
                      </div>

                      {allDone ? (
                        <div className={styles.note} style={{ marginTop: 12 }}>
                          Gruppe ist vollständig eingecheckt. Du kannst jetzt eine neue Gruppe auswählen.
                        </div>
                      ) : (
                        <div className={styles.note} style={{ marginTop: 12 }}>
                          Ablauf: Person auswählen → im Kiosk buchen → „Send & Check-in starten“. Wiederholen bis alle erledigt sind.
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Step 2 */}
        {profile && (
          <div className={styles.embed}>
            <KioskOrderEmbed profile={profile} onDone={onCheckInDone} />
          </div>
        )}

        {/* Overlay: Check-ins heute */}
        {openToday && (
          <div className={styles.overlay} role="dialog" aria-modal="true">
            <div className={styles.overlayCard}>
              <div className={styles.overlayHead}>
                <div>
                  <div className={styles.overlayTitle}>Check-ins heute</div>
                  <div className={styles.overlaySub}>Kunde · Bestellung · Liveboard</div>
                </div>
                <button
                  className={styles.back}
                  type="button"
                  onClick={() => {
                    setOpenToday(false);
                    setSelectedVisit(null);
                    setSelectedVisitFull(null);
                    setDetailTab("order");
                  }}
                >
                  Schließen
                </button>
              </div>

              <div className={styles.overlayBody}>
                <div className={styles.overlayLeft}>
                  <div className={styles.list}>
                    {todayList.length === 0 ? (
                      <div className={styles.emptyInline}>Keine Check-ins gefunden.</div>
                    ) : (
                      todayList.map((x) => (
                        <button
                          key={x.id || `${x.displayName}-${x.customerId}`}
                          type="button"
                          className={`${styles.row} ${selectedVisit?.id === x.raw?.id ? styles.rowOn : ""}`}
                          onClick={() => openVisitDetails(x)}
                        >
                          <div>
                            <div className={styles.rowTitle}>{x.displayName}</div>
                            <div className={styles.rowMeta}>
                              {x.customerId ? `Kunde: ${x.customerId}` : "Gast"} · Visit: {String(x.id || "—")}
                            </div>
                          </div>
                          <div className={styles.rowRight}>
                            <div className={styles.badge}>Öffnen</div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className={styles.overlayRight}>
                  {!selectedVisit ? (
                    <div className={styles.emptyInline}>Wähle links einen Check-in, um Details zu sehen.</div>
                  ) : !selectedVisitFull ? (
                    <div className={styles.emptyInline}>Details werden geladen…</div>
                  ) : (
                    <div className={styles.detailCard}>
                      {/* Browser Tabs */}
                      <div className={styles.browserTabs}>
                        <button
                          type="button"
                          className={`${styles.browserTab} ${detailTab === "customer" ? styles.browserTabOn : ""}`}
                          onClick={() => setDetailTab("customer")}
                        >
                          Kunde
                        </button>
                        <button
                          type="button"
                          className={`${styles.browserTab} ${detailTab === "order" ? styles.browserTabOn : ""}`}
                          onClick={() => setDetailTab("order")}
                        >
                          Bestellung
                        </button>
                        <button
                          type="button"
                          className={`${styles.browserTab} ${detailTab === "live" ? styles.browserTabOn : ""}`}
                          onClick={() => setDetailTab("live")}
                        >
                          Liveboard
                        </button>
                      </div>

                      <div className={styles.browserPanel}>
                        {detailTab === "customer" ? (
                          <>
                            <div className={styles.detailTitle}>Kundendaten</div>
                            <div className={styles.detailList}>
                              <div className={styles.detailRow}>
                                <div className={styles.detailName}>Name</div>
                                <div className={styles.detailPrice}>{selectedVisitFull.visit?.displayName || "—"}</div>
                              </div>
                              <div className={styles.detailRow}>
                                <div className={styles.detailName}>Kunde-ID</div>
                                <div className={styles.detailPrice}>{selectedVisitFull.visit?.customerId || "Gast"}</div>
                              </div>
                              <div className={styles.detailRow}>
                                <div className={styles.detailName}>Status</div>
                                <div className={styles.detailPrice}>{String(selectedVisitFull.visit?.status || "open")}</div>
                              </div>
                            </div>
                          </>
                        ) : null}

                        {detailTab === "order" ? (
                          <>
                            <div className={styles.detailTitle}>Leistungen</div>
                            {selectedVisitFull.serviceLines.length === 0 ? (
                              <div className={styles.detailMuted}>Keine Services gefunden.</div>
                            ) : (
                              <div className={styles.detailList}>
                                {selectedVisitFull.serviceLines.map((s) => (
                                  <div key={s.id} className={styles.detailRow}>
                                    <div className={styles.detailName}>
                                      {s.title}
                                      {s.staffName ? <span className={styles.detailQty}> · {s.staffName}</span> : null}
                                    </div>
                                    <div className={styles.detailPrice}>{money(s.price)} €</div>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className={styles.detailTitle} style={{ marginTop: 14 }}>
                              Produkte
                            </div>
                            {selectedVisitFull.productLines.length === 0 ? (
                              <div className={styles.detailMuted}>Keine Produkte gefunden.</div>
                            ) : (
                              <div className={styles.detailList}>
                                {selectedVisitFull.productLines.map((p) => (
                                  <div key={p.id} className={styles.detailRow}>
                                    <div className={styles.detailName}>
                                      {p.title} <span className={styles.detailQty}>x{p.qty}</span>
                                      {p.staffName ? <span className={styles.detailQty}> · {p.staffName}</span> : null}
                                    </div>
                                    <div className={styles.detailPrice}>{money(p.price * p.qty)} €</div>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className={styles.detailTotal}>
                              <div>Summe</div>
                              <div>{money(selectedVisitFull.total)} €</div>
                            </div>
                          </>
                        ) : null}

                        {detailTab === "live" ? (
                          <>
                            <div className={styles.detailTitle}>Live-Status je Bereich</div>
                            {selectedVisitFull.liveboard.length === 0 ? (
                              <div className={styles.detailMuted}>Kein Bereichsstatus gefunden.</div>
                            ) : (
                              <div className={styles.detailList}>
                                {selectedVisitFull.liveboard.map((st) => (
                                  <div key={st.id} className={styles.detailRow}>
                                    <div className={styles.detailName}>
                                      Bereich: {st.areaId} · {String(st.status)}
                                      {st.assignedStaffName ? (
                                        <span className={styles.detailQty}> · {st.assignedStaffName}</span>
                                      ) : null}
                                    </div>
                                    <div className={styles.detailPrice}>
                                      {st.sinceMs ? `seit ${msToHhMm(st.sinceMs)}` : st.startedAt ? "—" : "noch nicht gestartet"}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className={styles.detailHint}>
                              Tipp: Status kommt aus <b>visit_area_state</b>. Wenn du Status-Namen standardisieren willst
                              (waiting/active/checkout/done), sag mir deine finalen Werte – dann mappe ich Labels/Badges exakt.
                            </div>
                          </>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* tick is used to re-render timers */}
              <div style={{ display: "none" }}>{tick}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
