// src/features/kiosk/pages/KioskOrderEmbed.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../../db/index.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";
import { createVisitFromOrder } from "../api/orderApi.js";
import styles from "./KioskOrderEmbed.module.css";
import { Euro, Trash2, RotateCcw, ChevronDown, ChevronUp, X } from "lucide-react";

export default function KioskOrderEmbed({ profile, onDone, onCancel, draftId }) {
  // LEFT NAV TABS
  // treatment | staff | products | notes | summary
  const [tab, setTab] = useState("treatment");

  // SUMMARY SUB TABS
  // active | void
  const [cartTab, setCartTab] = useState("active");

  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [areas, setAreas] = useState([]);
  const [productCategories, setProductCategories] = useState([]);

  // Auswahl (aktive Positionen)
  // IMPORTANT: selectedServiceIds stores STRING ids only
  const [selectedServiceIds, setSelectedServiceIds] = useState(new Set());
  const [preferredStaffByArea, setPreferredStaffByArea] = useState({});
  const [preferredStaffByService, setPreferredStaffByService] = useState({});
  const [preferredStaffByProduct, setPreferredStaffByProduct] = useState({});
  const [comment, setComment] = useState(profile?.note || "");
  const [cart, setCart] = useState([]);

  // Storniert (Positionen die in "Storniert"-Tab erscheinen)
  const [voidedServices, setVoidedServices] = useState([]);
  const [voidedProducts, setVoidedProducts] = useState([]);

  // Orange-Markierung: was war bereits im bestehenden Visit?
  const [existingServiceIds, setExistingServiceIds] = useState(new Set());
  const [existingProductIds, setExistingProductIds] = useState(new Set());

  // Filter
  const [serviceAreaId, setServiceAreaId] = useState("");
  const [productCategoryId, setProductCategoryId] = useState("");

  // “Alle anzeigen” Toggles
  const [showAllAreas, setShowAllAreas] = useState(false);
  const [showAllServices, setShowAllServices] = useState(false);
  const [showAllProducts, setShowAllProducts] = useState(false);

  // GLOBAL SEARCH (nur Behandlungen + Produkte)
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalOpen, setGlobalOpen] = useState(false);

  // Draft meta
  const [activeDraftId, setActiveDraftId] = useState(draftId || "");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");

  // Price overrides for services (aktive Services)
  const [servicePriceOverrides, setServicePriceOverrides] = useState({});

  // Most booked (local stats)
  const [topServiceIdsByArea, setTopServiceIdsByArea] = useState({});
  const [topProductIdsByCat, setTopProductIdsByCat] = useState({});

  // Staff recents (local memory)
  // key = `${areaId}::${serviceId}` => [staffId...]
  const [recentStaffMap, setRecentStaffMap] = useState({});
  // key = `${productId}` => [staffId...]
  const [recentProductStaffMap, setRecentProductStaffMap] = useState({});

  // Debounce save
  const saveTimer = useRef(null);
  const lastSavedHash = useRef("");

  const editVisitId = String(profile?.meta?.visitId || "");
  const isEdit = !!profile?.meta?.isEdit || !!editVisitId;

  useEffect(() => setComment(profile?.note || ""), [profile]);

  /** ================= Utils ================= */
  function safeJson(s, fallback) {
    try {
      const x = JSON.parse(String(s || ""));
      return x == null ? fallback : x;
    } catch {
      return fallback;
    }
  }

  function dedupeStaffRows(rows) {
  const all = Array.isArray(rows) ? rows : [];
  const norm = (x) => String(x || "").trim().toLowerCase();

  const roleRank = (s) => {
    const r = String(s?.role || "").toLowerCase();
    if (r === "admin") return 3;
    if (r === "cashier") return 2;
    return 1;
  };

  const byName = new Map(); // nameKey -> staffRow
  for (const s of all) {
    const nameKey = norm(s?.name);
    if (!nameKey) continue;

    const cur = byName.get(nameKey);
    if (!cur) {
      byName.set(nameKey, s);
      continue;
    }

    // keep higher rank, otherwise keep the first
    if (roleRank(s) > roleRank(cur)) byName.set(nameKey, s);
  }

  return Array.from(byName.values());
}

  function uid(prefix = "id") {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  function staffNameById(staffId) {
    const id = String(staffId || "");
    if (!id) return "";
    const found = staff.find((s) => String(s.id) === id);
    return found?.name ? String(found.name) : "";
  }

  function areaNameById(areaId) {
    const id = String(areaId || "");
    if (!id) return "";
    const found = areas.find((a) => String(a.id) === id);
    return found?.name ? String(found.name) : id;
  }

  function categoryNameById(categoryId) {
    const id = String(categoryId || "");
    if (!id) return "";
    const found = productCategories.find((c) => String(c.id) === id);
    return String(found?.title || found?.name || id);
  }

  function parseMoneyInput(raw) {
    const s = String(raw ?? "").trim().replace(",", ".");
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return Number(n.toFixed(2));
  }

  function clampInt(n, min, max) {
    const x = Math.trunc(Number(n));
    if (!Number.isFinite(x)) return min;
    return Math.min(max, Math.max(min, x));
  }

  function norm(s) {
    return String(s || "").toLowerCase().trim();
  }

  function loadRecentStaff() {
    try {
      const raw = localStorage.getItem("kiosk_recent_staff_by_service");
      const obj = raw ? JSON.parse(raw) : {};
      if (obj && typeof obj === "object") setRecentStaffMap(obj);
    } catch {}
  }

  function loadRecentProductStaff() {
    try {
      const raw = localStorage.getItem("kiosk_recent_staff_by_product");
      const obj = raw ? JSON.parse(raw) : {};
      if (obj && typeof obj === "object") setRecentProductStaffMap(obj);
    } catch {}
  }

  function rememberRecentProductStaff(productId, staffId) {
    const pid = String(productId || "");
    const sid = String(staffId || "");
    if (!pid || !sid) return;

    setRecentProductStaffMap((prev) => {
      const cur = Array.isArray(prev?.[pid]) ? prev[pid] : [];
      const next = [sid, ...cur.filter((x) => String(x) !== sid)].filter(Boolean).slice(0, 10);
      const merged = { ...(prev || {}), [pid]: next };
      try {
        localStorage.setItem("kiosk_recent_staff_by_product", JSON.stringify(merged));
      } catch {}
      return merged;
    });
  }

  function setStaffForProduct(productId, staffId) {
    const pid = String(productId || "");
    const sid = String(staffId || "");
    setPreferredStaffByProduct((p) => ({ ...(p || {}), [pid]: sid }));
    if (pid && sid) rememberRecentProductStaff(pid, sid);
  }

  function rememberRecentStaff(areaId, serviceId, staffId) {
    const a = String(areaId || "");
    const sv = String(serviceId || "");
    const s = String(staffId || "");
    if (!a || !sv || !s) return;
    const key = `${a}::${sv}`;

    setRecentStaffMap((prev) => {
      const cur = Array.isArray(prev?.[key]) ? prev[key] : [];
      const next = [s, ...cur.filter((x) => String(x) !== s)].filter(Boolean).slice(0, 10);
      const merged = { ...(prev || {}), [key]: next };
      try {
        localStorage.setItem("kiosk_recent_staff_by_service", JSON.stringify(merged));
      } catch {}
      return merged;
    });
  }

  function setStaffForService(serviceId, areaId, staffId) {
    const sid = String(serviceId || "");
    const aid = String(areaId || "");
    const st = String(staffId || "");

    setPreferredStaffByService((p) => ({ ...(p || {}), [sid]: st }));

    // Fallback fürs bestehende System (pro Bereich)
    if (aid) setPreferredStaffByArea((p) => ({ ...(p || {}), [aid]: st }));

    if (aid && sid && st) rememberRecentStaff(aid, sid, st);
  }

  /** ============== Load catalogs ============== */
  useEffect(() => {
    db.areas.toArray().then((rows) => {
      const list = (rows || [])
        .filter((a) => a.active === 1 || a.active === true)
        .sort((a, b) => Number(a.displayNo || 9999) - Number(b.displayNo || 9999));
      setAreas(list);
    });

    db.product_categories.toArray().then((rows) => {
      const list = (rows || [])
        .filter((c) => c.active === 1 || c.active === true)
        .sort((a, b) => Number(a.displayNo || 9999) - Number(b.displayNo || 9999));
      setProductCategories(list);
    });

    db.service_catalog.toArray().then((rows) => {
      const list = (rows || [])
        .filter((s) => s.active === 1 || s.active === true)
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
      setServices(list);
    });

    db.product_catalog.toArray().then((rows) => {
      const list = (rows || [])
        .filter((p) => p.active === 1 || p.active === true)
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
      setProducts(list);
    });

    db.staff.toArray().then((rows) => setStaff(dedupeStaffRows(rows || [])));

    loadRecentStaff();
    loadRecentProductStaff();
  }, []);

  /** ============== Default chips ============== */
  useEffect(() => {
    if (!serviceAreaId) {
      const first = areas.find((a) => services.some((s) => String(s.areaId) === String(a.id)));
      if (first?.id) setServiceAreaId(first.id);
      else if (areas[0]?.id) setServiceAreaId(areas[0].id);
    }
  }, [areas, services, serviceAreaId]);

  useEffect(() => {
    if (!productCategoryId) {
      const first = productCategories.find((c) => products.some((p) => String(p.categoryId) === String(c.id)));
      if (first?.id) setProductCategoryId(first.id);
      else if (productCategories[0]?.id) setProductCategoryId(productCategories[0].id);
    }
  }, [productCategories, products, productCategoryId]);

  // when switching area/category, keep UI simple first
  useEffect(() => setShowAllServices(false), [serviceAreaId]);
  useEffect(() => setShowAllProducts(false), [productCategoryId]);

  const displayName = useMemo(() => {
    const n = String(profile?.displayName || "").trim();
    return n || "—";
  }, [profile]);

  /** ============== Visible lists ============== */
  const servicesInArea = useMemo(() => {
    const aid = String(serviceAreaId || "");
    return services.filter((s) => !aid || String(s.areaId || "") === aid);
  }, [services, serviceAreaId]);

  const productsInCategory = useMemo(() => {
    const cid = String(productCategoryId || "");
    return products.filter((p) => !cid || String(p.categoryId || "") === cid);
  }, [products, productCategoryId]);

  /** ============== Top category chips: only 5 by default ============== */
  const areasWithServices = useMemo(() => {
    return areas.filter((a) => services.some((s) => String(s.areaId) === String(a.id)));
  }, [areas, services]);

  const visibleAreas = useMemo(() => {
    const list = areasWithServices || [];
    return showAllAreas ? list : list.slice(0, 5);
  }, [areasWithServices, showAllAreas]);

  /** ============== Selected services (binary: qty always 1) ============== */
  const selectedServices = useMemo(() => {
    const ids = selectedServiceIds;
    return services
      .filter((s) => ids.has(String(s.id)))
      .map((s) => ({
        serviceId: String(s.id),
        areaId: String(s.areaId || ""),
        title: s.name || s.title || "Service",
        price: Number(s.price || 0),
        qty: 1,
      }));
  }, [services, selectedServiceIds]);

  const effectiveSelectedServices = useMemo(() => {
    return selectedServices.map((s) => {
      const ov = servicePriceOverrides?.[String(s.serviceId)];
      const unitPrice = Number.isFinite(ov) ? Number(ov) : Number(s.price || 0);
      return { ...s, unitPrice, lineTotal: Number(unitPrice) * 1 };
    });
  }, [selectedServices, servicePriceOverrides]);

  const requestedAreaIds = useMemo(() => {
    const set = new Set(selectedServices.map((s) => String(s.areaId)).filter(Boolean));
    return Array.from(set);
  }, [selectedServices]);

  /** ============== staff map per area ============== */
  const staffByArea = useMemo(() => {
    const activeStaff = staff
      .filter((x) => Number(x.active) === 1 || x.active === true)
      .sort(
        (a, b) =>
          Number(a.sortOrder || 9999) - Number(b.sortOrder || 9999) ||
          String(a.name || "").localeCompare(String(b.name || ""))
      );
    const map = {};
    for (const areaId of requestedAreaIds) map[areaId] = activeStaff;
    return map;
  }, [staff, requestedAreaIds]);

  /** ============== Draft payload ============== */
  function draftMetaFromProfile(p) {
    const meta = p?.meta || {};
    return {
      groupId: String(meta.groupId || ""),
      participantKey: String(meta.participantKey || ""),
      participantRole: String(meta.participantRole || ""),
      preferredPaymentMode: String(meta.paymentMode || p?.group?.paymentMode || "single"),
      customerId: p?.customerId ? String(p.customerId) : "",
      displayName: String(p?.displayName || "").trim(),
      phone: String(p?.customer?.phone || p?.phone || "").trim(),
    };
  }

  function buildDraftPayloadCore() {
    const dk = toDateKeyISO(new Date());
    const meta = draftMetaFromProfile(profile);

    return {
      dateKey: dk,
      status: "draft",
      ...meta,
      comment: String(comment || ""),

      requestedStaffByArea: preferredStaffByArea || {},
      requestedStaffByService: preferredStaffByService || {},
      requestedStaffByProduct: preferredStaffByProduct || {},

      servicesJson: JSON.stringify(
        (effectiveSelectedServices || []).map((x) => ({
          serviceId: String(x.serviceId),
          areaId: String(x.areaId || ""),
          title: x.title,
          price: Number(x.unitPrice || 0),
          qty: 1,
        }))
      ),
      productsJson: JSON.stringify(
        (cart || []).map((x) => ({
          productId: String(x.id),
          title: x.title,
          price: Number(x.price || 0),
          qty: Number(x.qty || 0),
          categoryId: String(x.categoryId || ""),
        }))
      ),

      voidedServicesJson: JSON.stringify(
        (voidedServices || []).map((x) => ({
          serviceId: String(x.serviceId),
          areaId: String(x.areaId || ""),
          title: x.title,
          price: Number(x.price || 0),
          qty: 1,
        }))
      ),
      voidedProductsJson: JSON.stringify(
        (voidedProducts || []).map((x) => ({
          productId: String(x.id),
          title: x.title,
          price: Number(x.price || 0),
          qty: Number(x.qty || 0),
          categoryId: String(x.categoryId || ""),
        }))
      ),
    };
  }

  async function logOrderEvent(type, payload) {
    try {
      const dk = toDateKeyISO(new Date());
      await db.order_events.add({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        dateKey: dk,
        draftId: activeDraftId || "",
        type,
        actorStaffId: "",
        actorName: "",
        payloadJson: JSON.stringify(payload || {}),
      });
    } catch {}
  }

  async function ensureDraft() {
    const hasDraftTable = (db?.tables || []).some((t) => t?.name === "order_drafts");
    if (!hasDraftTable) return;

    if (activeDraftId) {
      const d = await db.order_drafts.get(activeDraftId).catch(() => null);
      if (d) {
        const s = safeJson(d.servicesJson, []);
        const p = safeJson(d.productsJson, []);
        const vs = safeJson(d.voidedServicesJson, []);
        const vp = safeJson(d.voidedProductsJson, []);

        const set = new Set();
        const ov = {};
        for (const line of s || []) {
          const sid = String(line?.serviceId || "");
          if (!sid) continue;
          set.add(sid);

          const draftPrice = Number(line?.price || 0);
          const cat = services.find((z) => String(z.id) === sid);
          const catPrice = Number(cat?.price || 0);
          if (Number.isFinite(draftPrice) && Number.isFinite(catPrice) && draftPrice !== catPrice) ov[sid] = draftPrice;
        }

        setSelectedServiceIds(set);
        setServicePriceOverrides(ov);

        setPreferredStaffByArea(d.requestedStaffByArea || {});
        setPreferredStaffByService(d.requestedStaffByService || {});
        setPreferredStaffByProduct(d.requestedStaffByProduct || {});

        setComment(String(d.comment || profile?.note || ""));

        setCart(
          (p || [])
            .map((x) => ({
              id: String(x.productId || x.id || ""),
              title: x.title,
              price: Number(x.price || 0),
              qty: Number(x.qty || 0),
              categoryId: String(x.categoryId || ""),
            }))
            .filter((x) => x.id)
        );

        setVoidedServices(
          (vs || [])
            .map((x) => ({
              serviceId: String(x.serviceId || ""),
              areaId: String(x.areaId || ""),
              title: x.title || "Service",
              price: Number(x.price || 0),
              qty: 1,
            }))
            .filter((x) => x.serviceId)
        );

        setVoidedProducts(
          (vp || [])
            .map((x) => ({
              id: String(x.productId || x.id || ""),
              title: x.title || "Produkt",
              price: Number(x.price || 0),
              qty: clampInt(x.qty ?? 1, 1, 999),
              categoryId: String(x.categoryId || ""),
            }))
            .filter((x) => x.id)
        );

        lastSavedHash.current = "";
      }
      return;
    }

    const now = new Date().toISOString();
    const payload = buildDraftPayloadCore();
    const id = crypto.randomUUID();
    setActiveDraftId(id);

    await db.order_drafts.put({
      id,
      createdAt: now,
      updatedAt: now,
      finalizedAt: "",
      voidedAt: "",
      visitId: "",
      ...payload,
    });

    await logOrderEvent("draft_created", { profileMeta: profile?.meta || {} });
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const hasDraftTable = (db?.tables || []).some((t) => t?.name === "order_drafts");
      if (!hasDraftTable) return;
      if (!activeDraftId) return;

      const now = new Date().toISOString();
      const payload = buildDraftPayloadCore();
      const hash = JSON.stringify(payload);
      if (hash === lastSavedHash.current) return;
      lastSavedHash.current = hash;

      await db.order_drafts.update(activeDraftId, { updatedAt: now, ...payload }).catch(() => {});
      await logOrderEvent("draft_saved", { changed: true });
    }, 350);
  }

  useEffect(() => {
    ensureDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, draftId]);

  useEffect(() => {
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedServiceIds,
    preferredStaffByArea,
    preferredStaffByService,
    preferredStaffByProduct,
    comment,
    cart,
    servicePriceOverrides,
    voidedServices,
    voidedProducts,
  ]);

  /** ============== Local “Most booked” (last ~30 days) ============== */
  useEffect(() => {
    let alive = true;

    async function loadTop() {
      try {
        const now = new Date();
        const start = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
        const fromKey = toDateKeyISO(start);
        const toKey = toDateKeyISO(now);

        // Services
        const svcRows = await db.visit_services
          .where("dateKey")
          .between(fromKey, toKey, true, true)
          .toArray()
          .catch(() => []);

        const countByArea = {};
        for (const r of svcRows || []) {
          const a = String(r?.areaId || "");
          const t = norm(r?.title);
          if (!a || !t) continue;

          const cat = services.find((s) => String(s.areaId || "") === a && norm(s?.name || s?.title) === t);
          const sid = String(cat?.id || "");
          if (!sid) continue;

          if (!countByArea[a]) countByArea[a] = {};
          countByArea[a][sid] = (countByArea[a][sid] || 0) + 1;
        }

        const topSvc = {};
        for (const a of Object.keys(countByArea)) {
          const pairs = Object.entries(countByArea[a] || {});
          pairs.sort((x, y) => Number(y[1] || 0) - Number(x[1] || 0));
          topSvc[a] = pairs.slice(0, 10).map((p) => p[0]);
        }

        // Products
        const prRows = await db.visit_products
          .where("dateKey")
          .between(fromKey, toKey, true, true)
          .toArray()
          .catch(() => []);

        const countByCat = {};
        for (const r of prRows || []) {
          const title = norm(r?.title);
          if (!title) continue;

          const cat = products.find((p) => norm(p?.name || p?.title) === title);
          const pid = String(cat?.id || "");
          const cid = String(cat?.categoryId || "");
          if (!pid || !cid) continue;

          if (!countByCat[cid]) countByCat[cid] = {};
          countByCat[cid][pid] = (countByCat[cid][pid] || 0) + Number(r?.qty || 1);
        }

        const topPrd = {};
        for (const c of Object.keys(countByCat)) {
          const pairs = Object.entries(countByCat[c] || {});
          pairs.sort((x, y) => Number(y[1] || 0) - Number(x[1] || 0));
          topPrd[c] = pairs.slice(0, 10).map((p) => p[0]);
        }

        if (!alive) return;
        setTopServiceIdsByArea(topSvc);
        setTopProductIdsByCat(topPrd);
      } catch {}
    }

    if (services.length || products.length) loadTop();
    return () => {
      alive = false;
    };
  }, [services, products]);

  /** ============== Edit-mode hydrate ============== */
  useEffect(() => {
    let alive = true;

    async function hydrateFromExistingVisit() {
      if (!isEdit || !editVisitId) return;

      setMsg("");
      setSelectedServiceIds(new Set());
      setPreferredStaffByArea({});
      setPreferredStaffByService({});
      setPreferredStaffByProduct({});
      setCart([]);
      setVoidedServices([]);
      setVoidedProducts([]);
      setServicePriceOverrides({});
      setExistingServiceIds(new Set());
      setExistingProductIds(new Set());

      const [visit, vs, vp, vas] = await Promise.all([
        db.visits.get(editVisitId).catch(() => null),
        db.visit_services.where("visitId").equals(editVisitId).toArray().catch(() => []),
        db.visit_products.where("visitId").equals(editVisitId).toArray().catch(() => []),
        db.visit_area_state.where("visitId").equals(editVisitId).toArray().catch(() => []),
      ]);

      if (!alive) return;

      const vComment = String(visit?.comment || visit?.note || "");
      setComment(vComment || "");

      const selected = new Set();
      const existing = new Set();
      const ov = {};
      const staffBySvc = {};

      for (const line of vs || []) {
        const title = String(line?.title || line?.name || "").trim();
        const areaId = String(line?.areaId || "").trim();
        const price = Number(line?.price || 0);

        const cat = services.find((s) => {
          const t = String(s.name || s.title || "").trim();
          return t === title && String(s.areaId || "") === areaId;
        });

        const serviceIdRaw = cat?.id || line?.serviceId || "";
        const sid = String(serviceIdRaw || "");
        if (sid) {
          selected.add(sid);
          existing.add(sid);

          if (line?.staffId) staffBySvc[sid] = String(line.staffId);

          const catPrice = Number(cat?.price || 0);
          if (Number.isFinite(price) && Number.isFinite(catPrice) && price !== catPrice) ov[sid] = Number(price);
        }
      }

      setSelectedServiceIds(selected);
      setExistingServiceIds(existing);
      setServicePriceOverrides(ov);
      setPreferredStaffByService(staffBySvc);

      const cartLines = [];
      const existingP = new Set();
      const staffByProduct = {};

      for (const line of vp || []) {
        const pid = String(line?.productId || line?.id || "");
        if (!pid) continue;

        existingP.add(pid);

        if (line?.staffId) staffByProduct[pid] = String(line.staffId);

        cartLines.push({
          id: pid,
          title: String(line?.title || line?.name || "Produkt"),
          price: Number(line?.price || 0),
          qty: Number(line?.qty || 1),
          categoryId: "",
        });
      }

      setExistingProductIds(existingP);
      setCart(cartLines);
      setPreferredStaffByProduct(staffByProduct);

      const pref = {};
      for (const st of vas || []) {
        const areaId = String(st?.areaId || "");
        const sid = String(st?.preferredStaffId || "");
        if (areaId && sid) pref[areaId] = sid;
      }
      setPreferredStaffByArea(pref);

      setTab("treatment");
    }

    hydrateFromExistingVisit();
    return () => {
      alive = false;
    };
  }, [isEdit, editVisitId, services]);

  /** ============== Actions ============== */
  function toggleService(id) {
    const sid = String(id);
    setSelectedServiceIds((prev) => {
      const n = new Set(prev);
      if (n.has(sid)) {
        n.delete(sid);

        setPreferredStaffByService((p) => {
          const next = { ...(p || {}) };
          delete next[sid];
          return next;
        });

        setServicePriceOverrides((p) => {
          const next = { ...p };
          delete next[sid];
          return next;
        });
      } else {
        n.add(sid);
      }
      return n;
    });
  }

  function handleClose() {
  // 1) Wenn Parent Handler geliefert hat → sauberer Weg
  if (typeof onCancel === "function") {
    onCancel();
    return;
  }

  // 2) Wenn embedded (iframe) → Parent anweisen zu schließen
  try {
    if (window.self !== window.top) {
      window.parent.postMessage({ type: "KIOSK_CLOSE" }, "*");
      return;
    }
  } catch {
    // Cross-origin iframe kann window.top Zugriff werfen → trotzdem postMessage versuchen
    try {
      window.parent.postMessage({ type: "KIOSK_CLOSE" }, "*");
      return;
    } catch {}
  }

  // 3) Wenn eigenes Fenster/Popup → schließen versuchen
  window.close();

  // 4) Fallback: zurück
  setTimeout(() => {
    // window.closed ist nicht überall zuverlässig, aber ok als best-effort
    try {
      if (!window.closed) window.history.back();
    } catch {
      window.history.back();
    }
  }, 50);
}

  function addProduct(p) {
    setCart((prev) => {
      const title = p.name || p.title || "Produkt";
      const price = Number(p.price || 0);
      const categoryId = String(p.categoryId || "");
      const pid = String(p.id);
      const idx = prev.findIndex((x) => String(x.id) === pid);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: clampInt(next[idx].qty + 1, 1, 999) };
        return next;
      }
      return [...prev, { id: pid, title, price, qty: 1, categoryId }];
    });
  }

  function decProductQty(productId) {
    const pid = String(productId);
    setCart((prev) => {
      const idx = prev.findIndex((x) => String(x.id) === pid);
      if (idx < 0) return prev;
      const next = [...prev];
      const item = next[idx];
      const q = clampInt(item.qty, 1, 999);
      if (q <= 1) return next.filter((x) => String(x.id) !== pid);
      next[idx] = { ...item, qty: q - 1 };
      return next;
    });
  }

  /** ============== Hidden price editing ============== */
  function setServicePriceInline(serviceId, raw) {
    const n = parseMoneyInput(raw);
    if (n == null) return;
    const sid = String(serviceId);
    setServicePriceOverrides((p) => ({ ...p, [sid]: n }));
  }

  function setVoidedServicePriceInline(serviceId, raw) {
    const n = parseMoneyInput(raw);
    if (n == null) return;
    const sid = String(serviceId);
    setVoidedServices((prev) => prev.map((x) => (String(x.serviceId) === sid ? { ...x, price: n } : x)));
  }

  function setProductPriceInline(productId, raw) {
    const n = parseMoneyInput(raw);
    if (n == null) return;
    const pid = String(productId);
    setCart((prev) => prev.map((x) => (String(x.id) === pid ? { ...x, price: n } : x)));
  }

  function setVoidedProductPriceInline(productId, raw) {
    const n = parseMoneyInput(raw);
    if (n == null) return;
    const pid = String(productId);
    setVoidedProducts((prev) => prev.map((x) => (String(x.id) === pid ? { ...x, price: n } : x)));
  }

  /** ============== Move line to "Storniert" ============== */
  function voidServiceLine(serviceId) {
    const sid = String(serviceId);
    const line = effectiveSelectedServices.find((s) => String(s.serviceId) === sid);
    if (!line) return;

    setSelectedServiceIds((prev) => {
      const n = new Set(prev);
      n.delete(sid);
      return n;
    });

    setVoidedServices((prev) => {
      const idx = prev.findIndex((x) => String(x.serviceId) === sid);
      if (idx >= 0) return prev;
      return [
        ...prev,
        { serviceId: sid, areaId: String(line.areaId || ""), title: line.title, price: Number(line.unitPrice || 0), qty: 1 },
      ];
    });

    setPreferredStaffByService((p) => {
      const next = { ...(p || {}) };
      delete next[sid];
      return next;
    });

    setServicePriceOverrides((p) => {
      const next = { ...p };
      delete next[sid];
      return next;
    });
  }

  function restoreVoidedService(serviceId) {
    const sid = String(serviceId);
    const line = voidedServices.find((x) => String(x.serviceId) === sid);
    if (!line) return;

    setVoidedServices((prev) => prev.filter((x) => String(x.serviceId) !== sid));
    setSelectedServiceIds((prev) => new Set([...Array.from(prev), sid]));
    setServicePriceOverrides((p) => ({ ...p, [sid]: Number(line.price || 0) }));
  }

  function voidProductLine(productId) {
    const pid = String(productId);
    const line = cart.find((x) => String(x.id) === pid);
    if (!line) return;

    setCart((prev) => prev.filter((x) => String(x.id) !== pid));

    setVoidedProducts((prev) => {
      const idx = prev.findIndex((x) => String(x.id) === pid);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          qty: clampInt((next[idx].qty || 1) + Number(line.qty || 1), 1, 999),
          price: Number(line.price || 0),
        };
        return next;
      }
      return [...prev, { ...line, id: pid }];
    });
  }

  function restoreVoidedProduct(productId) {
    const pid = String(productId);
    const line = voidedProducts.find((x) => String(x.id) === pid);
    if (!line) return;

    setVoidedProducts((prev) => prev.filter((x) => String(x.id) !== pid));

    setCart((prev) => {
      const idx = prev.findIndex((x) => String(x.id) === pid);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: clampInt((next[idx].qty || 1) + Number(line.qty || 1), 1, 999) };
        return next;
      }
      return [...prev, { ...line, id: pid }];
    });
  }

  /** ============== Totals (kept for DB, hidden in UI) ============== */
  const totals = useMemo(() => {
    const serviceSum = (effectiveSelectedServices || []).reduce((s, x) => s + Number(x.unitPrice || 0), 0);
    const productSum = (cart || []).reduce((s, x) => s + Number(x.price || 0) * Number(x.qty || 0), 0);
    const total = Number(serviceSum + productSum);
    return {
      serviceSum: Number(serviceSum.toFixed(2)),
      productSum: Number(productSum.toFixed(2)),
      total: Number(total.toFixed(2)),
    };
  }, [effectiveSelectedServices, cart]);

  /** ============== Smart summary rows (UI simplified) ============== */
  const activeRows = useMemo(() => {
    const rows = [];

    for (const s of effectiveSelectedServices || []) {
      const areaId = String(s.areaId || "");
      const sid = String(s.serviceId || "");
      const prefStaffId = String(preferredStaffByService?.[sid] || preferredStaffByArea?.[areaId] || "");

      rows.push({
        key: `svc:${areaId}:${sid}`,
        kind: "service",
        areaId,
        staffId: prefStaffId,
        staffName: prefStaffId ? staffNameById(prefStaffId) : "",
        title: String(s.title || "Service"),
        qty: 1,
        unitPrice: Number(s.unitPrice || 0),
        serviceId: sid,
        productId: "",
      });
    }

    for (const p of cart || []) {
      const pid = String(p.id || "");
      const staffId = String(preferredStaffByProduct?.[pid] || "");
      rows.push({
        key: `prd:${pid}`,
        kind: "product",
        areaId: "",
        staffId,
        staffName: staffId ? staffNameById(staffId) : "",
        title: String(p.title || "Produkt"),
        qty: Number(p.qty || 0),
        unitPrice: Number(p.price || 0),
        serviceId: "",
        productId: pid,
      });
    }

    return rows;
  }, [effectiveSelectedServices, cart, preferredStaffByService, preferredStaffByArea, preferredStaffByProduct, staff]);

  const voidRows = useMemo(() => {
    const rows = [];

    for (const s of voidedServices || []) {
      const areaId = String(s.areaId || "");
      const sid = String(s.serviceId || "");
      const prefStaffId = String(preferredStaffByService?.[sid] || preferredStaffByArea?.[areaId] || "");

      rows.push({
        key: `vsvc:${areaId}:${sid}`,
        kind: "service",
        areaId,
        staffId: prefStaffId,
        staffName: prefStaffId ? staffNameById(prefStaffId) : "",
        title: String(s.title || "Service"),
        qty: 1,
        unitPrice: Number(s.price || 0),
        serviceId: sid,
        productId: "",
      });
    }

    for (const p of voidedProducts || []) {
      const pid = String(p.id || "");
      const staffId = String(preferredStaffByProduct?.[pid] || "");
      rows.push({
        key: `vprd:${pid}`,
        kind: "product",
        areaId: "",
        staffId,
        staffName: staffId ? staffNameById(staffId) : "",
        title: String(p.title || "Produkt"),
        qty: Number(p.qty || 0),
        unitPrice: Number(p.price || 0),
        serviceId: "",
        productId: pid,
      });
    }

    return rows;
  }, [voidedServices, voidedProducts, preferredStaffByService, preferredStaffByArea, preferredStaffByProduct, staff]);

  /** ============== Update existing visit (Edit) ============== */
  async function updateExistingVisitInDb(visitId) {
    const now = new Date().toISOString();
    const dateKey = toDateKeyISO(new Date());

    await db.visits
      .update(visitId, {
        updatedAt: now,
        dateKey,
        comment: String(comment || ""),
        note: String(comment || ""),
        total: Number(totals.total || 0),
        sum: Number(totals.total || 0),
        amount: Number(totals.total || 0),
      })
      .catch(() => {});

    await db.visit_services.where("visitId").equals(visitId).delete().catch(() => {});
    const vsRows = [];

    for (const s of effectiveSelectedServices || []) {
      const sid = String(s.serviceId || "");
      const staffId = String(preferredStaffByService?.[sid] || preferredStaffByArea?.[String(s.areaId)] || "");
      const staffName = staffId ? staffNameById(staffId) : "";

      vsRows.push({
        id: uid("vs"),
        visitId,
        createdAt: now,
        updatedAt: now,
        dateKey,
        areaId: String(s.areaId || ""),
        title: String(s.title || "Service"),
        price: Number(s.unitPrice || 0),
        staffId,
        staffName,
        startedAt: "",
        endedAt: "",
        note: "",
      });
    }
    if (vsRows.length) await db.visit_services.bulkAdd(vsRows).catch(() => {});

    await db.visit_products.where("visitId").equals(visitId).delete().catch(() => {});
    const vpRows = (cart || []).map((p) => {
      const pid = String(p.id || "");
      const staffId = String(preferredStaffByProduct?.[pid] || "");
      const staffName = staffId ? staffNameById(staffId) : "";

      return {
        id: uid("vp"),
        visitId,
        createdAt: now,
        updatedAt: now,
        dateKey,
        productId: pid,
        title: String(p.title || "Produkt"),
        price: Number(p.price || 0),
        qty: Number(p.qty || 1),
        staffId,
        staffName,
      };
    });

    if (vpRows.length) await db.visit_products.bulkAdd(vpRows).catch(() => {});

    for (const areaId of requestedAreaIds) {
      const key = String(areaId || "");
      if (!key) continue;

      const preferredStaffId = String(preferredStaffByArea?.[key] || "");
      const preferredStaffName = preferredStaffId ? staffNameById(preferredStaffId) : "";

      const existing = await db.visit_area_state.where("[visitId+areaId]").equals([visitId, key]).first().catch(() => null);

      if (existing?.id) {
        await db.visit_area_state.update(existing.id, { updatedAt: now, dateKey, preferredStaffId, preferredStaffName }).catch(() => {});
      } else {
        await db.visit_area_state
          .add({
            id: uid("vas"),
            visitId,
            areaId: key,
            dateKey,
            createdAt: now,
            updatedAt: now,
            status: "waiting",
            preferredStaffId,
            preferredStaffName,
            assignedStaffId: "",
            assignedStaffName: "",
            startedAt: "",
            endedAt: "",
            note: "",
          })
          .catch(() => {});
      }
    }
  }

  /** ============== Finalize (Blitz-Check-in ohne Confirm) ============== */
  async function finalize() {
    setMsg("");
    setSending(true);
    try {
      const hasDraftTable = (db?.tables || []).some((t) => t?.name === "order_drafts");
      if (hasDraftTable && activeDraftId) {
        const now = new Date().toISOString();
        const payload = buildDraftPayloadCore();
        await db.order_drafts.update(activeDraftId, { updatedAt: now, ...payload }).catch(() => {});
      }

      if (isEdit && editVisitId) {
        await updateExistingVisitInDb(editVisitId);

        if ((db?.tables || []).some((t) => t?.name === "order_drafts") && activeDraftId) {
          const now = new Date().toISOString();
          const payload = buildDraftPayloadCore();
          await db.order_drafts.update(activeDraftId, {
            status: "finalized",
            finalizedAt: now,
            updatedAt: now,
            visitId: editVisitId,
            ...payload,
          });
          await logOrderEvent("updated_existing_visit", { visitId: editVisitId });
        }

        onDone?.({ draftId: activeDraftId, visitId: editVisitId });
        return;
      }

      const expandedServices = (effectiveSelectedServices || []).map((s) => ({
        serviceId: String(s.serviceId),
        areaId: String(s.areaId || ""),
        title: s.title,
        price: Number(s.unitPrice || 0),
        staffId: String(preferredStaffByService?.[String(s.serviceId)] || preferredStaffByArea?.[String(s.areaId)] || ""),
      }));

      const res = await createVisitFromOrder({
        profile,
        comment,
        selectedServices: expandedServices,
        preferredStaffByArea,
        preferredStaffByService,
        preferredStaffByProduct,
        cart,
      });

      const visitId = (typeof res === "string" && res) || (res && (res.visitId || res.id)) || "";

      if ((db?.tables || []).some((t) => t?.name === "order_drafts") && activeDraftId) {
        const now = new Date().toISOString();
        await db.order_drafts.update(activeDraftId, {
          status: "finalized",
          finalizedAt: now,
          updatedAt: now,
          visitId: visitId || "",
          ...buildDraftPayloadCore(),
        });
        await logOrderEvent("finalized", { visitId });
      }

      onDone?.({ draftId: activeDraftId, visitId });
    } catch (e) {
      setMsg(String(e?.message || e));
      await logOrderEvent("finalize_failed", { error: String(e?.message || e) });
    } finally {
      setSending(false);
    }
  }

  const activeServiceCount = useMemo(() => activeRows.filter((r) => r.kind === "service").length, [activeRows]);
  const activeProductCount = useMemo(
    () => activeRows.filter((r) => r.kind === "product").reduce((n, r) => n + Number(r.qty || 0), 0),
    [activeRows]
  );

  /** ============== Global Search suggestions (NO staff) ============== */
  const globalSuggestions = useMemo(() => {
    const q = norm(globalQuery);
    if (!q) return [];

    const svc = (services || [])
      .map((s) => ({
        kind: "service",
        id: String(s.id),
        title: String(s.name || s.title || "Service"),
        areaId: String(s.areaId || ""),
        meta: areaNameById(s.areaId),
      }))
      .filter((x) => norm(x.title).includes(q));

    const prd = (products || [])
      .map((p) => ({
        kind: "product",
        id: String(p.id),
        title: String(p.name || p.title || "Produkt"),
        categoryId: String(p.categoryId || ""),
        meta: categoryNameById(p.categoryId),
      }))
      .filter((x) => norm(x.title).includes(q));

    function score(x) {
      const t = norm(x.title);
      if (t.startsWith(q)) return 0;
      return 1;
    }

    const all = [...svc, ...prd];
    all.sort((a, b) => score(a) - score(b) || norm(a.title).localeCompare(norm(b.title)));
    return all.slice(0, 10);
  }, [globalQuery, services, products, areas, productCategories]);

  function applySuggestion(sug) {
    if (!sug) return;

    if (sug.kind === "service") {
      setTab("treatment");
      setServiceAreaId(sug.areaId || "");
      setShowAllAreas(true);
      setShowAllServices(true);
      toggleService(sug.id);
    } else if (sug.kind === "product") {
      setTab("products");
      setProductCategoryId(sug.categoryId || "");
      setShowAllProducts(true);
      const p = products.find((x) => String(x.id) === String(sug.id));
      if (p) addProduct(p);
    }

    setGlobalOpen(false);
    setGlobalQuery("");
  }

  /** ============== UI buckets: favorites per selected area/category ============== */
