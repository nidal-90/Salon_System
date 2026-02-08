//src/features/reception/pages/receptionDashboardPage.jsx

import { useEffect, useMemo, useState } from "react";
import styles from "./receptionDashboardPage.module.css";

// kleine Helper
function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDur(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function safeStr(x) {
  return String(x ?? "").trim();
}

/**
 * visitVM = "ViewModel" aus Liveboard:
 * {
 *   visitId, title, // Kunde/Gruppe
 *   status, // "waiting" | "active" | "checkout" etc.
 *   areaName,
 *   wishServiceTitle,
 *   preferredStaffName,
 *   assignedStaffName,
 *   checkInAt, // ISO
 *   waitingSince, // ISO
 *   activeSince, // ISO
 *   products: [{title, qty, price}], services: [{title, price}], note,
 * }
 */
export default function VisitCardModal({
  open,
  onClose,
  onConfirm,        // Klick "Übernehmen"/"Weiter"
  confirmLabel,     // z.B. "Übernehmen", "In Behandlung", "Zu Kasse"
  visitVM,
  staffOptions,     // [{id,name}] für Zuweisung
  staffValue,
  onStaffChange,
  busy,
}) {
  const [tab, setTab] = useState("overview"); // overview | timeline | items

  useEffect(() => {
    if (open) setTab("overview");
  }, [open]);

  const nowTick = useNowTick(open); // live timer nur wenn modal offen

  const derived = useMemo(() => {
    const w = visitVM?.waitingSince ? new Date(visitVM.waitingSince).getTime() : null;
    const a = visitVM?.activeSince ? new Date(visitVM.activeSince).getTime() : null;

    return {
      waitingMs: w ? Math.max(0, nowTick - w) : null,
      activeMs: a ? Math.max(0, nowTick - a) : null,
      hasProducts: (visitVM?.products || []).length > 0,
      hasServices: (visitVM?.services || []).length > 0,
    };
  }, [visitVM, nowTick]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className={styles.sheet} onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.head}>
          <div className={styles.headLeft}>
            <div className={styles.kicker}>{labelStatus(visitVM?.status)}</div>
            <div className={styles.title}>{safeStr(visitVM?.title) || "—"}</div>
            <div className={styles.subline}>
              <span className={styles.pill}>{safeStr(visitVM?.areaName) || "—"}</span>
              <span className={styles.dot}>•</span>
              <span className={styles.muted}>Check-in: {fmtTime(visitVM?.checkInAt)}</span>
            </div>
          </div>

          <button className={styles.x} type="button" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          <Tab label="Übersicht" on={tab === "overview"} onClick={() => setTab("overview")} />
          <Tab label="Status & Zeiten" on={tab === "timeline"} onClick={() => setTab("timeline")} />
          <Tab label="Leistungen" on={tab === "items"} onClick={() => setTab("items")} />
          <div className={styles.rail} />
        </div>

        {/* Content */}
        <div className={styles.body}>
          {tab === "overview" && (
            <div className={styles.grid}>
              <InfoCard label="Behandlung (Wunsch)" value={safeStr(visitVM?.wishServiceTitle) || "—"} />
              <InfoCard label="Wunsch-Mitarbeiter" value={safeStr(visitVM?.preferredStaffName) || "—"} />
              <InfoCard label="Zugewiesen" value={safeStr(visitVM?.assignedStaffName) || "—"} />
              <InfoCard label="Notiz" value={safeStr(visitVM?.note) || "—"} wide />
            </div>
          )}

          {tab === "timeline" && (
            <div className={styles.timeline}>
              <div className={styles.bigTimers}>
                <TimerCard
                  label="Wartezeit"
                  value={derived.waitingMs != null ? fmtDur(derived.waitingMs) : "—"}
                  hint={visitVM?.waitingSince ? `seit ${fmtTime(visitVM.waitingSince)}` : "—"}
                />
                <TimerCard
                  label="In Behandlung"
                  value={derived.activeMs != null ? fmtDur(derived.activeMs) : "—"}
                  hint={visitVM?.activeSince ? `seit ${fmtTime(visitVM.activeSince)}` : "—"}
                />
              </div>

              <div className={styles.statusRow}>
                <div className={styles.statusCard}>
                  <div className={styles.statusLabel}>Aktueller Status</div>
                  <div className={styles.statusValue}>{labelStatus(visitVM?.status)}</div>
                </div>

                <div className={styles.statusCard}>
                  <div className={styles.statusLabel}>Nächster Schritt</div>
                  <div className={styles.statusValue}>{nextStepHint(visitVM?.status)}</div>
                </div>
              </div>
            </div>
          )}

          {tab === "items" && (
            <div className={styles.items}>
              <Section title="Behandlungen" empty={!derived.hasServices}>
                {(visitVM?.services || []).map((s, idx) => (
                  <Line key={`${s.title}-${idx}`} left={s.title} right={formatEUR(s.price)} />
                ))}
              </Section>

              <Section title="Produkte" empty={!derived.hasProducts}>
                {(visitVM?.products || []).map((p, idx) => (
                  <Line
                    key={`${p.title}-${idx}`}
                    left={`${p.title}${Number(p.qty || 0) > 1 ? ` ×${p.qty}` : ""}`}
                    right={formatEUR(Number(p.price || 0) * Number(p.qty || 1))}
                  />
                ))}
              </Section>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className={styles.foot}>
          <div className={styles.staffPick}>
            <div className={styles.staffLabel}>Mitarbeiter zuweisen</div>
            <select
              className={styles.select}
              value={staffValue || ""}
              onChange={(e) => onStaffChange?.(e.target.value)}
            >
              <option value="">— nicht gewählt —</option>
              {(staffOptions || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
              Schließen
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={() => onConfirm?.()}
              disabled={busy}
              title="Bestätigen"
            >
              {busy ? "…" : confirmLabel || "Übernehmen"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ---------- UI atoms ---------- */
function Tab({ label, on, onClick }) {
  return (
    <button type="button" className={`${styles.tab} ${on ? styles.tabOn : ""}`} onClick={onClick}>
      {label}
    </button>
  );
}

function InfoCard({ label, value, wide }) {
  return (
    <div className={`${styles.infoCard} ${wide ? styles.wide : ""}`}>
      <div className={styles.infoLabel}>{label}</div>
      <div className={styles.infoValue}>{value}</div>
    </div>
  );
}

function TimerCard({ label, value, hint }) {
  return (
    <div className={styles.timerCard}>
      <div className={styles.timerLabel}>{label}</div>
      <div className={styles.timerValue}>{value}</div>
      <div className={styles.timerHint}>{hint}</div>
    </div>
  );
}

function Section({ title, empty, children }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>{title}</div>
      </div>
      {empty ? <div className={styles.empty}>— keine Daten —</div> : <div className={styles.lines}>{children}</div>}
    </div>
  );
}

function Line({ left, right }) {
  return (
    <div className={styles.line}>
      <div className={styles.lineLeft}>{left}</div>
      <div className={styles.lineRight}>{right}</div>
    </div>
  );
}

function formatEUR(n) {
  const x = Number(n || 0);
  return `${x.toFixed(2)}€`;
}

function labelStatus(s) {
  const x = String(s || "").toLowerCase();
  if (x === "waiting") return "Warteliste";
  if (x === "active") return "In Behandlung";
  if (x === "checkout") return "Checkout";
  return x ? x : "—";
}

function nextStepHint(s) {
  const x = String(s || "").toLowerCase();
  if (x === "waiting") return "Mitarbeiter wählen → Übernehmen";
  if (x === "active") return "Fertig → Checkout / Warteliste";
  if (x === "checkout") return "Zu Kasse senden";
  return "—";
}

function useNowTick(enabled) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setT(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [enabled]);
  return t;
}
