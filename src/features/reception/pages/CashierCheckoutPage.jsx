// src/features/cashier/pages/CashierCheckoutPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
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
function safeJson(x) {
  try {
    return JSON.stringify(x ?? null);
  } catch {
    return "null";
  }
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

  await db.visit_voids.add({
    id: crypto.randomUUID(),
    dateKey,
    createdAt: now,
    visitId: String(visitId),
    customerId: String(customerId || ""),
    memberId: String(line.memberId || "primary"),
    kind: String(line.kind),
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
 * Voucher codes (same spirit as Admin)
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomCodePart(len = 4) {
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}
async function generateUniqueVoucherCode(prefix = "SBL") {
  const p = String(prefix || "SBL").toUpperCase();
  if (!db?.vouchers) return `${p}-${randomCodePart(4)}-${randomCodePart(4)}`;

  for (let i = 0; i < 16; i++) {
    const code = `${p}-${randomCodePart(4)}-${randomCodePart(4)}`;
    const exists = await db.vouchers.where("code").equals(code).first();
    if (!exists) return code;
  }
  return `${p}-${randomCodePart(4)}-${randomCodePart(4)}-${String(Date.now()).slice(-3)}`;
}

/**
 * SwipeRow:
 * - triggers only when user really drags left (no hover)
 * - confirmation happens outside via onRequestVoid
 */
function SwipeRow({ children, onRequestVoid }) {
  const [dx, setDx] = useState(0);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const movedRef = useRef(false);

  const ARM_DISTANCE = 14;
  const THRESHOLD = 90;

  function getClientX(e) {
    return e?.clientX ?? (e?.touches?.[0]?.clientX || 0);
  }

  function onDown(e) {
    if (e?.button != null && e.button !== 0) return;
    draggingRef.current = true;
    movedRef.current = false;
    startXRef.current = getClientX(e);
    setDx(0);
  }

  function onMove(e) {
    if (!draggingRef.current) return;
    const x = getClientX(e);
    const delta = x - (startXRef.current || x);

    if (!movedRef.current) {
      if (Math.abs(delta) >= ARM_DISTANCE) movedRef.current = true;
      else return;
    }

    setDx(Math.min(0, delta));
  }

  function onUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;

    if (movedRef.current && dx <= -THRESHOLD) onRequestVoid?.();
    setDx(0);
  }

  const showBg = movedRef.current && dx < 0;

  return (
    <div className={styles.swipeWrap}>
      {showBg ? (
        <div className={styles.swipeBg} aria-hidden="true">
          <div className={styles.swipeHint}>Storno</div>
        </div>
      ) : null}

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

function PillTabs({ value, onChange, tabs, ariaLabel }) {
  return (
    <div className={styles.pills} role="tablist" aria-label={ariaLabel || "Tabs"}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          className={`${styles.pill} ${value === t.value ? styles.pillOn : ""}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function buildReceiptText({ visit, customer, cart, total, method, cashierName, orderNote }) {
  const lines = (cart || []).map((l) => {
    const qty = Number(l.qty || 1);
    const unit = Number(l.unitPrice || 0);
    const sum = qty * unit;
    const staff = l.staffName ? ` · ${l.staffName}` : "";
    return `- ${l.title} x${qty}  ${money(sum)} €${staff}`;
  });

  const head = [
    "Sibel Salon",
    "Kassenzettel",
    "------------------------------",
    `Datum: ${new Date().toISOString().slice(0, 10)}`,
    `Kasse: ${cashierName || "-"}`,
    `Zahlart: ${String(method || "").toUpperCase()}`,
    visit?.id ? `Visit: ${String(visit.id).slice(-8)}` : "",
    customer ? `Kunde: ${safeStr(customer.firstName)} ${safeStr(customer.lastName)}`.trim() : (visit?.displayName ? `Kunde: ${visit.displayName}` : ""),
    orderNote ? `Notiz: ${orderNote}` : "",
    "------------------------------",
    ...lines,
    "------------------------------",
    `TOTAL: ${money(total)} €`,
    "",
    "Danke und bis bald.",
  ]
    .filter(Boolean)
    .join("\n");

  return head;
}

function openPrintWindow(text) {
  const w = window.open("", "_blank", "noopener,noreferrer,width=520,height=720");
  if (!w) return;
  const esc = String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  w.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Kassenzettel</title>
  <style>
    body{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; padding: 18px; }
    pre{ white-space: pre-wrap; font-size: 12px; line-height: 1.35; }
    .hint{ margin-top: 12px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <pre>${esc}</pre>
  <div class="hint">Fenster kann nach dem Druck geschlossen werden.</div>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`);
  w.document.close();
}

export default function CashierCheckoutPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const usb = useCashierIdentityFallback();

  // Route param visitId is only an initial suggestion. Page can work without it.
  const initialVisitId = params.get("visitId") || "";
  const [activeVisitId, setActiveVisitId] = useState(initialVisitId);

  const [dateKey, setDateKey] = useState(() => toDateKeyISO(new Date()));

  const [loadError, setLoadError] = useState("");
  const [staff, setStaff] = useState([]);
  const [visit, setVisit] = useState(null);
  const [customerId, setCustomerId] = useState("");
  const [customer, setCustomer] = useState(null);

  // Nachbuchen master data
  const [areas, setAreas] = useState([]);
  const [prodCats, setProdCats] = useState([]);
  const [masterServices, setMasterServices] = useState([]);
  const [masterProducts, setMasterProducts] = useState([]);

  // Nachbuchen UI
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState("products"); // products|services
  const [itemSearch, setItemSearch] = useState("");
  const [activeProductCatId, setActiveProductCatId] = useState("");
  const [activeAreaId, setActiveAreaId] = useState("");

  // cashier identity
  const [cashierStaffId, setCashierStaffId] = useState(() => usb.cashierStaffId || "");
  const cashierName = useMemo(() => {
    return (
      staff.find((s) => String(s.id) === String(cashierStaffId))?.name ||
      usb.cashierName ||
      ""
    );
  }, [staff, cashierStaffId, usb.cashierName]);

  // Global order note
  const [orderNoteOpen, setOrderNoteOpen] = useState(false);
  const [orderNote, setOrderNote] = useState("");

  // cart
  const [cart, setCart] = useState([]);

  // warning modal
  const [warnOpen, setWarnOpen] = useState(false);
  const [warnText, setWarnText] = useState("");
  const [pendingMethod, setPendingMethod] = useState("cash");

  // confirm void modal
  const [confirmVoidOpen, setConfirmVoidOpen] = useState(false);
  const [voidCandidate, setVoidCandidate] = useState(null);

  // customer loader modal
  const [pickOpen, setPickOpen] = useState(false);
  const [pickQ, setPickQ] = useState("");
  const [pickRows, setPickRows] = useState([]); // {visit, total, count, createdAt}

  // voucher modal
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherAmount, setVoucherAmount] = useState("");
  const [voucherNote, setVoucherNote] = useState("");

  // free item modal
  const [freeOpen, setFreeOpen] = useState(false);
  const [freeKind, setFreeKind] = useState("product"); // product|service
  const [freeTitle, setFreeTitle] = useState("");
  const [freePrice, setFreePrice] = useState("");
  const [freeQty, setFreeQty] = useState(1);
  const [freeAreaId, setFreeAreaId] = useState("");

  const missingStaffForService = useMemo(
    () => cart.some((l) => l.kind === "service" && !l.staffId),
    [cart]
  );

  const total = useMemo(
    () => cart.reduce((sum, l) => sum + Number(l.unitPrice) * Number(l.qty), 0),
    [cart]
  );

  async function loadCoreStatic() {
    const [st, a, sc, pc, pcats] = await Promise.all([
      db.staff.toArray().catch(() => []),
      db.areas ? db.areas.toArray().catch(() => []) : Promise.resolve([]),
      db.service_catalog ? db.service_catalog.toArray().catch(() => []) : Promise.resolve([]),
      db.product_catalog ? db.product_catalog.toArray().catch(() => []) : Promise.resolve([]),
      db.product_categories ? db.product_categories.toArray().catch(() => []) : Promise.resolve([]),
    ]);

    const cleanStaff = (st || [])
      .filter((x) => Number(x.active) === 1 || x.active === true)
      .sort((x, y) => String(x.name || "").localeCompare(String(y.name || "")));
    setStaff(cleanStaff);

    const aa = (a || []).filter((x) => Number(x.active) === 1 || x.active === true);
    aa.sort(
      (x, y) =>
        String(x.displayNo || "").localeCompare(String(y.displayNo || "")) ||
        String(x.name || "").localeCompare(String(y.name || ""))
    );
    setAreas(aa);

    const ppc = (pcats || []).filter((x) => Number(x.active) === 1 || x.active === true);
    ppc.sort(
      (x, y) =>
        String(x.displayNo || "").localeCompare(String(y.displayNo || "")) ||
        String(x.title || "").localeCompare(String(y.title || ""))
    );
    setProdCats(ppc);

    const svc = (sc || [])
      .filter((x) => Number(x.active) === 1 || x.active === true)
      .map((x) => ({
        id: String(x.id),
        areaId: String(x.areaId || ""),
        title: safeStr(x.name || x.title || "Service"),
        price: Number(x.price || 0),
        sortOrder: Number(x.sortOrder || 0),
      }))
      .sort(
        (x, y) => Number(x.sortOrder) - Number(y.sortOrder) || String(x.title).localeCompare(String(y.title))
      );
    setMasterServices(svc);

    const prd = (pc || [])
      .filter((x) => Number(x.active) === 1 || x.active === true)
      .map((x) => ({
        id: String(x.id),
        categoryId: String(x.categoryId || ""),
        title: safeStr(x.name || x.title || "Produkt"),
        price: Number(x.price || 0),
        sortOrder: Number(x.sortOrder || 0),
      }))
      .sort(
        (x, y) => Number(x.sortOrder) - Number(y.sortOrder) || String(x.title).localeCompare(String(y.title))
      );
    setMasterProducts(prd);

    setActiveAreaId((prev) => (prev && aa.some((z) => String(z.id) === String(prev)) ? prev : (aa[0]?.id ? String(aa[0].id) : "")));
    setActiveProductCatId((prev) => (prev && ppc.some((z) => String(z.id) === String(prev)) ? prev : (ppc[0]?.id ? String(ppc[0].id) : "")));
    setFreeAreaId((prev) => (prev && aa.some((z) => String(z.id) === String(prev)) ? prev : (aa[0]?.id ? String(aa[0].id) : "")));
  }

  async function loadVisitIntoPage(vid) {
    if (!vid) {
      setVisit(null);
      setCustomerId("");
      setCustomer(null);
      setOrderNote("");
      setCart([]);
      return;
    }

    const [v, vs, vp] = await Promise.all([
      db.visits.get(String(vid)).catch(() => null),
      db.visit_services.where("visitId").equals(String(vid)).toArray().catch(() => []),
      db.visit_products.where("visitId").equals(String(vid)).toArray().catch(() => []),
    ]);

    setVisit(v || null);
    const cid = v?.customerId ? String(v.customerId) : "";
    setCustomerId(cid);
    setOrderNote(safeStr(v?.note || ""));

    if (cid) {
      const c = await db.customers.get(String(cid)).catch(() => null);
      setCustomer(c || null);
    } else {
      setCustomer(null);
    }

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
        staffId: safeStr(p.staffId),
        staffName: safeStr(p.staffName),
        memberId: String(p.memberId || "primary"),
        sourceId: String(p.id || ""),
        fromVisit: true,
        areaId: "",
      });
    }

    cartLines.sort((x, y) => {
      const kn = String(x.kind).localeCompare(String(y.kind));
      if (kn !== 0) return kn;
      return String(x.title || "").localeCompare(String(y.title || ""));
    });

    setCart(cartLines);
  }

  async function loadAll() {
    try {
      setLoadError("");
      await loadCoreStatic();
      await loadVisitIntoPage(activeVisitId);
    } catch (e) {
      console.error(e);
      setLoadError(String(e?.message || e));
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVisitId]);

  // Keep URL param in sync (optional, but helpful)
  useEffect(() => {
    // if user came with param, keep; when cleared, remove
    const cur = new URLSearchParams(loc.search);
    if (activeVisitId) cur.set("visitId", String(activeVisitId));
    else cur.delete("visitId");
    nav({ pathname: loc.pathname, search: cur.toString() ? `?${cur.toString()}` : "" }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVisitId]);

  function updateLine(id, patch) {
    setCart((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function requestVoid(line) {
    if (!line) return;
    setVoidCandidate(line);
    setConfirmVoidOpen(true);
  }

  async function confirmVoid() {
    const line = voidCandidate;
    setConfirmVoidOpen(false);
    setVoidCandidate(null);

    if (!line) return;
    if (!activeVisitId) return;

    if (!cashierStaffId) {
      alert("Bitte Kassierer auswählen (USB oder Liste).");
      return;
    }

    const areaTimings = await buildAreaTimingSnapshot({
      visitId: activeVisitId,
      dateKey,
      visitCreatedAt: safeStr(visit?.createdAt),
    });

    await logVoid({
      dateKey,
      visitId: activeVisitId,
      customerId,
      line,
      cashierStaffId,
      cashierName,
      orderNote,
      areaTimings,
    });

    setCart((prev) => prev.filter((x) => x.id !== line.id));
  }

  function addServiceToCart(svc) {
    setCart((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        kind: "service",
        title: svc.title,
        unitPrice: Number(svc.price || 0),
        qty: 1,
        staffId: "",
        staffName: "",
        memberId: "primary",
        sourceId: "",
        fromVisit: false,
        areaId: String(svc.areaId || ""),
      },
    ]);
  }

  function addProductToCart(prod) {
    setCart((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        kind: "product",
        title: prod.title,
        unitPrice: Number(prod.price || 0),
        qty: 1,
        staffId: "",
        staffName: "",
        memberId: "primary",
        sourceId: "",
        fromVisit: false,
        areaId: "",
      },
    ]);
  }

  function openFreeItem() {
    setFreeKind("product");
    setFreeTitle("");
    setFreePrice("");
    setFreeQty(1);
    setFreeOpen(true);
  }

  function addFreeItemToCart() {
    const t = safeStr(freeTitle);
    const p = Number(freePrice);
    const q = clampInt(freeQty, 1, 99);

    if (!t) return;
    if (!Number.isFinite(p) || p < 0) return;

    if (freeKind === "service") {
      setCart((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          kind: "service",
          title: t,
          unitPrice: Number(p.toFixed(2)),
          qty: 1,
          staffId: "",
          staffName: "",
          memberId: "primary",
          sourceId: "",
          fromVisit: false,
          areaId: String(freeAreaId || ""),
          isFreeText: true,
        },
      ]);
    } else {
      setCart((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          kind: "product",
          title: t,
          unitPrice: Number(p.toFixed(2)),
          qty: q,
          staffId: "",
          staffName: "",
          memberId: "primary",
          sourceId: "",
          fromVisit: false,
          areaId: "",
          isFreeText: true,
        },
      ]);
    }

    setFreeOpen(false);
  }

  const addTabs = useMemo(
    () => [
      { value: "products", label: "Produkte" },
      { value: "services", label: "Services" },
    ],
    []
  );

  const areaTabs = useMemo(() => {
    return (areas || []).map((a) => ({
      value: String(a.id),
      label: safeStr(a.name) || "Bereich",
    }));
  }, [areas]);

  const productCatTabs = useMemo(() => {
    return (prodCats || []).map((c) => ({
      value: String(c.id),
      label: safeStr(c.title) || "Kategorie",
    }));
  }, [prodCats]);

  const filteredServices = useMemo(() => {
    const s = itemSearch.trim().toLowerCase();
    return masterServices
      .filter((x) => (activeAreaId ? String(x.areaId) === String(activeAreaId) : true))
      .filter((x) => (s ? String(x.title || "").toLowerCase().includes(s) : true))
      .slice(0, 36);
  }, [masterServices, activeAreaId, itemSearch]);

  const filteredProducts = useMemo(() => {
    const s = itemSearch.trim().toLowerCase();
    return masterProducts
      .filter((x) => (activeProductCatId ? String(x.categoryId) === String(activeProductCatId) : true))
      .filter((x) => (s ? String(x.title || "").toLowerCase().includes(s) : true))
      .slice(0, 36);
  }, [masterProducts, activeProductCatId, itemSearch]);

  async function proceedToCheckoutIfAllowed(method) {
    if (!activeVisitId) return;

    if (!cashierStaffId) {
      alert("Bitte Kassierer auswählen (USB oder Liste).");
      return;
    }

    const r = await computeVisitReadiness(activeVisitId, dateKey);
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

  function resetAfterCheckout() {
    // stay on same page, just clear loaded visit
    setAddOpen(false);
    setItemSearch("");
    setOrderNote("");
    setCart([]);
    setVisit(null);
    setCustomerId("");
    setCustomer(null);
    setActiveVisitId(""); // clears URL param via effect
  }

  async function checkout(method) {
    if (!cart.length) return;
    if (missingStaffForService) return;
    if (!activeVisitId) return;

    const now = new Date().toISOString();
    const dk = toDateKeyISO(new Date());
    const staffById = new Map(staff.map((s) => [String(s.id), s]));

    const summaryLines = cart.map((l) => ({
      kind: String(l.kind),
      title: String(l.title || ""),
      qty: Number(l.qty || 1),
      unitPrice: Number(Number(l.unitPrice || 0).toFixed(2)),
      lineTotal: Number((Number(l.unitPrice || 0) * Number(l.qty || 1)).toFixed(2)),
      staffId: String(l.staffId || ""),
      staffName: String(l.staffName || ""),
      areaId: String(l.areaId || ""),
      memberId: String(l.memberId || "primary"),
      fromVisit: !!l.fromVisit,
      sourceId: String(l.sourceId || ""),
      isFreeText: !!l.isFreeText,
    }));

    await db.transaction(
      "rw",
      db.visit_services,
      db.visit_products,
      db.payments_today,
      db.visits,
      db.customer_history,
      db.customers,
      async () => {
        // (A) sync cart into visit tables
        for (const l of cart) {
          const isService = l.kind === "service";
          const sid = safeStr(l.staffId);
          const sn = sid ? staffById.get(String(sid))?.name || "" : "";

          if (l.fromVisit) {
            if (isService && l.sourceId) {
              await db.visit_services.update(String(l.sourceId), {
                price: Number(Number(l.unitPrice || 0).toFixed(2)),
                staffId: sid || null,
                staffName: sn,
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
            if (isService) {
              await db.visit_services.add({
                id: crypto.randomUUID(),
                visitId: String(activeVisitId),
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
                visitId: String(activeVisitId),
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
            visitId: String(activeVisitId),
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

        // (C) close visit + global note
        await db.visits.update(String(activeVisitId), {
          status: "closed",
          readyForCheckoutAt: safeStr(visit?.readyForCheckoutAt) || now,
          closedAt: now,
          cashierStaffId: String(cashierStaffId || ""),
          cashierName: String(cashierName || ""),
          note: safeStr(orderNote || ""),
        });

        // (D) customer_history: CHECKOUT summary (last order source)
        if (customerId) {
          const areaTimings = await buildAreaTimingSnapshot({
            visitId: activeVisitId,
            dateKey: dk,
            visitCreatedAt: safeStr(visit?.createdAt),
          });

          await db.customer_history.add({
            id: crypto.randomUUID(),
            customerId: String(customerId),
            createdAt: now,
            visitId: String(activeVisitId),
            type: "CHECKOUT",
            payload: {
              method: String(method),
              total: Number(total.toFixed(2)),
              cashierStaffId: String(cashierStaffId || ""),
              cashierName: String(cashierName || ""),
              note: safeStr(orderNote || ""),
              lines: summaryLines,
              areaTimings,
            },
          });

          // update customer “last visit” signals (smart + future-proof)
          const firstServiceWithStaff = summaryLines.find((x) => x.kind === "service" && x.staffId);
          await db.customers.update(String(customerId), {
            lastVisitAt: now,
            lastServedByStaffId: firstServiceWithStaff?.staffId || "",
            lastServedByStaffName: firstServiceWithStaff?.staffName || "",
            updatedAt: now,
          });
        }
      }
    );

    // Stay on page
    alert("Checkout erfolgreich.");
    resetAfterCheckout();
  }

  // ===== Customer Picker (Open Visits) =====
  async function openCustomerPicker() {
    setPickQ("");
    setPickRows([]);
    setPickOpen(true);

    try {
      // “Checked in” ≈ not closed; scope to current dateKey for cashier clarity.
      const visits = await db.visits
        .where("dateKey")
        .equals(String(dateKey))
        .toArray()
        .catch(() => []);

      const open = (visits || []).filter((v) => String(v.status || "") !== "closed");
      open.sort((a, b) => (String(a.createdAt || "") < String(b.createdAt || "") ? 1 : -1));

      // Compute totals efficiently
      const rows = await Promise.all(
        open.slice(0, 60).map(async (v) => {
          const [vs, vp] = await Promise.all([
            db.visit_services.where("visitId").equals(String(v.id)).toArray().catch(() => []),
            db.visit_products.where("visitId").equals(String(v.id)).toArray().catch(() => []),
          ]);
          const sum =
            (vs || []).reduce((s, x) => s + Number(x.price || 0), 0) +
            (vp || []).reduce((s, x) => s + Number(x.price || 0) * Number(x.qty || 1), 0);

          return {
            visit: v,
            createdAt: String(v.createdAt || ""),
            count: (vs?.length || 0) + (vp?.length || 0),
            total: Number(sum.toFixed(2)),
          };
        })
      );

      setPickRows(rows);
    } catch (e) {
      console.error(e);
      setPickRows([]);
    }
  }

  const pickFiltered = useMemo(() => {
    const s = pickQ.trim().toLowerCase();
    if (!s) return pickRows;
    return (pickRows || []).filter((r) => {
      const v = r?.visit || {};
      const hay = [v.displayName, v.id, v.status, r.count, r.total]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(s);
    });
  }, [pickRows, pickQ]);

  async function selectVisitFromPicker(v) {
    if (!v?.id) return;
    setPickOpen(false);
    setActiveVisitId(String(v.id));
  }

  // ===== Voucher creation inside cashier =====
  function openVoucherModal() {
    if (!customerId) {
      alert("Bitte zuerst einen Kunden/Visit laden, um einen Gutschein zu erstellen.");
      return;
    }
    setVoucherAmount("");
    setVoucherNote("");
    setVoucherOpen(true);
  }

  async function createVoucherForCustomer() {
    const amt = Number(voucherAmount);
    if (!customerId) return;
    if (!Number.isFinite(amt) || amt <= 0) return;

    if (!db?.vouchers) {
      alert("Tabelle vouchers ist nicht verfügbar. Bitte db/index.js prüfen.");
      return;
    }

    const now = new Date().toISOString();
    const code = await generateUniqueVoucherCode("SBL");

    await db.transaction("rw", db.vouchers, db.customer_history, async () => {
      await db.vouchers.put({
        id: crypto.randomUUID(),
        code,
        status: "active",
        amount: Number(amt.toFixed(2)),
        currency: "EUR",
        customerId: String(customerId),

        createdAt: now,
        createdByStaffId: String(cashierStaffId || "cashier"),
        createdByStaffName: String(cashierName || "Kasse"),

        redeemedAt: "",
        redeemedByStaffId: "",
        redeemedByStaffName: "",
        redeemedVisitId: "",

        note: safeStr(voucherNote || ""),
      });

      await db.customer_history.add({
        id: crypto.randomUUID(),
        customerId: String(customerId),
        createdAt: now,
        visitId: String(activeVisitId || ""),
        type: "VOUCHER_CREATED",
        payload: {
          code,
          amount: Number(amt.toFixed(2)),
          currency: "EUR",
          note: safeStr(voucherNote || ""),
          cashierStaffId: String(cashierStaffId || ""),
          cashierName: String(cashierName || ""),
        },
      });
    });

    setVoucherOpen(false);
    alert(`Gutschein erstellt: ${code}`);
  }

  // ===== Print / Email =====
  function onPrintReceipt(methodHint) {
    const text = buildReceiptText({
      visit,
      customer,
      cart,
      total,
      method: methodHint || "",
      cashierName,
      orderNote,
    });
    openPrintWindow(text);
  }

  function onEmailReceipt(methodHint) {
    const email = safeStr(customer?.email || "");
    if (!email) {
      alert("Kunde hat keine E-Mail-Adresse im Profil.");
      return;
    }

    const body = buildReceiptText({
      visit,
      customer,
      cart,
      total,
      method: methodHint || "",
      cashierName,
      orderNote,
    });

    const subject = `Sibel Salon – Rechnung ${new Date().toISOString().slice(0, 10)}`;
    const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
  }

  const headerName = useMemo(() => {
    if (!visit) return "Kasse · Checkout";
    // IMPORTANT: user wants page to be able to “empty” after checkout → when visit null, no name.
    return `Kasse · ${safeStr(visit.displayName) || "Checkout"}`;
  }, [visit]);

  const subtitle = useMemo(() => {
    const n = cart.length;
    return `${n} Position${n === 1 ? "" : "en"} · Total: ${money(total)} €`;
  }, [cart.length, total]);

  const voidTitle = useMemo(() => {
    if (!voidCandidate) return "";
    const q = Number(voidCandidate.qty || 1);
    const t = safeStr(voidCandidate.title || "");
    return `${t}${q > 1 ? ` (x${q})` : ""}`;
  }, [voidCandidate]);

  const canOperate = !!cashierStaffId;
  const canCheckout = !!activeVisitId && cart.length > 0 && !missingStaffForService && !!cashierStaffId;

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.top}>
          <div>
            <div className={styles.h1}>{headerName}</div>
            <div className={styles.sub}>
              Visit: <b>{activeVisitId ? String(activeVisitId).slice(-8) : "—"}</b> · {subtitle}
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
              className={styles.btnPrimary}
              type="button"
              onClick={openCustomerPicker}
              disabled={!canOperate}
              title={!canOperate ? "Bitte Kassierer wählen" : "Aktuelle Kunden/Visits laden"}
            >
              Kunden laden
            </button>

            <button className={styles.btnGhost} type="button" onClick={() => nav("/reception/liveboard")}>
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

        {!activeVisitId ? (
          <div className={styles.card} style={{ marginTop: 12 }}>
            <div className={styles.empty}>
              Kein Kunde geladen. Klicke oben auf <b>„Kunden laden“</b>, um eingecheckte Kunden auszuwählen.
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
                  Artikel nach links <b>ziehen</b> = Storno (Bestätigung + Speicherung). Preis editierbar.
                </div>
              </div>
              {/* intentionally removed total badge here (user requested) */}
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
                      <SwipeRow key={l.id} onRequestVoid={() => requestVoid(l)}>
                        <div className={styles.trRow}>
                          <div className={styles.colType}>
                            <span className={styles.badgeKindMini}>{l.kind === "service" ? "S" : "P"}</span>
                          </div>

                          <div>
                            <div className={styles.bold}>{l.title}</div>
                            <div className={styles.rowMeta}>
                              {l.fromVisit ? (
                                <span className={styles.chip}>Visit</span>
                              ) : (
                                <span className={styles.chipMuted}>Nachgebucht</span>
                              )}
                              {l.isFreeText ? <span className={styles.chipMuted}>Freitext</span> : null}
                            </div>
                          </div>

                          <div>
                            <select
                              className={`${styles.select} ${empMissing ? styles.selectError : ""}`}
                              value={l.staffId}
                              onChange={(e) => {
                                const sid = e.target.value;
                                const sn = staff.find((s) => String(s.id) === String(sid))?.name || "";
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
                              onClick={() => updateLine(l.id, { qty: clampInt(Number(l.qty) - 1, 1, 99) })}
                            >
                              −
                            </button>
                            <div className={styles.qtyVal}>x{clampInt(l.qty, 1, 99)}</div>
                            <button
                              type="button"
                              className={styles.qtyBtn}
                              onClick={() => updateLine(l.id, { qty: clampInt(Number(l.qty) + 1, 1, 99) })}
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

            {/* NACHBUCHEN (collapsible) */}
            <div className={styles.addBox}>
              <div className={styles.addTopRow}>
                <div>
                  <div className={styles.cardTitle}>Nachbuchen</div>
                  <div className={styles.smallMuted}>
                    Zusätzliche Leistungen/Produkte direkt zur Rechnung hinzufügen. Optional: Freie Position / Gutschein.
                  </div>
                </div>

                <div className={styles.addActions}>
                  <button className={styles.btnGhost} type="button" onClick={openFreeItem} disabled={!activeVisitId}>
                    + Freie Position
                  </button>
                  <button className={styles.btnGhost} type="button" onClick={openVoucherModal} disabled={!activeVisitId}>
                    + Gutschein
                  </button>
                  <button
                    className={styles.btnPrimary}
                    type="button"
                    onClick={() => setAddOpen((p) => !p)}
                    aria-expanded={addOpen ? "true" : "false"}
                    disabled={!activeVisitId}
                  >
                    {addOpen ? "Schließen" : "Nachbuchen öffnen"}
                  </button>
                </div>
              </div>

              {addOpen ? (
                <div style={{ marginTop: 12 }}>
                  <div className={styles.addHead}>
                    <div className={styles.searchWrap}>
                      <input
                        className={styles.search}
                        value={itemSearch}
                        onChange={(e) => setItemSearch(e.target.value)}
                        placeholder="Suchen…"
                      />
                    </div>
                  </div>

                  <PillTabs value={addMode} onChange={setAddMode} tabs={addTabs} ariaLabel="Nachbuchen Typ" />

                  {addMode === "products" ? (
                    <>
                      <PillTabs
                        value={activeProductCatId}
                        onChange={setActiveProductCatId}
                        tabs={productCatTabs}
                        ariaLabel="Produktkategorien"
                      />

                      <div className={styles.itemsGrid}>
                        {filteredProducts.length === 0 ? (
                          <div className={styles.empty}>Keine Produkte gefunden.</div>
                        ) : (
                          filteredProducts.map((it) => (
                            <button
                              key={`p-${it.id}`}
                              type="button"
                              className={styles.itemCard}
                              onClick={() => addProductToCart(it)}
                            >
                              <div className={styles.itemTop}>
                                <div>
                                  <div className={styles.itemTitle}>{it.title}</div>
                                  <div className={styles.itemMeta}>Produkt</div>
                                </div>
                                <div className={styles.itemPrice}>{money(it.price)} €</div>
                              </div>
                              <div className={styles.itemBtn}>Hinzufügen</div>
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <PillTabs value={activeAreaId} onChange={setActiveAreaId} tabs={areaTabs} ariaLabel="Bereiche" />

                      <div className={styles.itemsGrid}>
                        {filteredServices.length === 0 ? (
                          <div className={styles.empty}>Keine Services gefunden.</div>
                        ) : (
                          filteredServices.map((it) => (
                            <button
                              key={`s-${it.id}`}
                              type="button"
                              className={styles.itemCard}
                              onClick={() => addServiceToCart(it)}
                            >
                              <div className={styles.itemTop}>
                                <div>
                                  <div className={styles.itemTitle}>{it.title}</div>
                                  <div className={styles.itemMeta}>Service</div>
                                </div>
                                <div className={styles.itemPrice}>{money(it.price)} €</div>
                              </div>
                              <div className={styles.itemBtn}>Hinzufügen</div>
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : null}
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
                  <button
                    className={styles.btnGhost}
                    type="button"
                    onClick={() => setOrderNoteOpen(true)}
                    disabled={!activeVisitId}
                  >
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
                  disabled={!canCheckout}
                  onClick={() => proceedToCheckoutIfAllowed("cash")}
                >
                  CASH
                </button>

                <button
                  className={styles.btnPay}
                  type="button"
                  disabled={!canCheckout}
                  onClick={() => proceedToCheckoutIfAllowed("card")}
                >
                  CARD
                </button>
              </div>

              <div className={styles.toolRow}>
                <button
                  className={styles.btnGhost}
                  type="button"
                  onClick={() => onPrintReceipt("")}
                  disabled={!activeVisitId}
                >
                  Drucken
                </button>
                <button
                  className={styles.btnGhost}
                  type="button"
                  onClick={() => onEmailReceipt("")}
                  disabled={!activeVisitId || !safeStr(customer?.email)}
                  title={!safeStr(customer?.email) ? "Keine Kunden-E-Mail vorhanden" : "Rechnung per E-Mail"}
                >
                  Per E-Mail
                </button>
              </div>

              <div className={styles.smallMuted}>
                Checkout setzt Visit auf <b>closed</b>, schreibt <b>payments_today</b> und speichert die Bestellung im Kundenprofil.
              </div>
            </div>
          </div>
        </div>

        {/* Warn modal */}
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

        {/* Confirm void modal */}
        {confirmVoidOpen ? (
          <div className={styles.modalOverlay} role="dialog" aria-modal="true">
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <div>
                  <div className={styles.modalTitle}>Artikel stornieren?</div>
                  <div className={styles.modalSub}>
                    <b>{voidTitle || "Artikel"}</b> wird aus der Rechnung entfernt und als Storno gespeichert.
                  </div>
                </div>
                <button className={styles.closeBtn} type="button" onClick={() => setConfirmVoidOpen(false)}>
                  ✕
                </button>
              </div>

              <div className={styles.modalBody}>
                <div className={styles.smallMuted}>
                  Tippfehler-Schutz: Storno erfolgt erst nach Bestätigung.
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button className={styles.btnGhost} type="button" onClick={() => setConfirmVoidOpen(false)}>
                  Abbrechen
                </button>
                <button className={styles.btnPrimary} type="button" onClick={confirmVoid}>
                  Stornieren
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

        {/* Customer picker modal */}
        {pickOpen ? (
          <div className={styles.modalOverlay} role="dialog" aria-modal="true">
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <div>
                  <div className={styles.modalTitle}>Kunden/Visits laden</div>
                  <div className={styles.modalSub}>Alle offenen Visits für {dateKey}. Klick lädt die Bestellung zur Zahlung.</div>
                </div>
                <button className={styles.closeBtn} type="button" onClick={() => setPickOpen(false)}>
                  ✕
                </button>
              </div>

              <div className={styles.modalBody}>
                <input
                  className={styles.search}
                  value={pickQ}
                  onChange={(e) => setPickQ(e.target.value)}
                  placeholder="Suche: Name, Status, Betrag…"
                />

                <div className={styles.pickList}>
                  {pickFiltered.length === 0 ? (
                    <div className={styles.empty}>Keine offenen Visits gefunden.</div>
                  ) : (
                    pickFiltered.map((r) => {
                      const v = r.visit;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          className={styles.pickRow}
                          onClick={() => selectVisitFromPicker(v)}
                        >
                          <div>
                            <div className={styles.pickName}>{safeStr(v.displayName) || "Kunde"}</div>
                            <div className={styles.pickMeta}>
                              Visit: {String(v.id).slice(-8)} · Status: {safeStr(v.status || "open")} · Pos: {r.count}
                            </div>
                          </div>
                          <div className={styles.pickAmount}>{money(r.total)} €</div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button className={styles.btnGhost} type="button" onClick={() => setPickOpen(false)}>
                  Schließen
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Voucher modal */}
        {voucherOpen ? (
          <div className={styles.modalOverlay} role="dialog" aria-modal="true">
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <div>
                  <div className={styles.modalTitle}>Gutschein erstellen</div>
                  <div className={styles.modalSub}>
                    Für <b>{customer ? `${safeStr(customer.firstName)} ${safeStr(customer.lastName)}`.trim() : (visit?.displayName || "Kunde")}</b>.
                    Betrag frei wählbar. Code wird automatisch generiert.
                  </div>
                </div>
                <button className={styles.closeBtn} type="button" onClick={() => setVoucherOpen(false)}>
                  ✕
                </button>
              </div>

              <div className={styles.modalBody}>
                <div className={styles.formGrid2}>
                  <label className={styles.field}>
                    <span className={styles.label2}>Betrag (€) *</span>
                    <input
                      className={styles.input2}
                      value={voucherAmount}
                      onChange={(e) => setVoucherAmount(e.target.value)}
                      placeholder="z. B. 50"
                      inputMode="decimal"
                    />
                  </label>

                  <label className={styles.fieldWide}>
                    <span className={styles.label2}>Notiz (optional)</span>
                    <input
                      className={styles.input2}
                      value={voucherNote}
                      onChange={(e) => setVoucherNote(e.target.value)}
                      placeholder="z. B. Anlass, Kunde, interne Info…"
                    />
                  </label>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button className={styles.btnGhost} type="button" onClick={() => setVoucherOpen(false)}>
                  Abbrechen
                </button>
                <button className={styles.btnPrimary} type="button" onClick={createVoucherForCustomer}>
                  Erstellen
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Free item modal */}
        {freeOpen ? (
          <div className={styles.modalOverlay} role="dialog" aria-modal="true">
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <div>
                  <div className={styles.modalTitle}>Freie Position verkaufen</div>
                  <div className={styles.modalSub}>
                    Für Sonderfälle (Freitext + freier Preis). Ideal für spontane Behandlungen oder individuelle Produkte.
                  </div>
                </div>
                <button className={styles.closeBtn} type="button" onClick={() => setFreeOpen(false)}>
                  ✕
                </button>
              </div>

              <div className={styles.modalBody}>
                <PillTabs
                  value={freeKind}
                  onChange={setFreeKind}
                  tabs={[
                    { value: "product", label: "Produkt" },
                    { value: "service", label: "Service" },
                  ]}
                  ariaLabel="Freie Position Typ"
                />

                {freeKind === "service" ? (
                  <div style={{ marginBottom: 10 }}>
                    <PillTabs value={freeAreaId} onChange={setFreeAreaId} tabs={areaTabs} ariaLabel="Bereich" />
                  </div>
                ) : null}

                <div className={styles.formGrid2}>
                  <label className={styles.fieldWide}>
                    <span className={styles.label2}>Titel *</span>
                    <input
                      className={styles.input2}
                      value={freeTitle}
                      onChange={(e) => setFreeTitle(e.target.value)}
                      placeholder={freeKind === "service" ? "z. B. Sonderbehandlung" : "z. B. Spezialprodukt"}
                    />
                  </label>

                  <label className={styles.field}>
                    <span className={styles.label2}>Preis (€) *</span>
                    <input
                      className={styles.input2}
                      value={freePrice}
                      onChange={(e) => setFreePrice(e.target.value)}
                      placeholder="z. B. 25"
                      inputMode="decimal"
                    />
                  </label>

                  {freeKind === "product" ? (
                    <label className={styles.field}>
                      <span className={styles.label2}>Menge</span>
                      <input
                        className={styles.input2}
                        type="number"
                        min="1"
                        max="99"
                        value={freeQty}
                        onChange={(e) => setFreeQty(clampInt(e.target.value, 1, 99))}
                      />
                    </label>
                  ) : null}
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button className={styles.btnGhost} type="button" onClick={() => setFreeOpen(false)}>
                  Abbrechen
                </button>
                <button className={styles.btnPrimary} type="button" onClick={addFreeItemToCart}>
                  Hinzufügen
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
