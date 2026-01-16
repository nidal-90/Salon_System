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

export default function ReceptionCheckInPage() {
  const nav = useNavigate();

  const [customers, setCustomers] = useState([]);
  const [areasCount, setAreasCount] = useState(0);

  const [mode, setMode] = useState("customer"); // customer|group|guest
  const [query, setQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

  // groups (stored in db.customers with kind==="group" or c.group)
  const [groups, setGroups] = useState([]);
  const [groupQuery, setGroupQuery] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");

  // group participants flow
  const [selectedParticipantKey, setSelectedParticipantKey] = useState("");
  const [doneMap, setDoneMap] = useState({}); // { [participantKey]: true }

  // today visits / checkins
  const [todayVisits, setTodayVisits] = useState([]);
  const [todayCount, setTodayCount] = useState(0);

  // derived set of checked customers for badges in customer list
  const checkedCustomerIds = useMemo(() => {
    const s = new Set();
    for (const v of todayVisits) {
      const cid = v?.customerId || v?.customer?.id || v?.profile?.customerId;
      if (cid) s.add(String(cid));
    }
    return s;
  }, [todayVisits]);

  // UX overlays
  const [toast, setToast] = useState("");
  const [openToday, setOpenToday] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState(null);

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

    // IMPORTANT: groups are part of customers table (kind==="group" or has c.group)
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

  /** ---------- Customers search ---------- */
  const filteredCustomers = useMemo(() => {
    const qx = query.trim().toLowerCase();
    if (!qx) return customers.filter((x) => String(x?.kind || "") !== "group" && !x?.group);
    return customers
      .filter((x) => String(x?.kind || "") !== "group" && !x?.group)
      .filter((c) => {
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
      customerId: String(selectedGroup.id), // NOTE: group row id (still stored in customers)
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

  // When switching modes, clean up state safely
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

  // When group changes: reset participant selection and done map
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

      setProfile({
        mode: "existing",
        customerId: selectedCustomer.id,
        displayName: safeName(selectedCustomer),
        customer: { phone: String(selectedCustomer.phone || "") },
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
      });
      setActiveParticipantKey("");
      return;
    }

    // GROUP (participant-by-participant)
    if (mode === "group") {
      if (!selectedGroup) return;
      if (!selectedParticipantKey) return;

      const p = participants.find((x) => x.key === selectedParticipantKey);
      if (!p) return;

      // Build a clean profile for Kiosk:
      // - if participant is linked to a real customer profile -> existing
      // - else -> guest (named person)
      const title = groupTitle(selectedGroup);
      const display = `${title} · ${p.displayName}`.trim();

      if (p.customerId && p.kind === "member") {
        // member profile exists
        setProfile({
          mode: "existing",
          customerId: p.customerId,
          displayName: display,
          customer: { phone: String(p.phone || "") },
          meta: { groupId: String(selectedGroup.id), groupTitle: title, paymentMode: groupPaymentMode, participantKey: p.key },
        });
      } else {
        // contact OR member without customer profile
        setProfile({
          mode: "guest",
          customerId: null,
          displayName: display,
          customer: { phone: String(p.phone || "") },
          meta: { groupId: String(selectedGroup.id), groupTitle: title, paymentMode: groupPaymentMode, participantKey: p.key },
        });
      }

      setActiveParticipantKey(p.key);
      return;
    }
  }

  /** ---------- Called when kiosk finishes check-in ---------- */
  async function onCheckInDone() {
    // If this is a group participant flow: mark participant done and continue
    if (mode === "group" && selectedGroup && activeParticipantKey) {
      const p = participants.find((x) => x.key === activeParticipantKey);
      const name = p?.displayName || "Person";
      showToast(`${name} eingecheckt.`);

      setDoneMap((prev) => ({ ...prev, [activeParticipantKey]: true }));
      resetStep2();

      await reloadBase();

      // auto-advance to next pending participant
      const nextPending = participants.find((x) => !doneMap[x.key] && x.key !== activeParticipantKey);
      // note: doneMap update is async; compute pending using a safe fallback:
      const pending = participants.filter((x) => !doneMap[x.key] && x.key !== activeParticipantKey);
      const choose = pending[0] || null;
      if (choose) {
        setSelectedParticipantKey(choose.key);
      }

      // finalize group if all done (after marking current)
      const allWillBeDone =
        participants.length > 0 &&
        participants.every((x) => x.key === activeParticipantKey ? true : !!doneMap[x.key]);

      if (allWillBeDone) {
        showToast("Gruppe vollständig eingecheckt.");
        resetGroupFlow();
      }

      return;
    }

    // Default (customer/guest) behavior: reset whole UI
    showToast("Kunde erfolgreich eingecheckt.");

    setProfile(null);
    setSelectedCustomerId("");
    setSelectedGroupId("");
    setGroupQuery("");
    setSelectedParticipantKey("");
    setDoneMap({});
    setMode("customer");

    await reloadBase();
  }

  /** ---------- “Check-ins heute” modal: prepare list ---------- */
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

  function openVisitDetails(v) {
    setSelectedVisit(v?.raw || null);
  }

  /** ---------- Details parsing (robust) ---------- */
  const visitDetails = useMemo(() => {
    const v = selectedVisit;
    if (!v) return null;

    const services =
      v.services ||
      v.selectedServices ||
      (Array.isArray(v.items) ? v.items.filter((x) => x.type === "service") : []) ||
      [];

    const products =
      v.products ||
      (Array.isArray(v.items) ? v.items.filter((x) => x.type === "product") : []) ||
      [];

    const serviceLines = (Array.isArray(services) ? services : []).map((s) => ({
      title: s.title || s.name || "Service",
      price: Number(s.price || s.amount || 0),
    }));

    const productLines = (Array.isArray(products) ? products : []).map((p) => ({
      title: p.title || p.name || "Produkt",
      qty: Number(p.qty || 1),
      price: Number(p.price || p.amount || 0),
    }));

    const serviceSum = serviceLines.reduce((a, x) => a + (Number.isFinite(x.price) ? x.price : 0), 0);
    const productSum = productLines.reduce((a, x) => a + (Number.isFinite(x.price) ? x.price : 0) * (x.qty || 1), 0);

    const total = Number(v.total || v.sum || v.amount || 0) || (serviceSum + productSum);

    return { serviceLines, productLines, total };
  }, [selectedVisit]);

  /** ---------- UI ---------- */
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
                  const isChecked = checkedCustomerIds.has(String(c.id));

                  return (
                    <button
                      key={c.id}
                      className={`${styles.row} ${on ? styles.rowOn : ""} ${isChecked ? styles.rowChecked : ""}`}
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
                        {isChecked ? <div className={styles.badgeChecked}>Eingecheckt</div> : null}
                        <div className={styles.badge}>{on ? "Ausgewählt" : "Wählen"}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className={styles.footerRow}>
                <button className={styles.primary} onClick={next} disabled={!selectedCustomerId} type="button">
                  Weiter
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
                {/* Existing groups list */}
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
                            onClick={() => setSelectedGroupId(String(g.id))}
                          >
                            <div>
                              <div className={styles.rowTitle}>{groupTitle(g)}</div>
                              <div className={styles.rowMeta}>Zahlungsart: {pm}{tel}</div>
                            </div>
                            <div className={styles.rowRight}>
                              <div className={styles.badge}>{on ? "Ausgewählt" : "Wählen"}</div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Participants */}
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
                        {allDone ? <div className={styles.badgeChecked}>Fertig</div> : <div className={styles.badge}>Offen</div>}
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
                                {done ? <div className={styles.badgeChecked}>Gebucht</div> : <div className={styles.badge}>Wählen</div>}
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
                  <div className={styles.overlaySub}>Liste & Details (Services/Produkte/Summe)</div>
                </div>
                <button
                  className={styles.back}
                  type="button"
                  onClick={() => {
                    setOpenToday(false);
                    setSelectedVisit(null);
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
                            <div className={styles.rowMeta}>{x.customerId ? `Kunde: ${x.customerId}` : "Gast"}</div>
                          </div>
                          <div className={styles.rowRight}>
                            <div className={styles.badge}>Details</div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className={styles.overlayRight}>
                  {!visitDetails ? (
                    <div className={styles.emptyInline}>Wähle links einen Check-in, um Details zu sehen.</div>
                  ) : (
                    <div className={styles.detailCard}>
                      <div className={styles.detailTitle}>Leistungen</div>
                      {visitDetails.serviceLines.length === 0 ? (
                        <div className={styles.detailMuted}>Keine Services gefunden.</div>
                      ) : (
                        <div className={styles.detailList}>
                          {visitDetails.serviceLines.map((s, i) => (
                            <div key={i} className={styles.detailRow}>
                              <div className={styles.detailName}>{s.title}</div>
                              <div className={styles.detailPrice}>{money(s.price)} €</div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className={styles.detailTitle} style={{ marginTop: 14 }}>
                        Produkte
                      </div>
                      {visitDetails.productLines.length === 0 ? (
                        <div className={styles.detailMuted}>Keine Produkte gefunden.</div>
                      ) : (
                        <div className={styles.detailList}>
                          {visitDetails.productLines.map((p, i) => (
                            <div key={i} className={styles.detailRow}>
                              <div className={styles.detailName}>
                                {p.title} <span className={styles.detailQty}>x{p.qty}</span>
                              </div>
                              <div className={styles.detailPrice}>{money(p.price * p.qty)} €</div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className={styles.detailTotal}>
                        <div>Summe</div>
                        <div>{money(visitDetails.total)} €</div>
                      </div>

                      <div className={styles.detailHint}>
                        Hinweis: Details werden aus dem Visit-Datensatz gelesen. Falls dein Visit-Schema andere Feldnamen nutzt,
                        sag mir die Visit-Struktur (Beispielobjekt), dann mappe ich es exakt.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
