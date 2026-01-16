// src/features/cashier/pages/CashierCheckoutPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db } from "../../../db/index.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";
import styles from "./CashierCheckoutPage.module.css";

function money(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? x.toFixed(2) : "0.00";
}
function clampInt(n, a, b) {
  n = Number(n);
  if (!Number.isFinite(n)) n = a;
  return Math.max(a, Math.min(b, Math.floor(n)));
}
function safeStr(x) {
  return String(x == null ? "" : x).trim();
}

function useCashierIdentityFallback() {
  try {
    const raw = sessionStorage.getItem("usb_session");
    if (!raw) return { cashierStaffId: "", cashierName: "" };
    const s = JSON.parse(raw);
    return {
      cashierStaffId: s?.staffId || "",
      cashierName: s?.staffName || s?.name || "",
    };
  } catch {
    return { cashierStaffId: "", cashierName: "" };
  }
}

async function computeVisitReadiness(visitId, dateKey) {
  const states = await db.visit_area_state
    .where("dateKey")
    .equals(dateKey)
    .and((x) => String(x.visitId) === String(visitId))
    .toArray()
    .catch(() => []);

  const any = states.length > 0;
  const allDone = any && states.every((x) => String(x.status) === "done");
  const pending = states.filter((x) => String(x.status) !== "done");

  return { any, allDone, pendingCount: pending.length };
}

function msBetween(a, b) {
  const t1 = a ? Date.parse(a) : NaN;
  const t2 = b ? Date.parse(b) : NaN;
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return Math.max(0, t2 - t1);
}
function toMin(ms) {
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 60000);
}

/**
 * Snapshot: Warte-/Aktivzeiten je Bereich (für Kundenprofil & Audit).
 * - wait: visit.createdAt -> startedAt (oder bis jetzt falls noch nicht gestartet)
 * - active: startedAt -> endedAt (oder bis jetzt)
 */
async function buildAreaTimingSnapshot({ visitId, dateKey, visitCreatedAt }) {
  const states = await db.visit_area_state
    .where("dateKey")
    .equals(dateKey)
    .and((x) => String(x.visitId) === String(visitId))
    .toArray()
    .catch(() => []);

  const nowIso = new Date().toISOString();
  const base = visitCreatedAt || nowIso;

  return (states || []).map((s) => {
    const startedAt = safeStr(s.startedAt);
    const endedAt = safeStr(s.endedAt);

    const waitMs = startedAt ? msBetween(base, startedAt) : msBetween(base, nowIso);
    const activeMs = startedAt ? msBetween(startedAt, endedAt || nowIso) : null;

    return {
      areaId: String(s.areaId || ""),
      status: String(s.status || ""),
      startedAt: startedAt || "",
      endedAt: endedAt || "",
      waitMin: toMin(waitMs),
      activeMin: activeMs == null ? null : toMin(activeMs),
      assignedStaffId: String(s.assignedStaffId || ""),
      assignedStaffName: String(s.assignedStaffName || ""),
      preferredStaffId: String(s.preferredStaffId || ""),
      preferredStaffName: String(s.preferredStaffName || ""),
      note: String(s.note || ""),
    };
  });
}

async function logVoid({
  dateKey,
  visitId,
  customerId,
  line,
  cashierStaffId,
  cashierName,
  orderNote,
  areaTimings,
}) {
  const now = new Date().toISOString();
  const qty = Number(line.qty || 1);
  const unitPrice = Number(line.unitPrice || 0);
  const lineTotal = Number((unitPrice * qty).toFixed(2));

  // 1) Umsatz/Storno-Log (visit_voids)
  await db.visit_voids.add({
    id: crypto.randomUUID(),
    dateKey,
    createdAt: now,
    visitId: String(visitId),
    customerId: String(customerId || ""),
    memberId: String(line.memberId || "primary"),

    kind: String(line.kind), // service|product
    title: String(line.title || ""),
    qty,
    unitPrice: Number(unitPrice.toFixed(2)),
    lineTotal,

    staffId: String(line.staffId || ""),
    staffName: String(line.staffName || ""),

    cashierStaffId: String(cashierStaffId || ""),
    cashierName: String(cashierName || ""),

    reason: "VOID_BY_CASHIER",
    note: String(orderNote || ""),
    sourceId: String(line.sourceId || ""),
    areaId: String(line.areaId || ""),
  });

  // 2) Kundenprofil (customer_history)
  if (customerId) {
    await db.customer_history.add({
      id: crypto.randomUUID(),
      customerId: String(customerId),
      createdAt: now,
      visitId: String(visitId),
      areaId: String(line.areaId || ""),
      staffId: String(line.staffId || ""),
      staffName: String(line.staffName || ""),
      type: "VOID_ITEM",
      payload: {
        kind: String(line.kind),
        title: String(line.title || ""),
        qty,
        unitPrice: Number(unitPrice.toFixed(2)),
        lineTotal,
        memberId: String(line.memberId || "primary"),
        staffId: String(line.staffId || ""),
        staffName: String(line.staffName || ""),
        cashierStaffId: String(cashierStaffId || ""),
        cashierName: String(cashierName || ""),
        note: String(orderNote || ""),
        fromVisit: !!line.fromVisit,
        sourceId: String(line.sourceId || ""),
        areaTimings: Array.isArray(areaTimings) ? areaTimings : [],
      },
    });
  }
}