const favoriteServices = useMemo(() => {
  const aid = String(serviceAreaId || "");

  // 1) echte “Beliebt” aus Stats
  const ids = (topServiceIdsByArea?.[aid] || []).map(String).filter(Boolean);
  const fromStats = ids
    .map((id) => services.find((s) => String(s.id) === id))
    .filter(Boolean)
    .slice(0, 5);

  if (fromStats.length > 0) return fromStats;

  // 2) FALLBACK: erste 5 Services im aktuellen Bereich (oder global)
  const fallback = (servicesInArea && servicesInArea.length ? servicesInArea : services)
    .filter((s) => (s?.active === 1 || s?.active === true || s?.active == null))
    .slice(0, 5);

  return fallback;
}, [topServiceIdsByArea, serviceAreaId, services, servicesInArea]);


const favoriteProducts = useMemo(() => {
  const cid = String(productCategoryId || "");

  // 1) echte “Beliebt” aus Stats
  const ids = (topProductIdsByCat?.[cid] || []).map(String).filter(Boolean);
  const fromStats = ids
    .map((id) => products.find((p) => String(p.id) === id))
    .filter(Boolean)
    .slice(0, 5);

  if (fromStats.length > 0) return fromStats;

  // 2) FALLBACK: erste 5 Produkte in aktueller Kategorie (oder global)
  const fallback = (productsInCategory && productsInCategory.length ? productsInCategory : products)
    .filter((p) => (p?.active === 1 || p?.active === true || p?.active == null))
    .slice(0, 5);

  return fallback;
}, [topProductIdsByCat, productCategoryId, products, productsInCategory]);


  /** ============== Render ============== */
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.headTop}>
          <div>
            <div className={styles.kicker}>{isEdit ? "Bearbeiten" : "Check-in"}</div>
            <div className={styles.name}>{displayName}</div>
          </div>

          <div className={styles.globalSearch}>
            <input
              className={styles.search}
              value={globalQuery}
              onChange={(e) => {
                setGlobalQuery(e.target.value);
                setGlobalOpen(true);
              }}
              onFocus={() => setGlobalOpen(true)}
              placeholder="Suchen: Behandlung, Produkt…"
            />

            {globalOpen && globalSuggestions.length > 0 ? (
              <div className={styles.suggestBox} onMouseDown={(e) => e.preventDefault()}>
                {globalSuggestions.map((s) => (
                  <button
                    key={`${s.kind}:${s.id}`}
                    type="button"
                    className={styles.suggestItem}
                    onClick={() => applySuggestion(s)}
                  >
                    <span className={styles.suggestTitle}>{s.title}</span>
                    <span className={styles.suggestMeta}>
                      {s.kind === "service" ? "Behandlung" : "Produkt"} · {s.meta || "—"}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.body}>
        <aside className={styles.tabs}>
          {/* counts: nur Behandlung + Produkte, NICHT Mitarbeiter + Übersicht */}
          <Tab label="Behandlung" active={tab === "treatment"} onClick={() => setTab("treatment")} count={activeServiceCount} />
          <Tab label="Mitarbeiter" active={tab === "staff"} onClick={() => setTab("staff")} />
          <Tab label="Produkte" active={tab === "products"} onClick={() => setTab("products")} count={activeProductCount} />
          <Tab label="Hinweise" active={tab === "notes"} onClick={() => setTab("notes")} />
          <Tab label="Übersicht" active={tab === "summary"} onClick={() => setTab("summary")} />
        </aside>

        <main className={styles.main}>
          <div className={styles.mainScroll}>
            {tab === "treatment" && (
              <div className={styles.panel}>
                <div className={styles.panelTop}>
                  <div className={styles.panelTitle}>Behandlungen</div>

                  {/* Alle anzeigen: nach oben (gleiche Höhe wie Panel-Titel) */}
                  {(areasWithServices?.length || 0) > 5 ? (
                    <button type="button" className={styles.favToggle} onClick={() => setShowAllAreas((v) => !v)}>
                      {showAllAreas ? "Weniger anzeigen" : "Alle anzeigen"}
                    </button>
                  ) : null}
                </div>

                <div className={styles.chipsRow}>
                  {visibleAreas.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={`${styles.chip} ${String(serviceAreaId) === String(a.id) ? styles.chipOn : ""}`}
                      onClick={() => setServiceAreaId(a.id)}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>

                {/* Favorites */}
                <div className={styles.favBlock}>
                  <div className={styles.favTop}>
                    <div className={styles.favTitle}>Beliebt</div>
                    <button type="button" className={styles.favToggle} onClick={() => setShowAllServices((v) => !v)}>
                      {showAllServices ? "Weniger anzeigen" : "Alle anzeigen"}
                    </button>
                  </div>

                  <div className={styles.favGrid}>
                    {(favoriteServices || []).length === 0 ? (
                      <div className={styles.favEmpty}>Noch keine Favoriten erkannt.</div>
                    ) : (
                      favoriteServices.map((s) => {
                        const on = selectedServiceIds.has(String(s.id));
                        return (
                          <button
                            key={s.id}
                            type="button"
                            className={`${styles.favCard} ${on ? styles.favCardOn : ""}`}
                            onClick={() => toggleService(s.id)}
                          >
                            <div className={styles.favCardTitle}>{s.name || s.title || "Service"}</div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Full list */}
                {showAllServices ? (
                  <div className={styles.listBox}>
                    <div className={styles.items}>
                      {servicesInArea.map((s) => {
                        const sid = String(s.id);
                        const on = selectedServiceIds.has(sid);
                        const wasInVisit = existingServiceIds.has(sid);
                        const title = s.name || s.title || "Service";

                        return (
                          <div
                            key={sid}
                            role="button"
                            tabIndex={0}
                            className={`${styles.item} ${on ? styles.itemOn : ""} ${wasInVisit ? styles.itemWarn : ""}`}
                            onClick={() => toggleService(sid)}
                            onKeyDown={(e) => (e.key === "Enter" ? toggleService(sid) : null)}
                          >
                            <div className={styles.itemLeft}>
                              <div className={styles.itemTitle}>{title}</div>
                              <div className={styles.itemMeta}>
                                {wasInVisit ? <span className={styles.warnTag}>bereits gebucht</span> : <span className={styles.miniMuted}> </span>}
                              </div>
                            </div>

                            <div className={styles.itemRight}>
                              <span className={styles.miniMuted}>{on ? "✓" : ""}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {tab === "products" && (
              <div className={styles.panel}>
                <div className={styles.panelTop}>
                  <div className={styles.panelTitle}>Produkte</div>
                </div>

                <div className={styles.chipsRow}>
                  {productCategories
                    .filter((c) => products.some((p) => String(p.categoryId) === String(c.id)))
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`${styles.chip} ${String(productCategoryId) === String(c.id) ? styles.chipOn : ""}`}
                        onClick={() => setProductCategoryId(c.id)}
                      >
                        {c.title}
                      </button>
                    ))}
                </div>

                <div className={styles.favBlock}>
                  <div className={styles.favTop}>
                    <div className={styles.favTitle}>Beliebt</div>
                    <button type="button" className={styles.favToggle} onClick={() => setShowAllProducts((v) => !v)}>
                      {showAllProducts ? "Weniger anzeigen" : "Alle anzeigen"}
                    </button>
                  </div>

                  <div className={styles.favGrid}>
                    {(favoriteProducts || []).length === 0 ? (
                      <div className={styles.favEmpty}>Noch keine Favoriten erkannt.</div>
                    ) : (
                      favoriteProducts.map((p) => {
                        const title = p.name || p.title || "Produkt";
                        const inCart = cart.find((x) => String(x.id) === String(p.id));
                        const qty = inCart ? clampInt(inCart.qty || 1, 1, 999) : 0;

                        return (
                          <PressCard
                            key={p.id}
                            className={`${styles.favCard} ${qty > 0 ? styles.favCardOn : ""}`}
                            onTap={() => addProduct(p)}
                            onHold={() => decProductQty(p.id)}
                            title="Tippen: +1 · Halten: -1"
                          >
                            <div className={styles.favCardTitle}>{title}</div>
                            <div className={styles.favCardMeta}>{qty > 0 ? ` ×${qty}` : ""}</div>
                          </PressCard>
                        );
                      })
                    )}
                  </div>
                </div>

                {showAllProducts ? (
                  <div className={styles.listBox}>
                    <div className={styles.items}>
                      {productsInCategory.map((p) => {
                        const pid = String(p.id);
                        const wasInVisit = existingProductIds.has(pid);
                        const title = p.name || p.title || "Produkt";
                        const inCart = cart.find((x) => String(x.id) === pid);
                        const qty = inCart ? Number(inCart.qty || 1) : 0;

                        return (
                          <PressRow
                            key={pid}
                            className={`${styles.item} ${qty > 0 ? styles.itemOn : ""} ${wasInVisit ? styles.itemWarn : ""}`}
                            onTap={() => addProduct(p)}
                            onHold={() => decProductQty(pid)}
                            title="Tippen: +1 · Halten: -1"
                          >
                            <div className={styles.itemLeft}>
                              <div className={styles.itemTitle}>
                                {title}
                                {qty > 0 ? <span className={styles.inlineQtyTag}>×{qty}</span> : null}
                              </div>
                              <div className={styles.itemMeta}>
                                {wasInVisit ? <span className={styles.warnTag}>bereits gebucht</span> : <span className={styles.miniMuted}> </span>}
                              </div>
                            </div>

                            <div className={styles.itemRight}>
                              <span className={styles.miniMuted}>{qty > 0 ? "✓" : ""}</span>
                            </div>
                          </PressRow>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {tab === "staff" && (
              <StaffPanelByServiceAndProduct
                services={effectiveSelectedServices}
                productsInCart={cart}
                staff={staff}
                staffByArea={staffByArea}
                preferredStaffByService={preferredStaffByService}
                preferredStaffByArea={preferredStaffByArea}
                preferredStaffByProduct={preferredStaffByProduct}
                onPickService={(serviceId, areaId, staffId) => setStaffForService(serviceId, areaId, staffId)}
                onPickProduct={(productId, staffId) => setStaffForProduct(productId, staffId)}
                recentStaffMap={recentStaffMap}
                recentProductStaffMap={recentProductStaffMap}
              />
            )}

            {tab === "notes" && <NotesPanel value={comment} onChange={setComment} />}

            {tab === "summary" && (
              <div className={styles.panel}>
                <div className={styles.panelTop}>
                  <div className={styles.panelTitle}>Übersicht</div>
                </div>

                <div className={styles.noteReadOnlyCard}>
                  <div className={styles.noteReadOnlyTitle}>Notiz</div>
                  <div className={styles.noteReadOnlyText}>
                    {String(comment || "").trim() ? String(comment || "").trim() : "—"}
                  </div>
                </div>

                <div className={styles.browserTabs}>
                  <button
                    type="button"
                    className={`${styles.browserTab} ${cartTab === "active" ? styles.browserTabOn : ""}`}
                    onClick={() => setCartTab("active")}
                  >
                    Aktiv
                    <span className={styles.browserTabCount}>{activeRows.length}</span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.browserTab} ${cartTab === "void" ? styles.browserTabOn : ""}`}
                    onClick={() => setCartTab("void")}
                  >
                    Storniert
                    <span className={styles.browserTabCount}>{voidRows.length}</span>
                  </button>
                  <div className={styles.browserTabsRail} />
                </div>

                {cartTab === "active" ? (
                  <SummaryList
                    rows={activeRows}
                    mode="active"
                    onVoidService={voidServiceLine}
                    onVoidProduct={voidProductLine}
                    onPriceChangeService={setServicePriceInline}
                    onPriceChangeProduct={setProductPriceInline}
                  />
                ) : (
                  <SummaryList
                    rows={voidRows}
                    mode="void"
                    onRestoreService={restoreVoidedService}
                    onRestoreProduct={restoreVoidedProduct}
                    onPriceChangeVoidedService={setVoidedServicePriceInline}
                    onPriceChangeVoidedProduct={setVoidedProductPriceInline}
                  />
                )}
              </div>
            )}

            {msg ? <div className={styles.msg}>{msg}</div> : null}
          </div>

          {/* Sticky footer: nur Actions (SumBar komplett entfernt) */}
          <div className={styles.stickyFooter}>
            <div className={styles.actionsRow}>
              <button className={styles.ghost} onClick={handleClose} type="button" disabled={sending}>
                Schließen
            </button>
              <button className={styles.primary} onClick={finalize} disabled={sending} type="button">
                {sending ? "Senden..." : isEdit ? "Änderungen speichern" : "Check-in starten"}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/** ========= Tab ========= */
function Tab({ label, active, onClick, count }) {
  return (
    <button className={`${styles.tab} ${active ? styles.tabOn : ""}`} onClick={onClick} type="button">
      <span>{label}</span>
      {typeof count === "number" && count > 0 ? <span className={styles.tabCount}>{count}</span> : null}
    </button>
  );
}

/** ========= Press helpers: Tap (+1) / Hold (-1) ========= */
function useHold(callback, ms = 450) {
  const t = useRef(null);
  const started = useRef(false);

  const start = () => {
    started.current = true;
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => {
      if (started.current) callback?.();
      started.current = false;
    }, ms);
  };

  const stop = () => {
    started.current = false;
    window.clearTimeout(t.current);
  };

  return { start, stop };
}

function PressCard({ children, className, onTap, onHold, title }) {
  const hold = useHold(onHold, 450);
  return (
    <button
      type="button"
      className={className}
      onClick={onTap}
      onMouseDown={hold.start}
      onMouseUp={hold.stop}
      onMouseLeave={hold.stop}
      onTouchStart={hold.start}
      onTouchEnd={hold.stop}
      title={title}
    >
      {children}
    </button>
  );
}

function PressRow({ children, className, onTap, onHold, title }) {
  const hold = useHold(onHold, 450);
  return (
    <div
      role="button"
      tabIndex={0}
      className={className}
      onClick={onTap}
      onKeyDown={(e) => (e.key === "Enter" ? onTap?.() : null)}
      onMouseDown={hold.start}
      onMouseUp={hold.stop}
      onMouseLeave={hold.stop}
      onTouchStart={hold.start}
      onTouchEnd={hold.stop}
      title={title}
    >
      {children}
    </div>
  );
}

/** ========= Staff per Service + Product ========= */
function StaffPanelByServiceAndProduct({
  services,
  productsInCart,
  staff,
  staffByArea,
  preferredStaffByService,
  preferredStaffByArea,
  preferredStaffByProduct,
  onPickService,
  onPickProduct,
  recentStaffMap,
  recentProductStaffMap,
}) {
  const [openKey, setOpenKey] = useState(""); // EXKLUSIV: NUR EINE OFFEN
  const [qByKey, setQByKey] = useState({});
  const [showAllByKey, setShowAllByKey] = useState({});

  const activeStaff = useMemo(() => {
    return (staff || [])
      .filter((x) => Number(x.active) === 1 || x.active === true)
      .sort(
        (a, b) =>
          Number(a.sortOrder || 9999) - Number(b.sortOrder || 9999) ||
          String(a.name || "").localeCompare(String(b.name || ""))
      );
  }, [staff]);

  function norm(s) {
    return String(s || "").toLowerCase().trim();
  }

  function toggle(key) {
    setOpenKey((cur) => (cur === key ? "" : key)); // 2. Klick = schließen
  }

  // Safety: wenn sich Daten ändern und der offene Key nicht mehr existiert -> schließen
  useEffect(() => {
    const keys = new Set();

    for (const svc of services || []) {
      const serviceId = String(svc?.serviceId || "");
      const areaId = String(svc?.areaId || "");
      const title = String(svc?.title || "Service");
      keys.add(`svc:${areaId}:${serviceId || norm(title)}`);
    }

    for (const p of productsInCart || []) {
      const productId = String(p?.id || "");
      if (productId) keys.add(`prd:${productId}`);
    }

    if (openKey && !keys.has(openKey)) setOpenKey("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, productsInCart]);

  function recentIdsForService(areaId, serviceId) {
    const k = `${String(areaId || "")}::${String(serviceId || "")}`;
    return (recentStaffMap?.[k] || []).map(String).filter(Boolean);
  }

  function recentIdsForProduct(productId) {
    const pid = String(productId || "");
    return (recentProductStaffMap?.[pid] || []).map(String).filter(Boolean);
  }

  function rank(recentIds, s) {
    const id = String(s?.id || "");
    const pos = (recentIds || []).indexOf(id);
    return pos >= 0 ? pos : 9999;
  }

  const hasServices = (services || []).length > 0;
  const hasProducts = (productsInCart || []).length > 0;

  if (!hasServices && !hasProducts) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelTitle}>Mitarbeiter</div>
        <div className={styles.empty}>Bitte zuerst Behandlungen oder Produkte auswählen.</div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Mitarbeiter</div>

      {hasServices ? <div className={styles.staffSectionTitle}>Behandlungen</div> : null}

      {hasServices ? (
        <div className={styles.staffGrid}>
          {services.map((svc) => {
            const serviceId = String(svc.serviceId || "");
            const areaId = String(svc.areaId || "");
            const title = String(svc.title || "Service");
            const selectedId = String(preferredStaffByService?.[serviceId] || preferredStaffByArea?.[areaId] || "");

            // ✅ FIX: Key wirklich UNIQUE (verhindert “2 Boxen offen” Bug)
            const key = `svc:${areaId}:${serviceId || norm(title)}`;
            const open = openKey === key;

            const q = qByKey?.[key] || "";
            const showAll = !!showAllByKey?.[key];

            const recentIds = recentIdsForService(areaId, serviceId);
            const allStaff = staffByArea?.[areaId] || activeStaff;

            const list = (allStaff || [])
              .filter((s) => !q || norm(s?.name).includes(norm(q)))
              .sort((a, b) => {
                if (open) return String(a.name || "").localeCompare(String(b.name || ""));
                return rank(recentIds, a) - rank(recentIds, b) || String(a.name || "").localeCompare(String(b.name || ""));
              });

            const recentObjs = recentIds
              .map((sid) => allStaff.find((x) => String(x.id) === String(sid)))
              .filter(Boolean)
              .slice(0, 6);

            const limit = showAll ? 50 : 10;
            const cardClass = selectedId
              ? `${styles.staffCard} ${styles.staffCardOn}`
              : `${styles.staffCard} ${styles.staffCardNeed}`;

            return (
              <div key={key} className={cardClass}>
                <button type="button" className={styles.staffHeadBtn} onClick={() => toggle(key)}>
                  <div className={styles.staffServiceTitle}>{title}</div>
                  <div className={styles.staffHeadRight}>
                    {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                </button>

                <div className={styles.quickRow}>
                  <div className={styles.quickLabel}>Crew</div>
                  <div className={styles.quickChips}>
                    {recentObjs.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`${styles.quickChip} ${String(selectedId) === String(s.id) ? styles.quickChipOn : ""}`}
                        onClick={() => onPickService?.(serviceId, areaId, String(selectedId) === String(s.id) ? "" : s.id)}
                      >
                        {s.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`${styles.quickChip} ${!selectedId ? styles.quickChipOn : ""}`}
                      onClick={() => onPickService?.(serviceId, areaId, "")}
                    >
                      Frei
                    </button>
                  </div>
                </div>

                {open ? (
                  <>
                    <div className={styles.staffSearchRow}>
                      <input
                        className={styles.search}
                        value={q}
                        onChange={(e) => setQByKey((m) => ({ ...(m || {}), [key]: e.target.value }))}
                        placeholder="Mitarbeiter suchen…"
                      />
                    </div>

                    <div className={styles.staffList}>
                      {list.slice(0, limit).map((s) => {
                        const on = String(selectedId) === String(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            className={`${styles.staffPick} ${on ? styles.staffPickOn : ""}`}
                            onClick={() => onPickService?.(serviceId, areaId, on ? "" : s.id)}
                          >
                            <span className={styles.staffPickName}>{s.name}</span>
                            <span className={styles.staffPickMeta}>{on ? "✓" : ""}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className={styles.favTop}>
                      <div className={styles.miniMuted}>Mehr Mitarbeiter?</div>
                      <button
                        type="button"
                        className={styles.favToggle}
                        onClick={() => setShowAllByKey((p) => ({ ...(p || {}), [key]: !showAll }))}
                      >
                        {showAll ? "Weniger anzeigen" : "Alle anzeigen"}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {hasProducts ? <div className={styles.staffSectionTitle}>Produkte</div> : null}

      {hasProducts ? (
        <div className={styles.staffGrid}>
          {(productsInCart || []).map((p) => {
            const productId = String(p.id || "");
            const title = String(p.title || "Produkt");
            const selectedId = String(preferredStaffByProduct?.[productId] || "");

            const key = `prd:${productId}`;
            const open = openKey === key;
            const q = qByKey?.[key] || "";
            const showAll = !!showAllByKey?.[key];

            const recentIds = recentIdsForProduct(productId);

            const list = (activeStaff || [])
              .filter((s) => !q || norm(s?.name).includes(norm(q)))
              .sort((a, b) => {
                if (open) return String(a.name || "").localeCompare(String(b.name || ""));
                return rank(recentIds, a) - rank(recentIds, b) || String(a.name || "").localeCompare(String(b.name || ""));
              });

            const recentObjs = recentIds
              .map((sid) => activeStaff.find((x) => String(x.id) === String(sid)))
              .filter(Boolean)
              .slice(0, 6);

            const limit = showAll ? 50 : 10;
            const cardClass = selectedId
              ? `${styles.staffCard} ${styles.staffCardOn}`
              : `${styles.staffCard} ${styles.staffCardNeed}`;

            return (
              <div key={key} className={cardClass}>
                <button type="button" className={styles.staffHeadBtn} onClick={() => toggle(key)}>
                  <div className={styles.staffServiceTitle}>{title}</div>
                  <div className={styles.staffHeadRight}>
                    {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                </button>

                <div className={styles.quickRow}>
                  <div className={styles.quickLabel}>Crew</div>
                  <div className={styles.quickChips}>
                    {recentObjs.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`${styles.quickChip} ${String(selectedId) === String(s.id) ? styles.quickChipOn : ""}`}
                        onClick={() => onPickProduct?.(productId, String(selectedId) === String(s.id) ? "" : s.id)}
                      >
                        {s.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`${styles.quickChip} ${!selectedId ? styles.quickChipOn : ""}`}
                      onClick={() => onPickProduct?.(productId, "")}
                    >
                      Frei
                    </button>
                  </div>
                </div>

                {open ? (
                  <>
                    <div className={styles.staffSearchRow}>
                      <input
                        className={styles.search}
                        value={q}
                        onChange={(e) => setQByKey((m) => ({ ...(m || {}), [key]: e.target.value }))}
                        placeholder="Mitarbeiter suchen…"
                      />
                    </div>

                    <div className={styles.staffList}>
                      {list.slice(0, limit).map((s) => {
                        const on = String(selectedId) === String(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            className={`${styles.staffPick} ${on ? styles.staffPickOn : ""}`}
                            onClick={() => onPickProduct?.(productId, on ? "" : s.id)}
                          >
                            <span className={styles.staffPickName}>{s.name}</span>
                            <span className={styles.staffPickMeta}>{on ? "✓" : ""}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className={styles.favTop}>
                      <div className={styles.miniMuted}>Mehr Mitarbeiter?</div>
                      <button
                        type="button"
                        className={styles.favToggle}
                        onClick={() => setShowAllByKey((p) => ({ ...(p || {}), [key]: !showAll }))}
                      >
                        {showAll ? "Weniger anzeigen" : "Alle anzeigen"}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function NotesPanel({ value, onChange }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Hinweise / Kommentar</div>
      <textarea
        className={styles.textarea}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Kommentar / Hinweis..."
      />
    </div>
  );
}

/** ========= Summary list ========= */
function SummaryList({
  rows,
  mode,
  onVoidService,
  onVoidProduct,
  onRestoreService,
  onRestoreProduct,
  onPriceChangeService,
  onPriceChangeProduct,
  onPriceChangeVoidedService,
  onPriceChangeVoidedProduct,
}) {
  const serviceRows = (rows || []).filter((r) => r.kind === "service");
  const productRows = (rows || []).filter((r) => r.kind === "product");

  const hasAnything = (rows || []).length > 0;

  return (
    <div className={styles.summaryWrap}>
      {!hasAnything ? (
        <div className={styles.empty}>Keine Positionen.</div>
      ) : (
        <div className={styles.summaryList}>
          {serviceRows.length > 0 ? (
            <>
              <div className={styles.sumSectionHead}>
                <div className={styles.sumSectionTitle}>Behandlungen</div>
                <div className={styles.sumSectionCount}>{serviceRows.length}</div>
              </div>

              {serviceRows.map((r) => (
                <SummaryRow
                  key={r.key}
                  r={r}
                  mode={mode}
                  onVoidService={onVoidService}
                  onVoidProduct={onVoidProduct}
                  onRestoreService={onRestoreService}
                  onRestoreProduct={onRestoreProduct}
                  onPriceChangeService={onPriceChangeService}
                  onPriceChangeProduct={onPriceChangeProduct}
                  onPriceChangeVoidedService={onPriceChangeVoidedService}
                  onPriceChangeVoidedProduct={onPriceChangeVoidedProduct}
                />
              ))}
            </>
          ) : null}

          {serviceRows.length > 0 && productRows.length > 0 ? (
            <div className={styles.sumSectionDivider} />
          ) : null}

          {productRows.length > 0 ? (
            <>
              <div className={styles.sumSectionHead}>
                <div className={styles.sumSectionTitle}>Produkte</div>
                <div className={styles.sumSectionCount}>
                  {productRows.reduce((n, r) => n + Number(r.qty || 0), 0)}
                </div>
              </div>

              {productRows.map((r) => (
                <SummaryRow
                  key={r.key}
                  r={r}
                  mode={mode}
                  onVoidService={onVoidService}
                  onVoidProduct={onVoidProduct}
                  onRestoreService={onRestoreService}
                  onRestoreProduct={onRestoreProduct}
                  onPriceChangeService={onPriceChangeService}
                  onPriceChangeProduct={onPriceChangeProduct}
                  onPriceChangeVoidedService={onPriceChangeVoidedService}
                  onPriceChangeVoidedProduct={onPriceChangeVoidedProduct}
                />
              ))}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}


function SummaryRow({
  r,
  mode,
  onVoidService,
  onVoidProduct,
  onRestoreService,
  onRestoreProduct,
  onPriceChangeService,
  onPriceChangeProduct,
  onPriceChangeVoidedService,
  onPriceChangeVoidedProduct,
}) {
  const [showPrice, setShowPrice] = useState(false);
  const holdTimer = useRef(null);

  function startHold() {
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => setShowPrice(true), 450);
  }
  function endHold() {
    window.clearTimeout(holdTimer.current);
  }

  const priceValue = Number(r.unitPrice || 0).toFixed(2);

  return (
    <div className={styles.sumRow}>
      <div className={styles.sumLeft}>
        <div className={styles.sumTitle}>
          {r.title}
          {r.kind === "product" && Number(r.qty || 0) > 1 ? (
            <span className={styles.inlineQtyTag}>×{Number(r.qty)}</span>
          ) : null}
        </div>
        {r.staffName ? <div className={styles.sumMeta}>{`Crew: ${r.staffName}`}</div> : null}
      </div>

      <div className={styles.sumRight}>
        <div
          className={styles.hiddenPrice}
          onClick={() => setShowPrice((v) => !v)}
          onMouseDown={startHold}
          onMouseUp={endHold}
          onMouseLeave={endHold}
          onTouchStart={startHold}
          onTouchEnd={endHold}
          title="Preis"
        >
          {!showPrice ? (
            <span className={styles.hiddenPriceHint}>
              <Euro size={18} />
            </span>
          ) : (
            <span
              className={styles.priceCell}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              {/* ✅ Preis schließen: X statt Euro */}
              <button
                type="button"
                className={styles.priceToggleIcon}
                title="Preis schließen"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowPrice(false);
                }}
              >
                <X size={14} />
              </button>

              <input
                className={styles.priceInput}
                defaultValue={priceValue}
                inputMode="decimal"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const v = e.target.value;
                  if (r.kind === "service") {
                    if (mode === "active") onPriceChangeService?.(r.serviceId, v);
                    else onPriceChangeVoidedService?.(r.serviceId, v);
                  } else {
                    if (mode === "active") onPriceChangeProduct?.(r.productId, v);
                    else onPriceChangeVoidedProduct?.(r.productId, v);
                  }
                }}
              />
              <span className={styles.eur}>€</span>
            </span>
          )}
        </div>

        <div className={styles.sumActions}>
          {mode === "active" ? (
            r.kind === "service" ? (
              <button
                className={styles.rowActionDanger}
                type="button"
                onClick={() => onVoidService?.(r.serviceId)}
                title="Stornieren"
              >
                {/* ✅ größer */}
                <Trash2 size={20} />
              </button>
            ) : (
              <button
                className={styles.rowActionDanger}
                type="button"
                onClick={() => onVoidProduct?.(r.productId)}
                title="Stornieren"
              >
                <Trash2 size={20} />
              </button>
            )
          ) : r.kind === "service" ? (
            <button
              className={styles.rowActionDanger}
              type="button"
              onClick={() => onRestoreService?.(r.serviceId)}
              title="Wiederherstellen"
            >
              {/* ✅ nicht grün, gleiches Design wie Delete + größer */}
              <RotateCcw size={20} />
            </button>
          ) : (
            <button
              className={styles.rowActionDanger}
              type="button"
              onClick={() => onRestoreProduct?.(r.productId)}
              title="Wiederherstellen"
            >
              <RotateCcw size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
