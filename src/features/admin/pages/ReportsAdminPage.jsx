import { useEffect, useMemo, useState } from "react";
import { db } from "../../../db/index.js";
import styles from "./ReportsAdminPage.module.css";

// Free POS daily source (same as Cashier DailySales)
import { loadDailyFreePos } from "../../cashier/api/freePosApi.js";

/** Local dateKey: YYYY-MM-DD (wichtig: nicht UTC) */
function toDateKeyLocal(d = new Date()) {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function lastDaysLocal(n = 31) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push(toDateKeyLocal(d));
  }
  return out;
}
function money(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? x.toFixed(2) : "0.00";
}

function safeLinesFromDaily(daily) {
  return daily?.lines || daily?.detailLines || daily?.detailsLines || daily?.rawLines || daily?.items || [];
}
function lineKindOf(l) {
  const k = String(l?.kind || l?.type || "").toLowerCase();
  if (k.includes("service")) return "service";
  if (k.includes("product")) return "product";
  // fallback: wenn qty > 1 oder field product -> product
  if (l?.qty != null && Number(l.qty) > 1) return "product";
  return "service";
}
function linePrice(l) {
  const p = Number(l?.unitPrice ?? l?.price ?? 0);
  return Number.isFinite(p) ? p : 0;
}
function lineQty(l) {
  const q = Number(l?.qty ?? 1);
  return Number.isFinite(q) && q > 0 ? q : 1;
}
function staffKeyFromAny(staffId, staffName) {
  const sid = String(staffId || "").trim();
  if (sid) return sid;
  const sn = String(staffName || "").trim();
  if (sn) return `NAME:${sn}`;
  return "UNKNOWN";
}
function staffDisplayName(key, staffNameMap, fallbackName) {
  if (key.startsWith("NAME:")) return key.slice(5);
  if (key === "UNKNOWN") return "Ohne Mitarbeiter";
  return staffNameMap.get(key) || String(fallbackName || "Unbekannt");
}

function customerLabelFromMaps({ visitId, memberId }, visitMap, memberMap, customerMap) {
  const m = memberMap.get(memberId);
  if (m) {
    // member can be customer or guest displayName
    if (m.customerId) {
      const c = customerMap.get(m.customerId);
      if (c) {
        const fn = String(c.firstName || "").trim();
        const ln = String(c.lastName || "").trim();
        const name = `${fn} ${ln}`.trim() || "Kunde";
        const phone = String(c.phone || "").trim();
        return phone ? `${name} (Tel: ${phone})` : name;
      }
    }
    const dn = String(m.displayName || "").trim();
    const ph = String(m.phone || "").trim();
    if (dn && ph) return `${dn} (Tel: ${ph})`;
    if (dn) return dn;
  }

  const v = visitMap.get(visitId);
  if (v) {
    const dn = String(v.displayName || "").trim();
    if (dn) return dn;
  }

  return "—";
}

