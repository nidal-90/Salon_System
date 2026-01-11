import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import styles from "./DailyHistory.module.css";

import {
  loadDailyFreePos,
  money,
  toDateKeyLocal,
} from "../api/freePosApi.js";

function safeLinesFromDaily(daily) {
  return (
    daily?.lines ||
    daily?.detailLines ||
    daily?.detailsLines ||
    daily?.rawLines ||
    daily?.items ||
    []
  );
}

export default function DailySalesDaily() {
  const nav = useNavigate();

  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState("");
  const [daily, setDaily] = useState(null);

  // Employee modal
  const [empOpen, setEmpOpen] = useState(false);
  const [empKey, setEmpKey] = useState("");
  const [empName, setEmpName] = useState("");

  async function refreshDaily() {
    try {
      setDailyError("");
      setDailyLoading(true);
      const data = await loadDailyFreePos(toDateKeyLocal(new Date()));
      setDaily(data);
    } catch (e) {
      console.error(e);
      setDailyError(String(e?.message || e));
    } finally {
      setDailyLoading(false);
    }
  }

  useEffect(() => {
    refreshDaily();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dailyLines = useMemo(() => safeLinesFromDaily(daily), [daily]);

  const empLines = useMemo(() => {
    if (!empKey) return [];
    return (dailyLines || []).filter((l) => {
      const sid = String(l?.staffId || "").trim();
      const sn = String(l?.staffName || l?.staff || l?.employeeName || "").trim();
      return empKey === sid || empKey === sn;
    });
  }, [dailyLines, empKey]);

  const empTotals = useMemo(() => {
    const sum = (empLines || []).reduce((s, l) => {
      const qty = Number(l?.qty || 1);
      const price = Number(l?.unitPrice ?? l?.price ?? 0);
      return s + price * qty;
    }, 0);
    return Number(sum.toFixed(2));
  }, [empLines]);

  function openEmpDetails(row) {
    const key = String(row?.staffId || row?.id || row?.name || "").trim();
    setEmpKey(key || String(row?.name || ""));
    setEmpName(String(row?.name || "Mitarbeiter"));
    setEmpOpen(true);
  }

  function closeEmp() {
    setEmpOpen(false);
    setEmpKey("");
    setEmpName("");
  }

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <div>
          <div className={styles.h1}>Tagesübersicht</div>
          <div className={styles.sub}>
            Datum: <b>{toDateKeyLocal(new Date())}</b>
          </div>
        </div>

        <div className={styles.topActions}>
          <button className={styles.btnGhost} type="button" onClick={() => nav("/cashier/freepos")}>
            Zurück zur Kasse
          </button>
          <button className={styles.btnPrimary} type="button" onClick={refreshDaily} disabled={dailyLoading}>
            Aktualisieren
          </button>
        </div>
      </div>

      {dailyError ? <div className={styles.alertErr}>Fehler: {dailyError}</div> : null}

      {!daily ? (
        <div className={styles.alertInfo}>Keine Daten geladen.</div>
      ) : (
        <>
          <div className={styles.kpis}>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Total</div>
              <div className={styles.kpiVal}>{money(daily.summary?.total)} €</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Cash</div>
              <div className={styles.kpiVal}>{money(daily.summary?.cash)} €</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Card</div>
              <div className={styles.kpiVal}>{money(daily.summary?.card)} €</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Positionen</div>
              <div className={styles.kpiVal}>{daily.summary?.linesCount ?? 0}</div>
            </div>
          </div>

          <div className={styles.dailyGrid}>
            <div className={styles.panel}>
              <div className={styles.panelTitleRow}>
                <div className={styles.panelTitle}>Umsatz pro Mitarbeiter</div>
                <div className={styles.smallMuted}>Klick → Details</div>
              </div>

              <div className={styles.table}>
                <div className={styles.trHead}>
                  <div>Mitarbeiter</div>
                  <div className={styles.taRight}>Anzahl</div>
                  <div className={styles.taRight}>Umsatz</div>
                </div>

                {(daily.byEmployee || []).length === 0 ? (
                  <div className={styles.tr}>
                    <div className={styles.smallMuted}>Keine Daten.</div>
                  </div>
                ) : (
                  (daily.byEmployee || []).map((r) => (
                    <button
                      key={r.staffId || r.name}
                      type="button"
                      className={styles.trBtn}
                      onClick={() => openEmpDetails(r)}
                    >
                      <div className={styles.bold}>{r.name}</div>
                      <div className={styles.taRight}>{r.count}</div>
                      <div className={styles.taRight}>
                        <b>{money(r.total)} €</b>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className={styles.panel}>
              <div className={styles.panelTitle}>Top Leistungen / Produkte</div>
              <div className={styles.table}>
                <div className={styles.trHead}>
                  <div>Artikel</div>
                  <div className={styles.taRight}>Qty</div>
                  <div className={styles.taRight}>Umsatz</div>
                </div>

                {(daily.byItem || []).length === 0 ? (
                  <div className={styles.tr}>
                    <div className={styles.smallMuted}>Keine Daten.</div>
                  </div>
                ) : (
                  (daily.byItem || []).slice(0, 25).map((r) => (
                    <div key={r.title} className={styles.tr}>
                      <div>{r.title}</div>
                      <div className={styles.taRight}>{r.qty}</div>
                      <div className={styles.taRight}>
                        <b>{money(r.total)} €</b>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className={styles.smallMuted} style={{ marginTop: 10 }}>
            Hinweis: Details im Modal werden angezeigt, wenn <code>loadDailyFreePos()</code>{" "}
            Line-Details liefert (z.B. <code>daily.lines</code>).
          </div>
        </>
      )}

      {/* Employee details modal */}
      {empOpen ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" onMouseDown={closeEmp}>
          <div className={styles.modalWide} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.modalHeaderRow}>
              <div>
                <div className={styles.modalTitle}>{empName}</div>
                <div className={styles.modalSub}>
                  {toDateKeyLocal(new Date())} · Umsatz: <b>{money(empTotals)} €</b>
                </div>
              </div>
              <button className={styles.closeBtn} type="button" onClick={closeEmp}>
                ✕
              </button>
            </div>

            {Array.isArray(dailyLines) && dailyLines.length > 0 ? (
              empLines.length === 0 ? (
                <div className={styles.alertInfo}>
                  Keine Detail-Zeilen gefunden (evtl. fehlen staffId/staffName in den Lines).
                </div>
              ) : (
                <div className={styles.detailWrap}>
                  <div className={styles.detailHead}>
                    <div>Artikel</div>
                    <div className={styles.taRight}>Qty</div>
                    <div className={styles.taRight}>Preis</div>
                    <div className={styles.taRight}>Summe</div>
                  </div>

                  {empLines.map((l, idx) => {
                    const title = String(l?.title || l?.name || "Artikel");
                    const qty = Number(l?.qty || 1);
                    const price = Number(l?.unitPrice ?? l?.price ?? 0);
                    const sum = Number((price * qty).toFixed(2));

                    return (
                      <div key={l?.id || `${title}-${idx}`} className={styles.detailRow}>
                        <div className={styles.bold}>{title}</div>
                        <div className={styles.taRight}>{qty}</div>
                        <div className={styles.taRight}>{money(price)} €</div>
                        <div className={styles.taRight}>
                          <b>{money(sum)} €</b>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              <div className={styles.alertInfo}>
                Dein Daily-API liefert aktuell keine Detail-Zeilen (nur Aggregationen). Wenn du willst,
                erweitern wir <code>loadDailyFreePos()</code> so, dass es <code>daily.lines</code> mitgibt
                (inkl. staffId/staffName).
              </div>
            )}

            <div className={styles.modalActions}>
              <button className={styles.btnGhost} type="button" onClick={closeEmp}>
                Schließen
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