/**
 * SwipeRow: pointer-driven left swipe (no libs).
 */
function SwipeRow({ children, onSwipedLeft }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const threshold = 90;

  function onDown(e) {
    setDragging(true);
    const x = e.clientX ?? (e.touches?.[0]?.clientX || 0);
    SwipeRow._startX = x;
  }
  function onMove(e) {
    if (!dragging) return;
    const x = e.clientX ?? (e.touches?.[0]?.clientX || 0);
    const delta = x - (SwipeRow._startX || x);
    setDx(Math.min(0, delta)); // only left
  }
  function onUp() {
    if (!dragging) return;
    setDragging(false);
    if (dx <= -threshold) onSwipedLeft?.();
    setDx(0);
  }

  return (
    <div className={styles.swipeWrap}>
      <div className={styles.swipeBg}>
        <div className={styles.swipeHint}>Storno</div>
      </div>

      <div
        className={styles.swipeCard}
        style={{ transform: `translateX(${dx}px)` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onTouchStart={(e) => onDown(e.touches?.[0] || e)}
        onTouchMove={(e) => onMove(e)}
        onTouchEnd={onUp}
      >
        {children}
      </div>
    </div>
  );
}

export default function CashierCheckoutPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const usb = useCashierIdentityFallback();

  const visitId = params.get("visitId") || "";
  const [dateKey, setDateKey] = useState(() => toDateKeyISO(new Date()));

  const [loadError, setLoadError] = useState("");
  const [staff, setStaff] = useState([]);
  const [visit, setVisit] = useState(null);
  const [customerId, setCustomerId] = useState("");

  // Master items for Nachbuchen (from catalogs)
  const [masterItems, setMasterItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCat, setActiveCat] = useState("");
  const [itemSearch, setItemSearch] = useState("");

  // cashier identity (usb or manual)
  const [cashierStaffId, setCashierStaffId] = useState(() => usb.cashierStaffId || "");
  const cashierName = useMemo(
    () =>
      staff.find((s) => String(s.id) === String(cashierStaffId))?.name ||
      usb.cashierName ||
      "",
    [staff, cashierStaffId, usb.cashierName]
  );

  // Global order note (per Visit/Bestellung)
  const [orderNoteOpen, setOrderNoteOpen] = useState(false);
  const [orderNote, setOrderNote] = useState("");

  // cart
  const [cart, setCart] = useState([]);

  // warning modal (not all done)
  const [warnOpen, setWarnOpen] = useState(false);
  const [warnText, setWarnText] = useState("");
  const [pendingMethod, setPendingMethod] = useState("cash");

  const missingStaffForService = useMemo(
    () => cart.some((l) => l.kind === "service" && !l.staffId),
    [cart]
  );

  const total = useMemo(
    () => cart.reduce((sum, l) => sum + Number(l.unitPrice) * Number(l.qty), 0),
    [cart]
  );

  async function load() {
    try {
      setLoadError("");

      const [
        st,
        v,
        vs,
        vp,
        areas,
        svcCat,
        prodCat,
        prodCats,
      ] = await Promise.all([
        db.staff.toArray().catch(() => []),
        visitId ? db.visits.get(String(visitId)).catch(() => null) : Promise.resolve(null),
        visitId
          ? db.visit_services.where("visitId").equals(String(visitId)).toArray().catch(() => [])
          : Promise.resolve([]),
        visitId
          ? db.visit_products.where("visitId").equals(String(visitId)).toArray().catch(() => [])
          : Promise.resolve([]),
        db.areas ? db.areas.toArray().catch(() => []) : Promise.resolve([]),
        db.service_catalog ? db.service_catalog.toArray().catch(() => []) : Promise.resolve([]),
        db.product_catalog ? db.product_catalog.toArray().catch(() => []) : Promise.resolve([]),
        db.product_categories ? db.product_categories.toArray().catch(() => []) : Promise.resolve([]),
      ]);

      const cleanStaff = (st || [])
        .filter((x) => Number(x.active) === 1 || x.active === true)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

      setStaff(cleanStaff);

      setVisit(v || null);
      setCustomerId(v?.customerId ? String(v.customerId) : "");
      setOrderNote(safeStr(v?.note || ""));

      // build cart from visit lines
      const cartLines = [];

      for (const s of vs || []) {
        cartLines.push({
          id: crypto.randomUUID(),
          kind: "service",
          title: safeStr(s.title) || "Service",
          unitPrice: Number(s.price || 0),
          qty: 1,
          staffId: safeStr(s.staffId),
          staffName: safeStr(s.staffName),
          memberId: String(s.memberId || "primary"),
          sourceId: String(s.id || ""),
          fromVisit: true,
          areaId: String(s.areaId || ""),
        });
      }

      for (const p of vp || []) {
        cartLines.push({
          id: crypto.randomUUID(),
          kind: "product",
          title: safeStr(p.title) || "Produkt",
          unitPrice: Number(p.price || 0),
          qty: clampInt(p.qty || 1, 1, 99),
          staffId: safeStr(p.staffId), // optional
          staffName: safeStr(p.staffName),
          memberId: String(p.memberId || "primary"),
          sourceId: String(p.id || ""),
          fromVisit: true,
          areaId: "", // products have no areaId in schema
        });
      }

      cartLines.sort((a, b) => {
        const kn = String(a.kind).localeCompare(String(b.kind));
        if (kn !== 0) return kn;
        return String(a.title || "").localeCompare(String(b.title || ""));
      });

      setCart(cartLines);

      // Build master items from catalogs (Nachbuchen)
      const areaById = new Map((areas || []).map((a) => [String(a.id), a]));
      const prodCatById = new Map((prodCats || []).map((c) => [String(c.id), c]));

      const master = [];

      // Services -> category by area name
      for (const s of svcCat || []) {
        if (!(Number(s.active) === 1 || s.active === true)) continue;
        const areaName = areaById.get(String(s.areaId))?.name || "Services";
        master.push({
          id: String(s.id),
          kind: "service",
          title: safeStr(s.name || s.title || "Service"),
          price: Number(s.price || 0),
          category: `Service · ${areaName}`,
          sortOrder: Number(s.sortOrder || 0),
          areaId: String(s.areaId || ""),
        });
      }

      // Products -> category by product_categories title
      for (const p of prodCat || []) {
        if (!(Number(p.active) === 1 || p.active === true)) continue;
        const catTitle = prodCatById.get(String(p.categoryId))?.title || "Produkte";
        master.push({
          id: String(p.id),
          kind: "product",
          title: safeStr(p.name || p.title || "Produkt"),
          price: Number(p.price || 0),
          category: `Produkt · ${catTitle}`,
          sortOrder: Number(p.sortOrder || 0),
          areaId: "",
        });
      }

      master.sort((a, b) => {
        const c = String(a.category).localeCompare(String(b.category));
        if (c !== 0) return c;
        const so = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
        if (so !== 0) return so;
        return String(a.title).localeCompare(String(b.title));
      });

      setMasterItems(master);

      const cats = Array.from(new Set(master.map((x) => x.category)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      setCategories(cats);
      setActiveCat((prev) => (prev && cats.includes(prev) ? prev : cats[0] || ""));
    } catch (e) {
      console.error(e);
      setLoadError(String(e?.message || e));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);

  function updateLine(id, patch) {
    setCart((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  async function voidLine(line) {
    if (!line) return;

    if (!cashierStaffId) {
      alert("Bitte Kassierer auswählen (USB oder Liste).");
      return;
    }

    const areaTimings = await buildAreaTimingSnapshot({
      visitId,
      dateKey,
      visitCreatedAt: safeStr(visit?.createdAt),
    });

    await logVoid({
      dateKey,
      visitId,
      customerId,
      line,
      cashierStaffId,
      cashierName,
      orderNote,
      areaTimings,
    });

    setCart((prev) => prev.filter((x) => x.id !== line.id));
  }

  function addMasterItemToCart(it) {
    setCart((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        kind: it.kind,
        title: it.title,
        unitPrice: Number(it.price || 0),
        qty: 1,
        staffId: it.kind === "service" ? "" : "",
        staffName: "",
        memberId: "primary",
        sourceId: "",
        fromVisit: false,
        areaId: String(it.areaId || ""),
      },
    ]);
  }

  const filteredMasterItems = useMemo(() => {
    const s = itemSearch.trim().toLowerCase();
    return masterItems
      .filter((x) => (activeCat ? x.category === activeCat : true))
      .filter((x) => (s ? String(x.title || "").toLowerCase().includes(s) : true));
  }, [masterItems, activeCat, itemSearch]);

  async function proceedToCheckoutIfAllowed(method) {
    if (!visitId) return;

    if (!cashierStaffId) {
      alert("Bitte Kassierer auswählen (USB oder Liste).");
      return;
    }

    const r = await computeVisitReadiness(visitId, dateKey);
    if (!r.allDone) {
      setWarnText(
        `Achtung: Kunde ist noch nicht vollständig fertig. Es sind noch ${r.pendingCount} Bereich(e) offen. Trotzdem fortfahren?`
      );
      setPendingMethod(method);
      setWarnOpen(true);
      return;
    }

    await checkout(method);
  }

  async function checkout(method) {
    if (!cart.length) return;
    if (missingStaffForService) return;

    const now = new Date().toISOString();
    const dk = toDateKeyISO(new Date());
    const staffById = new Map(staff.map((s) => [String(s.id), s]));

    await db.transaction(
      "rw",
      db.visit_services,
      db.visit_products,
      db.payments_today,
      db.visits,
      db.customer_history,
      async () => {
        // (A) sync cart items into visit tables (new items + edited price/qty/staff)
        for (const l of cart) {
          const isService = l.kind === "service";
          const sid = safeStr(l.staffId);
          const sn = sid ? staffById.get(String(sid))?.name || "" : "";

          if (l.fromVisit) {
            // update existing
            if (isService && l.sourceId) {
              await db.visit_services.update(String(l.sourceId), {
                price: Number(Number(l.unitPrice || 0).toFixed(2)),
                staffId: sid || null,
                staffName: sn,
                // Notiz ist global -> nicht mehr pro line
              });
            }
            if (!isService && l.sourceId) {
              await db.visit_products.update(String(l.sourceId), {
                price: Number(Number(l.unitPrice || 0).toFixed(2)),
                qty: clampInt(l.qty, 1, 99),
                staffId: sid || null,
                staffName: sn,
              });
            }
          } else {
            // newly added in cashier
            if (isService) {
              await db.visit_services.add({
                id: crypto.randomUUID(),
                visitId: String(visitId),
                dateKey: dk,
                memberId: String(l.memberId || "primary"),
                areaId: String(l.areaId || ""),
                title: String(l.title || "Service"),
                price: Number(Number(l.unitPrice || 0).toFixed(2)),
                staffId: sid || null,
                staffName: sn,
                createdAt: now,
              });
            } else {
              await db.visit_products.add({
                id: crypto.randomUUID(),
                visitId: String(visitId),
                dateKey: dk,
                memberId: String(l.memberId || "primary"),
                title: String(l.title || "Produkt"),
                price: Number(Number(l.unitPrice || 0).toFixed(2)),
                qty: clampInt(l.qty, 1, 99),
                staffId: sid || null,
                staffName: sn,
                createdAt: now,
              });
            }
          }
        }

        // (B) payments_today per member
        const sumByMember = new Map();
        for (const l of cart) {
          const key = String(l.memberId || "primary");
          const cur = Number(sumByMember.get(key) || 0);
          sumByMember.set(key, cur + Number(l.unitPrice) * Number(l.qty));
        }

        for (const [memberId, amount] of sumByMember.entries()) {
          const amt = Number(amount || 0);
          if (!Number.isFinite(amt) || amt <= 0) continue;

          await db.payments_today.add({
            id: crypto.randomUUID(),
            visitId: String(visitId),
            memberId: String(memberId),
            dateKey: dk,
            method: String(method),
            amount: Number(amt.toFixed(2)),
            createdAt: now,
            cashierStaffId: String(cashierStaffId || ""),
            cashierName: String(cashierName || ""),
            exportedAt: "",
          });
        }

        // (C) close visit + save global note
        await db.visits.update(String(visitId), {
          status: "closed",
          readyForCheckoutAt: safeStr(visit?.readyForCheckoutAt) || now,
          closedAt: now,
          cashierStaffId: String(cashierStaffId || ""),
          cashierName: String(cashierName || ""),
          note: safeStr(orderNote || ""),
        });

        // (D) customer_history: checkout summary (optional but recommended)
        if (customerId) {
          const areaTimings = await buildAreaTimingSnapshot({
            visitId,
            dateKey: dk,
            visitCreatedAt: safeStr(visit?.createdAt),
          });

          await db.customer_history.add({
            id: crypto.randomUUID(),
            customerId: String(customerId),
            createdAt: now,
            visitId: String(visitId),
            type: "CHECKOUT",
            payload: {
              method: String(method),
              total: Number(total.toFixed(2)),
              cashierStaffId: String(cashierStaffId || ""),
              cashierName: String(cashierName || ""),
              note: safeStr(orderNote || ""),
              areaTimings,
              lineCount: cart.length,
            },
          });
        }
      }
    );

    alert("Checkout erfolgreich.");
    nav("/cashier");
  }

  const headerName = useMemo(() => {
    if (!visit) return "Kasse · Checkout";
    return `Kasse · ${safeStr(visit.displayName) || "Checkout"}`;
  }, [visit]);

  const subtitle = useMemo(() => {
    const n = cart.length;
    return `${n} Position${n === 1 ? "" : "en"} · Total: ${money(total)} €`;
  }, [cart.length, total]);

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.top}>
          <div>
            <div className={styles.h1}>{headerName}</div>
            <div className={styles.sub}>
              Visit: <b>{visitId ? String(visitId).slice(-8) : "—"}</b> · {subtitle}
            </div>
          </div>

          <div className={styles.controls}>
            <label className={styles.fLabel}>
              Datum
              <input
                className={styles.input}
                type="date"
                value={dateKey}
                onChange={(e) => setDateKey(e.target.value)}
              />
            </label>

            <label className={styles.fLabel}>
              Kassierer
              <select
                className={styles.input}
                value={cashierStaffId}
                onChange={(e) => setCashierStaffId(e.target.value)}
              >
                <option value="">
                  {usb.cashierName ? `USB: ${usb.cashierName}` : "— auswählen —"}
                </option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              className={styles.btnGhost}
              type="button"
              onClick={() => nav("/reception/liveboard")}
            >
              Liveboard
            </button>

            <button className={styles.btnGhost} type="button" onClick={() => nav("/cashier")}>
              Zurück
            </button>
          </div>
        </div>

        {loadError ? (
          <div className={styles.alertErr}>
            DB-Fehler: {loadError}
            <div className={styles.smallMuted}>
              Wenn du am Schema warst: IndexedDB löschen und neu laden.
            </div>
          </div>
        ) : null}

        {!visitId ? (
          <div className={styles.card} style={{ marginTop: 12 }}>
            <div className={styles.empty}>
              Kein visitId übergeben. Öffne die Kasse über “Checkout” im Liveboard.
            </div>
          </div>
        ) : null}

        <div className={styles.grid}>
          {/* LEFT */}
          <div className={styles.card}>
            <div className={styles.cardHeadRow}>
              <div>
                <div className={styles.cardTitle}>Leistungen & Produkte</div>
                <div className={styles.smallMuted}>
                  Swipe links = Storno (wird gespeichert im Profil & Umsatzlog). Preis editierbar.
                  Nachbuchen möglich.
                </div>
              </div>
              <div className={styles.totalBadge}>{money(total)} €</div>
            </div>

            {missingStaffForService ? (
              <div className={styles.alertWarn}>
                Mindestens ein <b>Service</b> hat keinen Mitarbeiter. Bitte auswählen.
              </div>
            ) : null}

            <div className={styles.table}>
              <div className={styles.trHead}>
                <div className={styles.colType}>Typ</div>
                <div>Position</div>
                <div>Mitarbeiter</div>
                <div className={styles.taRight}>Menge</div>
                <div className={styles.taRight}>Preis</div>
                <div className={styles.taRight}>Summe</div>
              </div>

              <div className={styles.scrollBody}>
                {cart.length === 0 ? (
                  <div className={styles.empty}>Keine Positionen (leer oder bereits storniert).</div>
                ) : (
                  cart.map((l) => {
                    const needs = l.kind === "service";
                    const empMissing = needs && !l.staffId;

                    return (
                      <SwipeRow key={l.id} onSwipedLeft={() => voidLine(l)}>
                        <div className={styles.trRow}>
                          <div className={styles.colType}>
                            <span className={styles.badgeKindMini}>
                              {l.kind === "service" ? "S" : "P"}
                            </span>
                          </div>

                          <div>
                            <div className={styles.bold}>{l.title}</div>
                            <div className={styles.rowMeta}>
                              {l.fromVisit ? (
                                <span className={styles.chip}>Visit</span>
                              ) : (
                                <span className={styles.chipMuted}>Nachgebucht</span>
                              )}
                            </div>
                          </div>

                          <div>
                            <select
                              className={`${styles.select} ${empMissing ? styles.selectError : ""}`}
                              value={l.staffId}
                              onChange={(e) => {
                                const sid = e.target.value;
                                const sn =
                                  staff.find((s) => String(s.id) === String(sid))?.name || "";
                                updateLine(l.id, { staffId: sid, staffName: sn });
                              }}
                            >
                              {!needs ? <option value="">— optional —</option> : null}
                              <option value="">—</option>
                              {staff.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                            {empMissing ? <div className={styles.miniWarn}>Mitarbeiter nötig</div> : null}
                          </div>

                          <div className={`${styles.taRight} ${styles.qtyBox}`}>
                            <button
                              type="button"
                              className={styles.qtyBtn}
                              onClick={() =>
                                updateLine(l.id, { qty: clampInt(Number(l.qty) - 1, 1, 99) })
                              }
                            >
                              −
                            </button>
                            <div className={styles.qtyVal}>x{clampInt(l.qty, 1, 99)}</div>
                            <button
                              type="button"
                              className={styles.qtyBtn}
                              onClick={() =>
                                updateLine(l.id, { qty: clampInt(Number(l.qty) + 1, 1, 99) })
                              }
                            >
                              +
                            </button>
                          </div>

                          <div className={styles.taRight}>
                            <input
                              className={styles.priceInput}
                              type="number"
                              step="0.01"
                              min="0"
                              value={Number(l.unitPrice || 0)}
                              onChange={(e) => updateLine(l.id, { unitPrice: Number(e.target.value) })}
                            />
                          </div>

                          <div className={`${styles.taRight} ${styles.bold}`}>
                            {money(Number(l.unitPrice) * Number(l.qty))} €
                          </div>
                        </div>
                      </SwipeRow>
                    );
                  })
                )}
              </div>
            </div>

            {/* NACHBUCHEN */}
            <div className={styles.addBox}>
              <div className={styles.addHead}>
                <div>
                  <div className={styles.cardTitle}>Nachbuchen</div>
                  <div className={styles.smallMuted}>
                    Zusätzliche Leistungen/Produkte direkt zur Rechnung hinzufügen.
                  </div>
                </div>

                <div className={styles.searchWrap}>
                  <input
                    className={styles.search}
                    value={itemSearch}
                    onChange={(e) => setItemSearch(e.target.value)}
                    placeholder="Suchen…"
                  />
                </div>
              </div>

              <div className={styles.pills}>
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`${styles.pill} ${activeCat === c ? styles.pillOn : ""}`}
                    onClick={() => setActiveCat(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>

              <div className={styles.itemsGrid}>
                {filteredMasterItems.length === 0 ? (
                  <div className={styles.empty}>Keine Items gefunden.</div>
                ) : (
                  filteredMasterItems.slice(0, 24).map((it) => (
                    <button
                      key={`${it.kind}-${it.id}`}
                      type="button"
                      className={styles.itemCard}
                      onClick={() => addMasterItemToCart(it)}
                    >
                      <div className={styles.itemTop}>
                        <div>
                          <div className={styles.itemTitle}>{it.title}</div>
                          <div className={styles.itemMeta}>
                            {it.kind === "service" ? "Service" : "Produkt"}
                          </div>
                        </div>
                        <div className={styles.itemPrice}>{money(it.price)} €</div>
                      </div>
                      <div className={styles.itemBtn}>Hinzufügen</div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div className={`${styles.card} ${styles.sticky}`}>
            <div className={styles.cardHeadRow}>
              <div>
                <div className={styles.cardTitle}>Zahlung</div>
                <div className={styles.smallMuted}>
                  Kassierer: <b>{cashierName || "—"}</b>
                </div>

                <div style={{ marginTop: 10 }}>
                  <button className={styles.btnGhost} type="button" onClick={() => setOrderNoteOpen(true)}>
                    {orderNote ? "Bestellnotiz bearbeiten" : "Bestellnotiz hinzufügen"}
                  </button>

                  {orderNote ? (
                    <div className={styles.noteInline} style={{ marginTop: 8 }}>
                      <b>Notiz:</b> {orderNote}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className={styles.totalBadge}>{money(total)} €</div>
            </div>

            <div className={styles.checkoutBox}>
              <div className={styles.checkoutRow}>
                <div className={styles.checkoutLabel}>Total</div>
                <div className={styles.checkoutValue}>{money(total)} €</div>
              </div>

              <div className={styles.checkoutBtns}>
                <button
                  className={styles.btnPay}
                  type="button"
                  disabled={!cart.length || missingStaffForService || !cashierStaffId}
                  onClick={() => proceedToCheckoutIfAllowed("cash")}
                >
                  CASH
                </button>

                <button
                  className={styles.btnPay}
                  type="button"
                  disabled={!cart.length || missingStaffForService || !cashierStaffId}
                  onClick={() => proceedToCheckoutIfAllowed("card")}
                >
                  CARD
                </button>
              </div>

              <div className={styles.smallMuted}>
                Swipe links = Storno (gespeichert). Checkout setzt Visit auf <b>closed</b> und schreibt{" "}
                <b>payments_today</b>.
              </div>
            </div>
          </div>
        </div>

        {/* Warning modal */}
        {warnOpen ? (
          <div className={styles.modalOverlay} role="dialog" aria-modal="true">
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <div>
                  <div className={styles.modalTitle}>Nicht vollständig fertig</div>
                  <div className={styles.modalSub}>{warnText}</div>
                </div>
                <button className={styles.closeBtn} type="button" onClick={() => setWarnOpen(false)}>
                  ✕
                </button>
              </div>

              <div className={styles.modalBody}>
                <div className={styles.smallMuted}>
                  Wenn du fortfährst, wird der Visit trotzdem bezahlt/geschlossen.
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button className={styles.btnGhost} type="button" onClick={() => setWarnOpen(false)}>
                  Abbrechen
                </button>
                <button className={styles.btnPrimary} type="button" onClick={() => checkout(pendingMethod)}>
                  Trotzdem fortfahren
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Order note modal */}
        {orderNoteOpen ? (
          <div className={styles.modalOverlay} role="dialog" aria-modal="true">
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <div>
                  <div className={styles.modalTitle}>Bestellnotiz</div>
                  <div className={styles.modalSub}>Gilt für die gesamte Bestellung/Visit.</div>
                </div>
                <button className={styles.closeBtn} type="button" onClick={() => setOrderNoteOpen(false)}>
                  ✕
                </button>
              </div>

              <div className={styles.modalBody}>
                <textarea
                  className={styles.textarea}
                  value={orderNote}
                  onChange={(e) => setOrderNote(e.target.value)}
                  placeholder="z. B. Allergie, Sonderwunsch, Rabattgrund…"
                />
              </div>

              <div className={styles.modalFooter}>
                <button className={styles.btnGhost} type="button" onClick={() => setOrderNoteOpen(false)}>
                  Schließen
                </button>
                <button className={styles.btnPrimary} type="button" onClick={() => setOrderNoteOpen(false)}>
                  Speichern
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