export default function ReportsAdminPage() {
  const [dateKey, setDateKey] = useState(toDateKeyLocal(new Date()));
  const dateOptions = useMemo(() => lastDaysLocal(31), []);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [summary, setSummary] = useState({
    total: 0,
    cash: 0,
    card: 0,
    payments: 0,
    serviceRevenue: 0,
    productRevenue: 0,
  });

  const [byStaff, setByStaff] = useState([]);
  const [topServices, setTopServices] = useState([]);
  const [topProducts, setTopProducts] = useState([]);

  // unified detail lines for modal
  const [detailLines, setDetailLines] = useState([]); // {kind,title,qty,unitPrice,sum,customer,staffKey,staffName,time,source}
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailStaffKey, setDetailStaffKey] = useState("");
  const [detailStaffName, setDetailStaffName] = useState("");

  useEffect(() => {
    let live = true;

    (async () => {
      try {
        setErr("");
        setLoading(true);

        // Staff for stable mapping
        const staffAll = await db.staff.toArray();
        const staffNameMap = new Map(staffAll.map((s) => [String(s.id), String(s.name || "")]));

        // 1) Payments (immer aus deinem System)
        const payments = await db.payments_today.where("dateKey").equals(dateKey).toArray();
        const totalPay = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
        const cashPay = payments.filter((p) => p.method === "cash").reduce((s, p) => s + Number(p.amount || 0), 0);
        const cardPay = payments.filter((p) => p.method === "card").reduce((s, p) => s + Number(p.amount || 0), 0);

        // 2) Customer-system lines
        const [svcLines, prodLines] = await Promise.all([
          db.visit_services.where("dateKey").equals(dateKey).toArray(),
          db.visit_products.where("dateKey").equals(dateKey).toArray(),
        ]);

        // Prefetch joins for customer label
        const visitIds = Array.from(new Set([...svcLines, ...prodLines].map((l) => l.visitId).filter(Boolean)));
        const memberIds = Array.from(new Set([...svcLines, ...prodLines].map((l) => l.memberId).filter(Boolean)));

        const [visits, members] = await Promise.all([
          visitIds.length ? db.visits.bulkGet(visitIds) : Promise.resolve([]),
          memberIds.length ? db.visit_members.bulkGet(memberIds) : Promise.resolve([]),
        ]);

        const visitMap = new Map((visits || []).filter(Boolean).map((v) => [v.id, v]));
        const memberMap = new Map((members || []).filter(Boolean).map((m) => [m.id, m]));

        const customerIds = Array.from(
          new Set((members || []).filter(Boolean).map((m) => m.customerId).filter(Boolean))
        );
        const customers = customerIds.length ? await db.customers.bulkGet(customerIds) : [];
        const customerMap = new Map((customers || []).filter(Boolean).map((c) => [c.id, c]));

        // 3) Free POS daily (gleiche Quelle wie DailySales)
        //    Falls FreePOS nichts hat oder API nicht verfügbar -> einfach leer
        let freeDaily = null;
        try {
          freeDaily = await loadDailyFreePos(dateKey);
        } catch {
          freeDaily = null;
        }

        const freeLines = safeLinesFromDaily(freeDaily);
        // Free lines -> unify shape
        const freeDetail = (freeLines || []).map((l) => {
          const kind = lineKindOf(l);
          const qty = lineQty(l);
          const unit = linePrice(l);
          const sum = Number((unit * qty).toFixed(2));
          const staffKey = staffKeyFromAny(l?.staffId, l?.staffName || l?.staff || l?.employeeName);
          const staffName = staffDisplayName(staffKey, staffNameMap, l?.staffName || l?.staff || l?.employeeName);
          return {
            source: "freepos",
            kind,
            title: String(l?.title || l?.name || "Artikel"),
            qty,
            unitPrice: unit,
            sum,
            staffKey,
            staffName,
            customer: String(l?.customerName || "").trim() || "—",
            time: String(l?.timestamp || l?.createdAt || l?.dateKey || dateKey).slice(0, 19).replace("T", " "),
          };
        });

        // Customer system -> unify shape
        const customerDetailSvc = svcLines.map((l) => {
          const staffKey = staffKeyFromAny(l?.staffId, l?.staffName);
          const staffName = staffDisplayName(staffKey, staffNameMap, l?.staffName);
          const unit = Number(l?.price || 0);
          const sum = Number(unit.toFixed(2));
          return {
            source: "visits",
            kind: "service",
            title: String(l?.title || "Service"),
            qty: 1,
            unitPrice: unit,
            sum,
            staffKey,
            staffName,
            customer: customerLabelFromMaps({ visitId: l.visitId, memberId: l.memberId }, visitMap, memberMap, customerMap),
            time: String(l?.startedAt || l?.endedAt || l?.dateKey || dateKey).slice(0, 19).replace("T", " "),
          };
        });

        const customerDetailProd = prodLines.map((l) => {
          const staffKey = staffKeyFromAny(l?.staffId, l?.staffName);
          const staffName = staffDisplayName(staffKey, staffNameMap, l?.staffName);
          const qty = Number(l?.qty || 1);
          const unit = Number(l?.price || 0);
          const sum = Number((unit * qty).toFixed(2));
          return {
            source: "visits",
            kind: "product",
            title: String(l?.title || "Produkt"),
            qty,
            unitPrice: unit,
            sum,
            staffKey,
            staffName,
            customer: customerLabelFromMaps({ visitId: l.visitId, memberId: l.memberId }, visitMap, memberMap, customerMap),
            time: String(l?.dateKey || dateKey),
          };
        });

        const allDetail = [...freeDetail, ...customerDetailSvc, ...customerDetailProd];

        // Aggregation (Top + Staff)
        const staffAgg = new Map(); // staffKey -> {name, services, products, revenue}
        const svcAgg = new Map(); // title -> {qty,revenue}
        const prodAgg = new Map(); // title -> {qty,revenue}

        let serviceRevenue = 0;
        let productRevenue = 0;

        for (const l of allDetail) {
          const key = l.staffKey || "UNKNOWN";
          const row = staffAgg.get(key) || {
            staffKey: key,
            name: staffDisplayName(key, staffNameMap, l.staffName),
            services: 0,
            products: 0,
            revenue: 0,
          };

          row.revenue += Number(l.sum || 0);

          if (l.kind === "service") {
            row.services += 1;
            serviceRevenue += Number(l.sum || 0);

            const t = String(l.title || "Unbekannt");
            const cur = svcAgg.get(t) || { title: t, qty: 0, revenue: 0 };
            cur.qty += 1;
            cur.revenue += Number(l.sum || 0);
            svcAgg.set(t, cur);
          } else {
            row.products += Number(l.qty || 1);
            productRevenue += Number(l.sum || 0);

            const t = String(l.title || "Unbekannt");
            const cur = prodAgg.get(t) || { title: t, qty: 0, revenue: 0 };
            cur.qty += Number(l.qty || 1);
            cur.revenue += Number(l.sum || 0);
            prodAgg.set(t, cur);
          }

          staffAgg.set(key, row);
        }

        const staffRows = Array.from(staffAgg.values())
          .map((r) => ({ ...r, revenue: Number(Number(r.revenue || 0).toFixed(2)) }))
          .sort((a, b) => b.revenue - a.revenue);

        const svcTop = Array.from(svcAgg.values())
          .map((r) => ({ ...r, revenue: Number(Number(r.revenue || 0).toFixed(2)) }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 15);

        const prodTop = Array.from(prodAgg.values())
          .map((r) => ({ ...r, revenue: Number(Number(r.revenue || 0).toFixed(2)) }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 15);

        if (!live) return;

        setSummary({
          total: Number(totalPay.toFixed(2)),
          cash: Number(cashPay.toFixed(2)),
          card: Number(cardPay.toFixed(2)),
          payments: payments.length,
          serviceRevenue: Number(serviceRevenue.toFixed(2)),
          productRevenue: Number(productRevenue.toFixed(2)),
        });

        setByStaff(staffRows);
        setTopServices(svcTop);
        setTopProducts(prodTop);

        // keep detail lines for modal
        setDetailLines(allDetail);
      } catch (e) {
        console.error(e);
        if (!live) return;
        setErr(String(e?.message || e));
      } finally {
        if (live) setLoading(false);
      }
    })();

    return () => {
      live = false;
    };
  }, [dateKey]);

  const staffDetail = useMemo(() => {
    if (!detailStaffKey) return [];
    return (detailLines || [])
      .filter((l) => String(l.staffKey) === String(detailStaffKey))
      .sort((a, b) => String(b.time || "").localeCompare(String(a.time || "")));
  }, [detailLines, detailStaffKey]);

  const staffSvc = useMemo(() => staffDetail.filter((l) => l.kind === "service"), [staffDetail]);
  const staffProd = useMemo(() => staffDetail.filter((l) => l.kind === "product"), [staffDetail]);

  const staffTotals = useMemo(() => {
    const svcSum = staffSvc.reduce((s, x) => s + Number(x.sum || 0), 0);
    const prodSum = staffProd.reduce((s, x) => s + Number(x.sum || 0), 0);
    return {
      svcSum: Number(svcSum.toFixed(2)),
      prodSum: Number(prodSum.toFixed(2)),
      total: Number((svcSum + prodSum).toFixed(2)),
    };
  }, [staffSvc, staffProd]);

  function openStaffDetails(row) {
    setDetailStaffKey(row.staffKey);
    setDetailStaffName(row.name);
    setDetailOpen(true);
  }
  function closeDetails() {
    setDetailOpen(false);
    setDetailStaffKey("");
    setDetailStaffName("");
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.top}>
          <div>
            <h1 className={styles.h1}>Umsätze</h1>
            <div className={styles.sub}>
              Tag-Report (Hybrid): Free POS + Kunden-System. Klick auf Mitarbeiter → Details.
            </div>
          </div>

          <div className={styles.controls}>
            <label className={styles.fLabel}>
              Tag
              <select className={styles.input} value={dateKey} onChange={(e) => setDateKey(e.target.value)}>
                {dateOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {err ? <div className={styles.alertErr}>Fehler: {err}</div> : null}

        <div className={styles.kpis}>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Total</div>
            <div className={styles.kpiVal}>{money(summary.total)} €</div>
            <div className={styles.kpiMeta}>Payments: {summary.payments}</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Cash</div>
            <div className={styles.kpiVal}>{money(summary.cash)} €</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Card</div>
            <div className={styles.kpiVal}>{money(summary.card)} €</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Mix</div>
            <div className={styles.kpiVal}>{money(summary.serviceRevenue)} €</div>
            <div className={styles.kpiMeta}>Services · Produkte {money(summary.productRevenue)} €</div>
          </div>
        </div>

        <div className={styles.grid}>
          <div className={styles.card}>
            <div className={styles.cardHeadRow}>
              <div className={styles.cardTitle}>Mitarbeiter</div>
              <div className={styles.smallMuted}>{loading ? "Lade…" : "Klick auf Mitarbeiter für Details"}</div>
            </div>

            <div className={styles.table}>
              <div className={styles.trHeadStaff}>
                <div>Name</div>
                <div className={styles.taRight}>Services</div>
                <div className={styles.taRight}>Produkte</div>
                <div className={styles.taRight}>Umsatz</div>
              </div>

              {byStaff.length === 0 ? (
                <div className={styles.empty}>Keine Daten für diesen Tag.</div>
              ) : (
                byStaff.map((r) => (
                  <button
                    key={r.staffKey}
                    type="button"
                    className={styles.trStaffBtn}
                    onClick={() => openStaffDetails(r)}
                    title="Details anzeigen"
                  >
                    <div className={styles.bold}>{r.name}</div>
                    <div className={styles.taRight}>{r.services}</div>
                    <div className={styles.taRight}>{r.products}</div>
                    <div className={styles.taRight}>
                      <b>{money(r.revenue)} €</b>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Top Services</div>
            <div className={styles.table}>
              <div className={styles.trHeadItem}>
                <div>Service</div>
                <div className={styles.taRight}>Anzahl</div>
                <div className={styles.taRight}>Umsatz</div>
              </div>

              {topServices.length === 0 ? (
                <div className={styles.empty}>Keine Services.</div>
              ) : (
                topServices.map((r) => (
                  <div key={r.title} className={styles.trItem}>
                    <div className={styles.muted}>{r.title}</div>
                    <div className={styles.taRight}>{r.qty}</div>
                    <div className={styles.taRight}>
                      <b>{money(r.revenue)} €</b>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className={styles.sep} />

            <div className={styles.cardTitle}>Top Produkte</div>
            <div className={styles.table}>
              <div className={styles.trHeadItem}>
                <div>Produkt</div>
                <div className={styles.taRight}>Menge</div>
                <div className={styles.taRight}>Umsatz</div>
              </div>

              {topProducts.length === 0 ? (
                <div className={styles.empty}>Keine Produkte.</div>
              ) : (
                topProducts.map((r) => (
                  <div key={r.title} className={styles.trItem}>
                    <div className={styles.muted}>{r.title}</div>
                    <div className={styles.taRight}>{r.qty}</div>
                    <div className={styles.taRight}>
                      <b>{money(r.revenue)} €</b>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className={styles.note}>
          Hinweis: Diese Seite ist jetzt “Hybrid”. Wenn Free POS verkauft wurde, kommt es über <code>loadDailyFreePos(dateKey)</code>.
          Wenn über Kunden-System verkauft wurde, kommt es über <code>visit_services</code>/<code>visit_products</code>.
        </div>
      </div>

      {detailOpen ? (
        <div className={styles.modalOverlay} onMouseDown={closeDetails} role="dialog" aria-modal="true">
          <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalTitle}>{detailStaffName}</div>
                <div className={styles.modalSub}>
                  {dateKey} · Total: <b>{money(staffTotals.total)} €</b> (Services {money(staffTotals.svcSum)} € · Produkte{" "}
                  {money(staffTotals.prodSum)} €)
                </div>
              </div>
              <button className={styles.closeBtn} type="button" onClick={closeDetails} aria-label="Schließen">
                ✕
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.modalGrid}>
                <div className={styles.modalPanel}>
                  <div className={styles.modalPanelTitle}>Services</div>

                  {staffSvc.length === 0 ? (
                    <div className={styles.emptyBox}>Keine Services für diesen Mitarbeiter an dem Tag.</div>
                  ) : (
                    <div className={styles.detailTable}>
                      <div className={styles.detailHead}>
                        <div>Service</div>
                        <div>Kunde</div>
                        <div className={styles.taRight}>Preis</div>
                      </div>

                      {staffSvc.map((x, idx) => (
                        <div key={`${x.source}-${x.title}-${idx}`} className={styles.detailRow}>
                          <div className={styles.bold}>{x.title}</div>
                          <div className={styles.muted}>{x.customer}</div>
                          <div className={styles.taRight}>
                            <b>{money(x.sum)} €</b>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className={styles.modalPanel}>
                  <div className={styles.modalPanelTitle}>Produkte</div>

                  {staffProd.length === 0 ? (
                    <div className={styles.emptyBox}>Keine Produkte für diesen Mitarbeiter an dem Tag.</div>
                  ) : (
                    <div className={styles.detailTable}>
                      <div className={styles.detailHead}>
                        <div>Produkt</div>
                        <div>Kunde</div>
                        <div className={styles.taRight}>Qty</div>
                        <div className={styles.taRight}>Umsatz</div>
                      </div>

                      {staffProd.map((x, idx) => (
                        <div key={`${x.source}-${x.title}-${idx}`} className={styles.detailRow}>
                          <div className={styles.bold}>{x.title}</div>
                          <div className={styles.muted}>{x.customer}</div>
                          <div className={styles.taRight}>{x.qty}</div>
                          <div className={styles.taRight}>
                            <b>{money(x.sum)} €</b>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button className={styles.btnGhost} type="button" onClick={closeDetails}>
                  Schließen
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
