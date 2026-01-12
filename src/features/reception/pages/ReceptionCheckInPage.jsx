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

export default function ReceptionCheckInPage() {
  const nav = useNavigate();

  const [customers, setCustomers] = useState([]);
  const [areasCount, setAreasCount] = useState(0);
  const [todayVisits, setTodayVisits] = useState(0);

  const [mode, setMode] = useState("customer"); // customer|group|guest
  const [query, setQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

  // group state
  const [groupName, setGroupName] = useState("Gruppe");
  const [paymentMode, setPaymentMode] = useState("single"); // single|split
  const [groupMembers, setGroupMembers] = useState([{ customerId: "", displayName: "", phone: "" }]);

  // step2: embed order
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    (async () => {
      const [c, a] = await Promise.all([db.customers.toArray(), db.areas.count()]);
      c.sort((x, y) => safeName(x).localeCompare(safeName(y)));
      setCustomers(c);
      setAreasCount(a);

      const dateKey = toDateKeyISO(new Date());
      const v = await db.visits.where("dateKey").equals(dateKey).count();
      setTodayVisits(v);
    })();
  }, []);

  const filteredCustomers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const n = safeName(c).toLowerCase();
      const p = String(c.phone || "").toLowerCase();
      const e = String(c.email || "").toLowerCase();
      return n.includes(q) || p.includes(q) || e.includes(q);
    });
  }, [customers, query]);

  const selectedCustomer = useMemo(() => {
    return customers.find((c) => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  function resetStep2() {
    setProfile(null);
  }

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

  async function next() {
    // Step1 -> create profile object for KioskOrderEmbed
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

    // group
    const cleaned = groupMembers
      .map((m) => {
        const c = m.customerId ? customers.find((x) => x.id === m.customerId) : null;
        const dn =
          String(m.displayName || "").trim() ||
          (c ? safeName(c) : "");
        const ph =
          String(m.phone || "").trim() ||
          (c ? String(c.phone || "") : "");
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

        {/* KPI Row */}
        <div className={styles.kpiRow}>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Check-ins heute</div>
            <div className={styles.kpiVal}>{todayVisits}</div>
            <div className={styles.kpiMeta}>Visits (dateKey)</div>
          </div>

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
                onClick={() => {
                  setMode("customer");
                  resetStep2();
                }}
                type="button"
              >
                Kunde
              </button>
              <button
                className={`${styles.pill} ${mode === "group" ? styles.pillOn : ""}`}
                onClick={() => {
                  setMode("group");
                  resetStep2();
                }}
                type="button"
              >
                Gruppe
              </button>
              <button
                className={`${styles.pill} ${mode === "guest" ? styles.pillOn : ""}`}
                onClick={() => {
                  setMode("guest");
                  resetStep2();
                }}
                type="button"
              >
                Gast
              </button>
            </div>
          </div>

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
                  const on = c.id === selectedCustomerId;
                  return (
                    <button
                      key={c.id}
                      className={`${styles.row} ${on ? styles.rowOn : ""}`}
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
                        <div className={styles.badge}>{on ? "Ausgewählt" : "Wählen"}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className={styles.footerRow}>
                <button
                  className={styles.primary}
                  onClick={next}
                  disabled={!selectedCustomerId}
                  type="button"
                >
                  Weiter
                </button>
              </div>
            </div>
          )}

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

          {mode === "group" && (
            <div className={styles.step}>
              <div className={styles.groupGrid}>
                <label className={styles.field}>
                  <span>Gruppenname</span>
                  <input
                    className={styles.input}
                    value={groupName}
                    onChange={(e) => {
                      setGroupName(e.target.value);
                      resetStep2();
                    }}
                    placeholder="z. B. Hochzeit Anna"
                  />
                </label>

                <div className={styles.payRow}>
                  <button
                    className={`${styles.pill} ${paymentMode === "single" ? styles.pillOn : ""}`}
                    onClick={() => {
                      setPaymentMode("single");
                      resetStep2();
                    }}
                    type="button"
                  >
                    Zusammen zahlen
                  </button>
                  <button
                    className={`${styles.pill} ${paymentMode === "split" ? styles.pillOn : ""}`}
                    onClick={() => {
                      setPaymentMode("split");
                      resetStep2();
                    }}
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
          )}
        </div>

        {/* Step 2: embedded KioskOrder */}
        {profile && (
          <div className={styles.embed}>
            <KioskOrderEmbed
              profile={profile}
              onDone={() => {
                // nach erfolgreichem Check-in: zurück zur Reception Home
                nav("/reception");
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
