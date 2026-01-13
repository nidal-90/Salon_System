// src/features/reception/pages/ReceptionCheckInPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../db/index.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";
import { nextGuestDisplayName } from "../../../services/guest/guestCounter.js";
import KioskOrderEmbed from "../../kiosk/pages/KioskOrderEmbed.jsx";
import styles from "./ReceptionCheckInPage.module.css";

function safeName(c) {
  const a = String(c.firstName || "").trim();
  const b = String(c.lastName || "").trim();
  const full = `${a} ${b}`.trim();
  return full || "Unbekannt";
}

function money(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? x.toFixed(2) : "0.00";
}

// Dexie helper: table exists?
function hasTable(name) {
  try {
    return (db?.tables || []).some((t) => t?.name === name);
  } catch {
    return false;
  }
}

export default function ReceptionCheckInPage() {
  const nav = useNavigate();

  const [customers, setCustomers] = useState([]);
  const [areasCount, setAreasCount] = useState(0);

  const [mode, setMode] = useState("customer"); // customer|group|guest
  const [query, setQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

  // groups (existing list)
  const [groups, setGroups] = useState([]);
  const [groupQuery, setGroupQuery] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");

  // group create/edit state
  const [groupName, setGroupName] = useState("Gruppe");
  const [paymentMode, setPaymentMode] = useState("single"); // single|split
  const [groupMembers, setGroupMembers] = useState([{ customerId: "", displayName: "", phone: "" }]);

  // today visits / checkins
  const [todayVisits, setTodayVisits] = useState([]); // rows from db.visits
  const [todayCount, setTodayCount] = useState(0);
  const checkedCustomerIds = useMemo(() => {
    const s = new Set();
    for (const v of todayVisits) {
      const cid = v?.customerId || v?.customer?.id || v?.profile?.customerId;
      if (cid) s.add(String(cid));
    }
    return s;
  }, [todayVisits]);

  // UX overlays
  const [toast, setToast] = useState(""); // “Kunde erfolgreich eingecheckt”
  const [openToday, setOpenToday] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState(null);

  // step2: embed order
  const [profile, setProfile] = useState(null);

  async function reloadBase() {
    const [c, a] = await Promise.all([db.customers.toArray(), db.areas.count()]);
    c.sort((x, y) => safeName(x).localeCompare(safeName(y)));
    setCustomers(c);
    setAreasCount(a);

    const dateKey = toDateKeyISO(new Date());
    const list = await db.visits.where("dateKey").equals(dateKey).toArray();
    // sort newest first if createdAt exists
    list.sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || "")));
    setTodayVisits(list);
    setTodayCount(list.length);

    // load groups if table exists
    const groupTables = ["groups", "group_profiles", "customer_groups"];
    const tableName = groupTables.find(hasTable);
    if (tableName) {
      try {
        const g = await db[tableName].toArray();
        g.sort((x, y) => String(x.name || "").localeCompare(String(y.name || "")));
        setGroups(g);
      } catch {
        setGroups([]);
      }
    } else {
      setGroups([]);
    }
  }

  useEffect(() => {
    reloadBase();
  }, []);

  const filteredCustomers = useMemo(() => {
    const qx = query.trim().toLowerCase();
    if (!qx) return customers;
    return customers.filter((c) => {
      const n = safeName(c).toLowerCase();
      const p = String(c.phone || "").toLowerCase();
      const e = String(c.email || "").toLowerCase();
      return n.includes(qx) || p.includes(qx) || e.includes(qx);
    });
  }, [customers, query]);

  const selectedCustomer = useMemo(() => {
    return customers.find((c) => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  const filteredGroups = useMemo(() => {
    const qx = groupQuery.trim().toLowerCase();
    if (!qx) return groups;
    return groups.filter((g) => {
      const n = String(g.name || g.displayName || "").toLowerCase();
      const meta = JSON.stringify(g || {}).toLowerCase();
      return n.includes(qx) || meta.includes(qx);
    });
  }, [groups, groupQuery]);

  function resetStep2() {
    setProfile(null);
  }

  // group form helpers
  function setMember(i, patch) {
    setGroupMembers((p) => p.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
    resetStep2();
  }
  function addMember() {
    setGroupMembers((p) => [...p, { customerId: "", displayName: "", phone: "" }]);
    resetStep2();
  }
  function removeMember(i) {
    setGroupMembers((p) => p.filter((_, idx) => idx !== i));
    resetStep2();
  }

  // load selected group into form (if schema supports)
  useEffect(() => {
    if (!selectedGroupId) return;
    const g = groups.find((x) => String(x.id) === String(selectedGroupId));
    if (!g) return;

    setGroupName(String(g.name || g.displayName || "Gruppe"));
    setPaymentMode(String(g.paymentMode || "single"));

    // members can be stored in many ways -> handle robustly
    let members = g.members || g.people || g.customers || [];
    if (typeof members === "string") {
      try { members = JSON.parse(members); } catch { members = []; }
    }
    if (!Array.isArray(members)) members = [];

    const normalized = members.map((m) => ({
      customerId: m.customerId ? String(m.customerId) : "",
      displayName: String(m.displayName || m.name || "").trim(),
      phone: String(m.phone || "").trim(),
    }));

    setGroupMembers(normalized.length ? normalized : [{ customerId: "", displayName: "", phone: "" }]);
    resetStep2();
  }, [selectedGroupId, groups]);

  function showToast(msg) {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(""), 2200);
  }

  // called when kiosk finishes check-in
  async function onCheckInDone() {
    showToast("Kunde erfolgreich eingecheckt.");
    // reset UI to step1
    setProfile(null);
    setSelectedCustomerId("");
    setSelectedGroupId("");
    setGroupName("Gruppe");
    setPaymentMode("single");
    setGroupMembers([{ customerId: "", displayName: "", phone: "" }]);
    setMode("customer");

    await reloadBase();
  }

  // open kiosk
  async function next() {
    if (mode === "customer") {
      if (!selectedCustomer) return;

      setProfile({
        mode: "existing",
        customerId: selectedCustomer.id,
        displayName: safeName(selectedCustomer),
        customer: { phone: selectedCustomer.phone || "" },
      });
      return;
    }

    if (mode === "guest") {
      const name = await nextGuestDisplayName("Gast");
      setProfile({
        mode: "guest",
        customerId: null,
        displayName: name,
        customer: { phone: "" },
      });
      return;
    }

    // group: if user selected existing group -> use that; else build cleaned from form
    const cleaned = groupMembers
      .map((m) => {
        const c = m.customerId ? customers.find((x) => x.id === m.customerId) : null;
        const dn = String(m.displayName || "").trim() || (c ? safeName(c) : "");
        const ph = String(m.phone || "").trim() || (c ? String(c.phone || "") : "");
        return {
          customerId: m.customerId ? String(m.customerId) : null,
          displayName: dn,
          phone: ph,
        };
      })
      .filter((x) => (x.displayName || "").trim().length >= 2);

    if (cleaned.length === 0) return;

    setProfile({
      mode: "group",
      displayName: String(groupName || "Gruppe").trim(),
      group: {
        paymentMode,
        members: cleaned,
      },
    });
  }

  // “Check-ins heute” modal: prepare a display list
  const todayList = useMemo(() => {
    return todayVisits.map((v) => {
      const cid = v?.customerId || v?.customer?.id || v?.profile?.customerId || "";
      const dn = v?.displayName || v?.customerName || v?.profile?.displayName || (cid ? `Kunde ${cid}` : "Gast/Gruppe");
      return { id: v?.id, customerId: cid ? String(cid) : "", displayName: String(dn || "—"), raw: v };
    });
  }, [todayVisits]);

  function openVisitDetails(v) {
    setSelectedVisit(v?.raw || null);
  }

  // details parsing (robust)
  const visitDetails = useMemo(() => {
    const v = selectedVisit;
    if (!v) return null;

    // services can be: services[], selectedServices[], items[] with type
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

    const total =
      Number(v.total || v.sum || v.amount || 0) ||
      (serviceSum + productSum);

    return { serviceLines, productLines, total };
  }, [selectedVisit]);

  return (
    <div className={styles.wrap}>
      <div className={styles.shell}>
        <div className={styles.head}>
          <div>
            <div className={styles.title}>Reception · Check-in</div>
            <div className={styles.sub}>
              Kunde auswählen, Gruppe anlegen oder Gast-Check-in (Gast-Nr. zählt automatisch hoch).
            </div>
          </div>

          <button className={styles.back} onClick={() => nav("/reception")} type="button">
            Zurück
          </button>
        </div>

        {/* Toast */}
        {toast ? <div className={styles.toast}>{toast}</div> : null}

        {/* KPI Row */}
        <div className={styles.kpiRow}>
          <button className={`${styles.kpi} ${styles.kpiBtn}`} type="button" onClick={() => { setOpenToday(true); setSelectedVisit(null); }}>
            <div className={styles.kpiLabel}>Check-ins heute</div>
            <div className={styles.kpiVal}>{todayCount}</div>
            <div className={styles.kpiMeta}>Visits (dateKey)</div>
          </button>

          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Kunden</div>
            <div className={styles.kpiVal}>{customers.length}</div>
            <div className={styles.kpiMeta}>Profile</div>
          </div>

          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Bereiche</div>
            <div className={styles.kpiVal}>{areasCount}</div>
            <div className={styles.kpiMeta}>Zonen / Klassen</div>
          </div>

          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Modus</div>
            <div className={styles.kpiVal}>{mode === "customer" ? "Kunde" : mode === "guest" ? "Gast" : "Gruppe"}</div>
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
                onClick={() => { setMode("customer"); resetStep2(); }}
                type="button"
              >
                Kunde
              </button>
              <button
                className={`${styles.pill} ${mode === "group" ? styles.pillOn : ""}`}
                onClick={() => { setMode("group"); resetStep2(); }}
                type="button"
              >
                Gruppe
              </button>
              <button
                className={`${styles.pill} ${mode === "guest" ? styles.pillOn : ""}`}
                onClick={() => { setMode("guest"); resetStep2(); }}
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
                  onChange={(e) => { setQuery(e.target.value); resetStep2(); }}
                  placeholder="Suche: Name / Telefon / E-Mail"
                />
              </div>

              <div className={styles.list}>
                {filteredCustomers.map((c) => {
                  const on = c.id === selectedCustomerId;
                  const isChecked = checkedCustomerIds.has(String(c.id));

                  return (
                    <button
                      key={c.id}
                      className={`${styles.row} ${on ? styles.rowOn : ""} ${isChecked ? styles.rowChecked : ""}`}
                      onClick={() => { setSelectedCustomerId(c.id); resetStep2(); }}
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
              {/* Existing groups list */}
              <div className={styles.groupSplit}>
                <div className={styles.groupListBox}>
                  <div className={styles.groupListHead}>
                    <div className={styles.bold}>Vorhandene Gruppen</div>
                    <button
                      type="button"
                      className={styles.ghost}
                      onClick={() => { setSelectedGroupId(""); setGroupQuery(""); }}
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
                      <div className={styles.emptyInline}>
                        Keine Gruppen gefunden (oder keine Gruppen-Tabelle im DB-Schema).
                      </div>
                    ) : (
                      filteredGroups.map((g) => {
                        const on = String(g.id) === String(selectedGroupId);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            className={`${styles.row} ${on ? styles.rowOn : ""}`}
                            onClick={() => setSelectedGroupId(String(g.id))}
                          >
                            <div>
                              <div className={styles.rowTitle}>{String(g.name || g.displayName || "Gruppe")}</div>
                              <div className={styles.rowMeta}>
                                Zahlungsart: {String(g.paymentMode || "single") === "split" ? "Separat" : "Zusammen"}
                              </div>
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

                {/* Create/edit group */}
                <div className={styles.groupFormBox}>
                  <div className={styles.groupGrid}>
                    <label className={styles.field}>
                      <span>Gruppenname</span>
                      <input
                        className={styles.input}
                        value={groupName}
                        onChange={(e) => { setGroupName(e.target.value); resetStep2(); }}
                        placeholder="z. B. Hochzeit Anna"
                      />
                    </label>

                    <div className={styles.payRow}>
                      <button
                        className={`${styles.pill} ${paymentMode === "single" ? styles.pillOn : ""}`}
                        onClick={() => { setPaymentMode("single"); resetStep2(); }}
                        type="button"
                      >
                        Zusammen zahlen
                      </button>
                      <button
                        className={`${styles.pill} ${paymentMode === "split" ? styles.pillOn : ""}`}
                        onClick={() => { setPaymentMode("split"); resetStep2(); }}
                        type="button"
                      >
                        Separat zahlen
                      </button>
                    </div>
                  </div>

                  <div className={styles.members}>
                    <div className={styles.membersHead}>
                      <div className={styles.bold}>Mitglieder</div>
                      <button className={styles.add} onClick={addMember} type="button">
                        + Mitglied
                      </button>
                    </div>

                    {groupMembers.map((m, i) => (
                      <div key={i} className={styles.memberRow}>
                        <select
                          className={styles.select}
                          value={m.customerId}
                          onChange={(e) => setMember(i, { customerId: e.target.value })}
                        >
                          <option value="">Kunde wählen (optional)</option>
                          {customers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {safeName(c)}
                            </option>
                          ))}
                        </select>

                        <input
                          className={styles.input}
                          value={m.displayName}
                          onChange={(e) => setMember(i, { displayName: e.target.value })}
                          placeholder="Name (wenn kein Kunde gewählt)"
                        />

                        <input
                          className={styles.input}
                          value={m.phone}
                          onChange={(e) => setMember(i, { phone: e.target.value })}
                          placeholder="Telefon (optional)"
                        />

                        {i > 0 && (
                          <button className={styles.remove} onClick={() => removeMember(i)} type="button">
                            Entfernen
                          </button>
                        )}
                      </div>
                    ))}

                    <div className={styles.footerRow}>
                      <button className={styles.primary} onClick={next} type="button">
                        Weiter
                      </button>
                    </div>
                  </div>
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
                <button className={styles.back} type="button" onClick={() => { setOpenToday(false); setSelectedVisit(null); }}>
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
                            <div className={styles.rowMeta}>{x.customerId ? `Kunde: ${x.customerId}` : "Gast/Gruppe"}</div>
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

                      <div className={styles.detailTitle} style={{ marginTop: 14 }}>Produkte</div>
                      {visitDetails.productLines.length === 0 ? (
                        <div className={styles.detailMuted}>Keine Produkte gefunden.</div>
                      ) : (
                        <div className={styles.detailList}>
                          {visitDetails.productLines.map((p, i) => (
                            <div key={i} className={styles.detailRow}>
                              <div className={styles.detailName}>{p.title} <span className={styles.detailQty}>x{p.qty}</span></div>
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
