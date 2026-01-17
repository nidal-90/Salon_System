import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../../db/index.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";
import { createVisitFromOrder } from "../api/orderApi.js";
import styles from "./KioskOrderEmbed.module.css";

export default function KioskOrderEmbed({ profile, onDone, onCancel, draftId }) {
  // LEFT NAV TABS
  // treatment | staff | products | notes | cart
  const [tab, setTab] = useState("treatment");

  // CART SUB TABS (Firefox-like)
  // active | void
  const [cartTab, setCartTab] = useState("active");

  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [areas, setAreas] = useState([]);
  const [productCategories, setProductCategories] = useState([]);

  // Auswahl (aktive Positionen)
  const [selectedServiceIds, setSelectedServiceIds] = useState(new Set());
  const [serviceQtyById, setServiceQtyById] = useState({}); // NEW: qty for services

  const [preferredStaffByArea, setPreferredStaffByArea] = useState({});
  const [comment, setComment] = useState(profile?.note || "");
  const [cart, setCart] = useState([]); // products [{id,title,price,qty,categoryId?}]

  // Storniert (Positionen die in "Storniert"-Tab erscheinen)
  const [voidedServices, setVoidedServices] = useState([]); // [{serviceId, areaId, title, price, qty}]
  const [voidedProducts, setVoidedProducts] = useState([]); // [{id,title,price,qty,categoryId?}]

  // Orange-Markierung: was war bereits im bestehenden Visit?
  const [existingServiceIds, setExistingServiceIds] = useState(new Set());
  const [existingProductIds, setExistingProductIds] = useState(new Set());

  // Filter
  const [serviceAreaId, setServiceAreaId] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const [productCategoryId, setProductCategoryId] = useState("");
  const [productQuery, setProductQuery] = useState("");

  // Draft meta
  const [activeDraftId, setActiveDraftId] = useState(draftId || "");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");

  // Price overrides for services (aktive Services)
  const [servicePriceOverrides, setServicePriceOverrides] = useState({});

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

    db.staff.toArray().then((rows) => setStaff(rows || []));
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

  useEffect(() => setServiceQuery(""), [serviceAreaId]);
  useEffect(() => setProductQuery(""), [productCategoryId]);

  const displayName = useMemo(() => {
    const n = String(profile?.displayName || "").trim();
    return n || "—";
  }, [profile]);

  /** ============== Visible lists ============== */
  const visibleServices = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase();
    return services.filter((s) => {
      if (serviceAreaId && String(s.areaId || "") !== String(serviceAreaId)) return false;
      const title = String(s.name || s.title || "").toLowerCase();
      return !q || title.includes(q);
    });
  }, [services, serviceAreaId, serviceQuery]);

  const visibleProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (productCategoryId && String(p.categoryId || "") !== String(productCategoryId)) return false;
      const title = String(p.name || p.title || "").toLowerCase();
      return !q || title.includes(q);
    });
  }, [products, productCategoryId, productQuery]);

  /** ============== Selected services (with qty) ============== */
  const selectedServices = useMemo(() => {
    const ids = selectedServiceIds;
    return services
      .filter((s) => ids.has(s.id))
      .map((s) => {
        const qty = clampInt(serviceQtyById?.[s.id] ?? 1, 1, 99);
        return {
          serviceId: s.id,
          areaId: s.areaId || "",
          title: s.name || s.title || "Service",
          price: Number(s.price || 0),
          qty,
        };
      });
  }, [services, selectedServiceIds, serviceQtyById]);

  const effectiveSelectedServices = useMemo(() => {
    return selectedServices.map((s) => {
      const ov = servicePriceOverrides?.[s.serviceId];
      const unitPrice = Number.isFinite(ov) ? Number(ov) : Number(s.price || 0);
      return {
        ...s,
        unitPrice,
        lineTotal: Number(unitPrice) * Number(s.qty || 1),
      };
    });
  }, [selectedServices, servicePriceOverrides]);

  const requestedAreaIds = useMemo(() => {
    const set = new Set(selectedServices.map((s) => s.areaId).filter(Boolean));
    return Array.from(set);
  }, [selectedServices]);

  /** ============== staff map per area ============== */
  const staffByArea = useMemo(() => {
    const activeStaff = staff.filter((x) => Number(x.active) === 1 || x.active === true);
    const map = {};
    for (const areaId of requestedAreaIds) map[areaId] = activeStaff;
    return map;
  }, [staff, requestedAreaIds]);

  /** ============== Staff tab: show ordered services per area ============== */
  const servicesByAreaForPreview = useMemo(() => {
    const map = {};
    for (const s of effectiveSelectedServices || []) {
      const a = String(s.areaId || "");
      if (!a) continue;
      if (!map[a]) map[a] = [];
      map[a].push({
        title: s.title,
        qty: Number(s.qty || 1),
      });
    }
    return map;
  }, [effectiveSelectedServices]);

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

      servicesJson: JSON.stringify(
        (effectiveSelectedServices || []).map((x) => ({
          serviceId: x.serviceId,
          areaId: x.areaId,
          title: x.title,
          price: Number(x.unitPrice || 0),
          qty: Number(x.qty || 1),
        }))
      ),
      productsJson: JSON.stringify(
        (cart || []).map((x) => ({
          productId: x.id,
          title: x.title,
          price: Number(x.price || 0),
          qty: Number(x.qty || 0),
          categoryId: x.categoryId || "",
        }))
      ),

      voidedServicesJson: JSON.stringify(
        (voidedServices || []).map((x) => ({
          serviceId: x.serviceId,
          areaId: x.areaId,
          title: x.title,
          price: Number(x.price || 0),
          qty: Number(x.qty || 1),
        }))
      ),
      voidedProductsJson: JSON.stringify(
        (voidedProducts || []).map((x) => ({
          productId: x.id,
          title: x.title,
          price: Number(x.price || 0),
          qty: Number(x.qty || 0),
          categoryId: x.categoryId || "",
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

        // Services: ids + qty
        const set = new Set();
        const qtyMap = {};
        const ov = {};

        for (const line of s || []) {
          const sid = line?.serviceId;
          if (!sid) continue;
          set.add(sid);

          const q = clampInt(line?.qty ?? 1, 1, 99);
          qtyMap[sid] = (qtyMap[sid] || 0) + q;

          // override vs catalog
          const draftPrice = Number(line?.price || 0);
          const cat = services.find((z) => z.id === sid);
          const catPrice = Number(cat?.price || 0);
          if (Number.isFinite(draftPrice) && Number.isFinite(catPrice) && draftPrice !== catPrice) ov[sid] = draftPrice;
        }

        setSelectedServiceIds(set);
        setServiceQtyById(qtyMap);
        setServicePriceOverrides(ov);

        setPreferredStaffByArea(d.requestedStaffByArea || {});
        setComment(String(d.comment || profile?.note || ""));

        setCart(
          (p || []).map((x) => ({
            id: x.productId || x.id,
            title: x.title,
            price: Number(x.price || 0),
            qty: Number(x.qty || 0),
            categoryId: x.categoryId || "",
          }))
        );

        setVoidedServices(
          (vs || []).map((x) => ({
            serviceId: x.serviceId,
            areaId: x.areaId || "",
            title: x.title || "Service",
            price: Number(x.price || 0),
            qty: clampInt(x.qty ?? 1, 1, 99),
          }))
        );

        setVoidedProducts(
          (vp || []).map((x) => ({
            id: x.productId || x.id,
            title: x.title || "Produkt",
            price: Number(x.price || 0),
            qty: clampInt(x.qty ?? 1, 1, 999),
            categoryId: x.categoryId || "",
          }))
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
    serviceQtyById,
    preferredStaffByArea,
    comment,
    cart,
    servicePriceOverrides,
    voidedServices,
    voidedProducts,
  ]);

  /** ============== Edit-mode hydrate ============== */
  useEffect(() => {
    let alive = true;

    async function hydrateFromExistingVisit() {
      if (!isEdit || !editVisitId) return;

      setMsg("");
      setSelectedServiceIds(new Set());
      setServiceQtyById({});
      setPreferredStaffByArea({});
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

      // services: count occurrences to qty
      const selected = new Set();
      const existing = new Set();
      const ov = {};
      const qtyMap = {};

      for (const line of vs || []) {
        const title = String(line?.title || line?.name || "").trim();
        const areaId = String(line?.areaId || "").trim();
        const price = Number(line?.price || 0);

        const cat = services.find((s) => {
          const t = String(s.name || s.title || "").trim();
          return t === title && String(s.areaId || "") === areaId;
        });

        const serviceId = cat?.id || line?.serviceId || "";
        if (serviceId) {
          selected.add(serviceId);
          existing.add(serviceId);
          qtyMap[serviceId] = (qtyMap[serviceId] || 0) + 1;

          const catPrice = Number(cat?.price || 0);
          if (Number.isFinite(price) && Number.isFinite(catPrice) && price !== catPrice) ov[serviceId] = Number(price);
        }
      }

      setSelectedServiceIds(selected);
      setExistingServiceIds(existing);
      setServiceQtyById(qtyMap);
      setServicePriceOverrides(ov);

      const cartLines = [];
      const existingP = new Set();
      for (const line of vp || []) {
        const pid = line?.productId || line?.id;
        if (!pid) continue;
        existingP.add(String(pid));
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
    setSelectedServiceIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
        // cleanup qty + override
        setServiceQtyById((m) => {
          const next = { ...m };
          delete next[id];
          return next;
        });
        setServicePriceOverrides((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
      } else {
        n.add(id);
        setServiceQtyById((m) => ({ ...m, [id]: clampInt(m?.[id] ?? 1, 1, 99) || 1 }));
      }
      return n;
    });
  }

  // Service qty +/- in cart table
  function incServiceQty(serviceId) {
    const id = String(serviceId || "");
    if (!id) return;
    if (!selectedServiceIds.has(id)) {
      setSelectedServiceIds((prev) => new Set([...Array.from(prev), id]));
    }
    setServiceQtyById((m) => {
      const cur = clampInt(m?.[id] ?? 1, 1, 99);
      const next = Math.min(99, cur + 1);
      return { ...m, [id]: next };
    });
  }

  function decServiceQty(serviceId) {
    const id = String(serviceId || "");
    if (!id) return;
    const cur = clampInt(serviceQtyById?.[id] ?? 1, 1, 99);
    const next = cur - 1;

    if (next <= 0) {
      setSelectedServiceIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      setServiceQtyById((m) => {
        const nm = { ...m };
        delete nm[id];
        return nm;
      });
      setServicePriceOverrides((p) => {
        const np = { ...p };
        delete np[id];
        return np;
      });
      return;
    }

    setServiceQtyById((m) => ({ ...m, [id]: next }));
  }

  function addProduct(p) {
    setCart((prev) => {
      const title = p.name || p.title || "Produkt";
      const price = Number(p.price || 0);
      const categoryId = String(p.categoryId || "");
      const idx = prev.findIndex((x) => String(x.id) === String(p.id));
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: clampInt(next[idx].qty + 1, 1, 999) };
        return next;
      }
      return [...prev, { id: p.id, title, price, qty: 1, categoryId }];
    });
  }

  function incProductQty(productId) {
    setCart((prev) => {
      const idx = prev.findIndex((x) => String(x.id) === String(productId));
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], qty: clampInt(next[idx].qty + 1, 1, 999) };
      return next;
    });
  }

  function decProductQty(productId) {
    setCart((prev) => {
      const idx = prev.findIndex((x) => String(x.id) === String(productId));
      if (idx < 0) return prev;
      const next = [...prev];
      const item = next[idx];
      const q = clampInt(item.qty, 1, 999);
      if (q <= 1) return next.filter((x) => String(x.id) !== String(productId));
      next[idx] = { ...item, qty: q - 1 };
      return next;
    });
  }

  /** ============== Inline price editing (table) ============== */
  function setServicePriceInline(serviceId, raw) {
    const n = parseMoneyInput(raw);
    if (n == null) return;
    setServicePriceOverrides((p) => ({ ...p, [serviceId]: n }));
  }

  function setVoidedServicePriceInline(serviceId, raw) {
    const n = parseMoneyInput(raw);
    if (n == null) return;
    setVoidedServices((prev) => prev.map((x) => (x.serviceId === serviceId ? { ...x, price: n } : x)));
  }

  function setProductPriceInline(productId, raw) {
    const n = parseMoneyInput(raw);
    if (n == null) return;
    setCart((prev) => prev.map((x) => (String(x.id) === String(productId) ? { ...x, price: n } : x)));
  }

  function setVoidedProductPriceInline(productId, raw) {
    const n = parseMoneyInput(raw);
    if (n == null) return;
    setVoidedProducts((prev) => prev.map((x) => (String(x.id) === String(productId) ? { ...x, price: n } : x)));
  }

  /** ============== Voided qty +/- ============== */
  function incVoidedServiceQty(serviceId) {
    setVoidedServices((prev) =>
      prev.map((x) => (String(x.serviceId) === String(serviceId) ? { ...x, qty: clampInt((x.qty || 1) + 1, 1, 99) } : x))
    );
  }

  function decVoidedServiceQty(serviceId) {
    setVoidedServices((prev) => {
      const next = prev.map((x) => {
        if (String(x.serviceId) !== String(serviceId)) return x;
        const q = clampInt(x.qty || 1, 1, 99);
        return { ...x, qty: q - 1 };
      });
      return next.filter((x) => clampInt(x.qty || 0, 0, 99) > 0);
    });
  }

  function incVoidedProductQty(productId) {
    setVoidedProducts((prev) =>
      prev.map((x) => (String(x.id) === String(productId) ? { ...x, qty: clampInt((x.qty || 1) + 1, 1, 999) } : x))
    );
  }

  function decVoidedProductQty(productId) {
    setVoidedProducts((prev) => {
      const next = prev.map((x) => {
        if (String(x.id) !== String(productId)) return x;
        const q = clampInt(x.qty || 1, 1, 999);
        return { ...x, qty: q - 1 };
      });
      return next.filter((x) => clampInt(x.qty || 0, 0, 999) > 0);
    });
  }

  /** ============== Move line to "Storniert" ============== */
  function voidServiceLine(serviceId) {
    const line = effectiveSelectedServices.find((s) => String(s.serviceId) === String(serviceId));
    if (!line) return;

    // remove from active
    setSelectedServiceIds((prev) => {
      const n = new Set(prev);
      n.delete(serviceId);
      return n;
    });
    setServiceQtyById((m) => {
      const next = { ...m };
      delete next[serviceId];
      return next;
    });

    setVoidedServices((prev) => {
      const idx = prev.findIndex((x) => String(x.serviceId) === String(serviceId));
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: clampInt((next[idx].qty || 1) + Number(line.qty || 1), 1, 99), price: Number(line.unitPrice || 0) };
        return next;
      }
      return [
        ...prev,
        {
          serviceId,
          areaId: line.areaId || "",
          title: line.title,
          price: Number(line.unitPrice || 0),
          qty: clampInt(line.qty || 1, 1, 99),
        },
      ];
    });

    // cleanup override
    setServicePriceOverrides((p) => {
      const next = { ...p };
      delete next[serviceId];
      return next;
    });
  }

  function restoreVoidedService(serviceId) {
    const line = voidedServices.find((x) => String(x.serviceId) === String(serviceId));
    if (!line) return;

    setVoidedServices((prev) => prev.filter((x) => String(x.serviceId) !== String(serviceId)));

    setSelectedServiceIds((prev) => new Set([...Array.from(prev), serviceId]));
    setServiceQtyById((m) => {
      const cur = clampInt(m?.[serviceId] ?? 0, 0, 99);
      const add = clampInt(line.qty ?? 1, 1, 99);
      return { ...m, [serviceId]: clampInt(cur + add, 1, 99) };
    });

    // preserve price as override
    setServicePriceOverrides((p) => ({ ...p, [serviceId]: Number(line.price || 0) }));
  }

  function voidProductLine(productId) {
    const line = cart.find((x) => String(x.id) === String(productId));
    if (!line) return;

    setCart((prev) => prev.filter((x) => String(x.id) !== String(productId)));

    setVoidedProducts((prev) => {
      const idx = prev.findIndex((x) => String(x.id) === String(productId));
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          qty: clampInt((next[idx].qty || 1) + Number(line.qty || 1), 1, 999),
          price: Number(line.price || 0),
        };
        return next;
      }
      return [...prev, { ...line }];
    });
  }

  function restoreVoidedProduct(productId) {
    const line = voidedProducts.find((x) => String(x.id) === String(productId));
    if (!line) return;

    setVoidedProducts((prev) => prev.filter((x) => String(x.id) !== String(productId)));

    setCart((prev) => {
      const idx = prev.findIndex((x) => String(x.id) === String(productId));
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: clampInt((next[idx].qty || 1) + Number(line.qty || 1), 1, 999) };
        return next;
      }
      return [...prev, { ...line }];
    });
  }

  /** ============== Totals ============== */
  const totals = useMemo(() => {
    const serviceSum = (effectiveSelectedServices || []).reduce((s, x) => s + Number(x.unitPrice || 0) * Number(x.qty || 1), 0);
    const productSum = (cart || []).reduce((s, x) => s + Number(x.price || 0) * Number(x.qty || 0), 0);
    const total = Number(serviceSum + productSum);
    return {
      serviceSum: Number(serviceSum.toFixed(2)),
      productSum: Number(productSum.toFixed(2)),
      total: Number(total.toFixed(2)),
    };
  }, [effectiveSelectedServices, cart]);

  const voidTotals = useMemo(() => {
    const s = (voidedServices || []).reduce((a, x) => a + Number(x.price || 0) * Number(x.qty || 1), 0);
    const p = (voidedProducts || []).reduce((a, x) => a + Number(x.price || 0) * Number(x.qty || 0), 0);
    return { total: Number((s + p).toFixed(2)) };
  }, [voidedServices, voidedProducts]);

  /** ============== Preferred staff rows for chips ============== */
  const preferredStaffSummary = useMemo(() => {
    const entries = Object.entries(preferredStaffByArea || {});
    const clean = entries
      .map(([areaId, staffId]) => ({
        areaId: String(areaId || ""),
        areaName: areaNameById(areaId),
        staffId: String(staffId || ""),
        staffName: staffNameById(staffId),
      }))
      .filter((x) => x.areaId && x.staffId);
    clean.sort((a, b) => String(a.areaName).localeCompare(String(b.areaName)));
    return clean;
  }, [preferredStaffByArea, areas, staff]);

  /** ============== Smart table rows ============== */
  const activeRows = useMemo(() => {
    const rows = [];

    for (const s of effectiveSelectedServices || []) {
      const areaId = String(s.areaId || "");
      const prefStaffId = String(preferredStaffByArea?.[areaId] || "");
      rows.push({
        key: `svc:${s.serviceId}`,
        kind: "service",
        areaId,
        areaName: areaNameById(areaId),
        staffId: prefStaffId,
        staffName: prefStaffId ? staffNameById(prefStaffId) : "",
        title: String(s.title || "Service"),
        qty: Number(s.qty || 1),
        unitPrice: Number(s.unitPrice || 0),
        lineTotal: Number(s.unitPrice || 0) * Number(s.qty || 1),
        serviceId: s.serviceId,
        productId: "",
        categoryId: "",
        categoryName: "",
      });
    }

    for (const p of cart || []) {
      const catName = p.categoryId ? categoryNameById(p.categoryId) : (productCategoryId ? categoryNameById(productCategoryId) : "");
      rows.push({
        key: `prd:${p.id}`,
        kind: "product",
        areaId: "",
        areaName: "—",
        staffId: "",
        staffName: "",
        title: String(p.title || "Produkt"),
        qty: Number(p.qty || 0),
        unitPrice: Number(p.price || 0),
        lineTotal: Number(p.price || 0) * Number(p.qty || 0),
        serviceId: "",
        productId: p.id,
        categoryId: p.categoryId || "",
        categoryName: catName || (p.categoryId ? categoryNameById(p.categoryId) : ""),
      });
    }

    return rows;
  }, [effectiveSelectedServices, cart, preferredStaffByArea, staff, areas, productCategories, productCategoryId]);

  const voidRows = useMemo(() => {
    const rows = [];

    for (const s of voidedServices || []) {
      const areaId = String(s.areaId || "");
      const prefStaffId = String(preferredStaffByArea?.[areaId] || "");
      rows.push({
        key: `vsvc:${s.serviceId}`,
        kind: "service",
        areaId,
        areaName: areaNameById(areaId),
        staffId: prefStaffId,
        staffName: prefStaffId ? staffNameById(prefStaffId) : "",
        title: String(s.title || "Service"),
        qty: Number(s.qty || 1),
        unitPrice: Number(s.price || 0),
        lineTotal: Number(s.price || 0) * Number(s.qty || 1),
        serviceId: s.serviceId,
        productId: "",
        categoryId: "",
        categoryName: "",
      });
    }

    for (const p of voidedProducts || []) {
      const catName = p.categoryId ? categoryNameById(p.categoryId) : "";
      rows.push({
        key: `vprd:${p.id}`,
        kind: "product",
        areaId: "",
        areaName: "—",
        staffId: "",
        staffName: "",
        title: String(p.title || "Produkt"),
        qty: Number(p.qty || 0),
        unitPrice: Number(p.price || 0),
        lineTotal: Number(p.price || 0) * Number(p.qty || 0),
        serviceId: "",
        productId: p.id,
        categoryId: p.categoryId || "",
        categoryName: catName || "",
      });
    }

    return rows;
  }, [voidedServices, voidedProducts, preferredStaffByArea, staff, areas, productCategories]);

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

    // services: store as repeated rows (schema has no qty)
    await db.visit_services.where("visitId").equals(visitId).delete().catch(() => {});
    const vsRows = [];
    for (const s of effectiveSelectedServices || []) {
      const q = clampInt(s.qty || 1, 1, 99);
      for (let i = 0; i < q; i++) {
        vsRows.push({
          id: uid("vs"),
          visitId,
          createdAt: now,
          updatedAt: now,
          dateKey,
          areaId: String(s.areaId || ""),
          title: String(s.title || "Service"),
          price: Number(s.unitPrice || 0),
          staffId: "",
          staffName: "",
          startedAt: "",
          endedAt: "",
          note: "",
        });
      }
    }
    if (vsRows.length) await db.visit_services.bulkAdd(vsRows).catch(() => {});

    await db.visit_products.where("visitId").equals(visitId).delete().catch(() => {});
    const vpRows = (cart || []).map((p) => ({
      id: uid("vp"),
      visitId,
      createdAt: now,
      updatedAt: now,
      dateKey,
      productId: p.id,
      title: String(p.title || "Produkt"),
      price: Number(p.price || 0),
      qty: Number(p.qty || 1),
      staffId: "",
      staffName: "",
    }));
    if (vpRows.length) await db.visit_products.bulkAdd(vpRows).catch(() => {});

    for (const areaId of requestedAreaIds) {
      const key = String(areaId || "");
      if (!key) continue;

      const preferredStaffId = String(preferredStaffByArea?.[key] || "");
      const preferredStaffName = preferredStaffId ? staffNameById(preferredStaffId) : "";

      const existing = await db.visit_area_state
        .where("[visitId+areaId]")
        .equals([visitId, key])
        .first()
        .catch(() => null);

      if (existing?.id) {
        await db.visit_area_state
          .update(existing.id, { updatedAt: now, dateKey, preferredStaffId, preferredStaffName })
          .catch(() => {});
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

    setExistingServiceIds(new Set(Array.from(selectedServiceIds)));
    setExistingProductIds(new Set((cart || []).map((x) => String(x.id))));
  }

  async function finalize() {
    setMsg("");

    if ((effectiveSelectedServices || []).length === 0) {
      setMsg("Bitte mindestens eine Behandlung auswählen.");
      setTab("treatment");
      return;
    }

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

      // Create: expand services by qty (schema has no qty)
      const expandedServices = [];
      for (const s of effectiveSelectedServices || []) {
        const q = clampInt(s.qty || 1, 1, 99);
        for (let i = 0; i < q; i++) {
          expandedServices.push({
            serviceId: s.serviceId,
            areaId: s.areaId,
            title: s.title,
            price: Number(s.unitPrice || 0),
          });
        }
      }

      const res = await createVisitFromOrder({
        profile,
        comment,
        selectedServices: expandedServices,
        preferredStaffByArea,
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

  async function voidDraft() {
    const ok = confirm(isEdit ? "Änderungen verwerfen und schließen?" : "Order stornieren?");
    if (!ok) return;

    const hasDraftTable = (db?.tables || []).some((t) => t?.name === "order_drafts");
    if (!hasDraftTable || !activeDraftId) {
      onCancel?.();
      return;
    }

    const now = new Date().toISOString();
    const snap = buildDraftPayloadCore();
    await db.order_drafts.update(activeDraftId, {
      status: "void",
      voidedAt: now,
      updatedAt: now,
      ...snap,
    });
    await logOrderEvent("void", { snapshot: snap, isEdit, visitId: editVisitId });
    onCancel?.();
  }

  /** ============== Footer sum click -> Warenkorb ============== */
  function goToCart() {
    setTab("cart");
    setCartTab("active");
  }

  const activeServiceCount = useMemo(() => activeRows.filter((r) => r.kind === "service").length, [activeRows]);
  const activeProductCount = useMemo(
    () => activeRows.filter((r) => r.kind === "product").reduce((n, r) => n + Number(r.qty || 0), 0),
    [activeRows]
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <div className={styles.kicker}>{isEdit ? "Bearbeiten" : "Check-in"}</div>
          <div className={styles.name}>{displayName}</div>
        </div>
      </div>

      <div className={styles.body}>
        <aside className={styles.tabs}>
          <Tab label="Behandlung" active={tab === "treatment"} onClick={() => setTab("treatment")} />
          <Tab label="Wunsch Mitarbeiter" active={tab === "staff"} onClick={() => setTab("staff")} />
          <Tab label="Produkte" active={tab === "products"} onClick={() => setTab("products")} />
          {/* RENAMED: Kommentare -> Hinweise (professioneller) */}
          <Tab label="Hinweise" active={tab === "notes"} onClick={() => setTab("notes")} />
          <Tab label="Warenkorb" active={tab === "cart"} onClick={() => setTab("cart")} />
        </aside>

        <main className={styles.main}>
          <div className={styles.mainScroll}>
            {/* TREATMENT */}
            {tab === "treatment" && (
              <div className={styles.panel}>
                <div className={styles.panelTop}>
                  <div className={styles.panelTitle}>Behandlungen</div>
                  <div className={styles.searchWrap}>
                    <input
                      className={styles.search}
                      value={serviceQuery}
                      onChange={(e) => setServiceQuery(e.target.value)}
                      placeholder="Suche Service…"
                    />
                  </div>
                </div>

                <div className={styles.chipsRow}>
                  {areas
                    .filter((a) => services.some((s) => String(s.areaId) === String(a.id)))
                    .slice(0, 12)
                    .map((a) => (
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

                <div className={styles.listBox}>
                  {visibleServices.length === 0 ? (
                    <div className={styles.empty}>Keine Services gefunden{serviceQuery ? " (Filter aktiv)" : ""}.</div>
                  ) : (
                    <div className={styles.items}>
                      {visibleServices.map((s) => {
                        const on = selectedServiceIds.has(s.id);
                        const wasInVisit = existingServiceIds.has(s.id);
                        const title = s.name || s.title || "Service";
                        const qty = on ? clampInt(serviceQtyById?.[s.id] ?? 1, 1, 99) : 0;

                        return (
                          <div
                            key={s.id}
                            className={`${styles.item} ${on ? styles.itemOn : ""} ${wasInVisit ? styles.itemWarn : ""}`}
                          >
                            <div className={styles.itemLeft}>
                              <div className={styles.itemTitle}>
                                {title}
                                {on ? <span className={styles.inlineQtyTag}>x{qty}</span> : null}
                              </div>
                              <div className={styles.itemMeta}>
                                {Number(s.price || 0).toFixed(2)} €
                                {wasInVisit ? <span className={styles.warnTag}>bereits gebucht</span> : null}
                              </div>
                            </div>

                            <div className={styles.itemRight}>
                              {on ? (
                                <div className={styles.inlineStepper}>
                                  <button type="button" className={styles.stepBtn} onClick={() => decServiceQty(s.id)}>
                                    −
                                  </button>
                                  <div className={styles.stepVal}>{qty}</div>
                                  <button type="button" className={styles.stepBtn} onClick={() => incServiceQty(s.id)}>
                                    +
                                  </button>
                                </div>
                              ) : null}

                              <button
                                className={`${styles.itemBtn} ${on ? styles.itemBtnOn : ""}`}
                                onClick={() => toggleService(s.id)}
                                type="button"
                              >
                                {on ? "Entfernen" : "Wählen"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* PRODUCTS */}
            {tab === "products" && (
              <div className={styles.panel}>
                <div className={styles.panelTop}>
                  <div className={styles.panelTitle}>Produkte</div>
                  <div className={styles.searchWrap}>
                    <input
                      className={styles.search}
                      value={productQuery}
                      onChange={(e) => setProductQuery(e.target.value)}
                      placeholder="Suche Produkt…"
                    />
                  </div>
                </div>

                <div className={styles.chipsRow}>
                  {productCategories
                    .filter((c) => products.some((p) => String(p.categoryId) === String(c.id)))
                    .slice(0, 12)
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

                <div className={styles.listBox}>
                  {visibleProducts.length === 0 ? (
                    <div className={styles.empty}>Keine Produkte gefunden{productQuery ? " (Filter aktiv)" : ""}.</div>
                  ) : (
                    <div className={styles.items}>
                      {visibleProducts.map((p) => {
                        const wasInVisit = existingProductIds.has(String(p.id));
                        const cat = categoryNameById(p.categoryId);

                        return (
                          <div key={p.id} className={`${styles.item} ${wasInVisit ? styles.itemWarn : ""}`}>
                            <div className={styles.itemLeft}>
                              <div className={styles.itemTitle}>{p.name || p.title || "Produkt"}</div>
                              <div className={styles.itemMeta}>
                                {Number(p.price || 0).toFixed(2)} €
                            
                                {wasInVisit ? <span className={styles.warnTag}>bereits gebucht</span> : null}
                              </div>
                            </div>

                            <div className={styles.productBtns}>
                              <button className={styles.itemBtn} onClick={() => addProduct(p)} type="button">
                                + Hinzufügen
                              </button>
                              <button className={styles.itemBtnGhost} onClick={() => decProductQty(p.id)} type="button">
                                −
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* STAFF */}
            {tab === "staff" && (
              <StaffPanel
                requestedAreaIds={requestedAreaIds}
                staffByArea={staffByArea}
                preferredStaffByArea={preferredStaffByArea}
                onChange={(areaId, staffId) => setPreferredStaffByArea((p) => ({ ...p, [areaId]: staffId }))}
                areaNameById={areaNameById}
                servicesByAreaForPreview={servicesByAreaForPreview}
              />
            )}

            {/* NOTES (Hinweise): keine "Änderungen"-Box hier */}
            {tab === "notes" && <NotesPanel value={comment} onChange={setComment} />}

            {/* CART TAB */}
            {tab === "cart" && (
              <div className={styles.panel}>
                <div className={styles.panelTop}>
                  <div className={styles.panelTitle}>Warenkorb</div>
                </div>

                {/* Notiz NUR anzeigen (read-only) */}
                <div className={styles.noteReadOnlyCard}>
                  <div className={styles.noteReadOnlyTitle}>Notiz</div>
                  <div className={styles.noteReadOnlyText}>
                    {String(comment || "").trim() ? String(comment || "").trim() : "—"}
                  </div>
                </div>

                {/* Firefox-like sub tabs */}
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

                {/* Table */}
                {cartTab === "active" ? (
                  <CartTable
                    rows={activeRows}
                    mode="active"
                    onVoidService={voidServiceLine}
                    onVoidProduct={voidProductLine}
                    onPriceChangeService={setServicePriceInline}
                    onPriceChangeProduct={setProductPriceInline}
                    onQtyIncService={incServiceQty}
                    onQtyDecService={decServiceQty}
                    onQtyIncProduct={incProductQty}
                    onQtyDecProduct={decProductQty}
                  />
                ) : (
                  <CartTable
                    rows={voidRows}
                    mode="void"
                    onRestoreService={restoreVoidedService}
                    onRestoreProduct={restoreVoidedProduct}
                    onPriceChangeVoidedService={setVoidedServicePriceInline}
                    onPriceChangeVoidedProduct={setVoidedProductPriceInline}
                    onQtyIncVoidedService={incVoidedServiceQty}
                    onQtyDecVoidedService={decVoidedServiceQty}
                    onQtyIncVoidedProduct={incVoidedProductQty}
                    onQtyDecVoidedProduct={decVoidedProductQty}
                  />
                )}

                <div className={styles.cartFoot}>
                  <div className={styles.cartFootLeft}>
                    <div className={styles.cartFootLabel}>Wunsch-Mitarbeiter</div>
                    {(preferredStaffSummary || []).length === 0 ? (
                      <div className={styles.cartFootEmpty}>—</div>
                    ) : (
                      <div className={styles.cartFootStaff}>
                        {preferredStaffSummary.map((x) => (
                          <span key={`${x.areaId}-${x.staffId}`} className={styles.cartFootStaffChip}>
                            {x.areaName}: {x.staffName || x.staffId}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* SUMME: nur die passende Summe pro Sub-Tab anzeigen */}
                  <div className={styles.cartFootRight}>
                    {cartTab === "active" ? (
                      <div className={styles.cartTotalRow}>
                        <span>Summe: </span>
                        <b>{Number(totals.total || 0).toFixed(2)} €</b>
                      </div>
                    ) : (
                      <div className={styles.cartTotalRow}>
                        <span>Summe (storniert)</span>
                        <b>{Number(voidTotals.total || 0).toFixed(2)} €</b>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {msg ? <div className={styles.msg}>{msg}</div> : null}
          </div>

          {/* Sticky footer: NUR Summe + Actions (Summe klick -> Warenkorb) */}
          <div className={styles.stickyFooter}>
            <button type="button" className={styles.sumBar} onClick={goToCart} title="Zum Warenkorb">
              <span className={styles.sumBarLeft}>
                <b>Summe</b>
                <span className={styles.sumBarMeta}>
                  {activeServiceCount} Services · {activeProductCount} Produkte
                </span>
              </span>
              <span className={styles.sumBarRight}>{totals.total.toFixed(2)} €</span>
            </button>

            <div className={styles.actionsRow}>
              <button className={styles.danger} onClick={voidDraft} type="button" disabled={sending}>
                {isEdit ? "Verwerfen" : "Stornieren"}
              </button>
              <button className={styles.primary} onClick={finalize} disabled={sending} type="button">
                {sending ? "Senden..." : isEdit ? "Änderungen speichern" : "Senden & Check-in starten"}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Tab({ label, active, onClick }) {
  return (
    <button className={`${styles.tab} ${active ? styles.tabOn : ""}`} onClick={onClick} type="button">
      {label}
    </button>
  );
}

function StaffPanel({ requestedAreaIds, staffByArea, preferredStaffByArea, onChange, areaNameById, servicesByAreaForPreview }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Wunsch Mitarbeiter</div>

      {(requestedAreaIds || []).length === 0 ? (
        <div className={styles.empty}>Bitte zuerst Behandlungen auswählen.</div>
      ) : (
        <div className={styles.staffGrid}>
          {requestedAreaIds.map((areaId) => {
            const preview = servicesByAreaForPreview?.[areaId] || [];
            return (
              <div key={areaId} className={styles.staffCard}>
                <div className={styles.staffHead}>
                  <b>Bereich:</b> <span>{areaNameById(areaId)}</span>
                </div>

                {/* NEW: bestellte Services unter dem Bereich */}
                <div className={styles.staffServices}>
                  {preview.length === 0 ? (
                    <div className={styles.staffServicesEmpty}>Keine Services in diesem Bereich.</div>
                  ) : (
                    <div className={styles.staffServicesChips}>
                      {preview.map((x, idx) => (
                        <span key={`${areaId}-${idx}`} className={styles.staffServiceChip}>
                          {x.title}{Number(x.qty || 1) > 1 ? ` x${Number(x.qty || 1)}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <select
                  className={styles.select}
                  value={preferredStaffByArea?.[areaId] || ""}
                  onChange={(e) => onChange(areaId, e.target.value)}
                >
                  <option value="">Freilassen</option>
                  {(staffByArea?.[areaId] || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>

                <div className={styles.small}>Optional: Wunsch-Mitarbeiter pro Bereich.</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NotesPanel({ value, onChange }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Hinweise / Kommentare</div>

      <textarea
        className={styles.textarea}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Kommentar / Hinweis..."
      />

      {/* WICHTIG: keine 'Änderungen'-Box hier */}
    </div>
  );
}

function CartTable({
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
  onQtyIncService,
  onQtyDecService,
  onQtyIncProduct,
  onQtyDecProduct,
  onQtyIncVoidedService,
  onQtyDecVoidedService,
  onQtyIncVoidedProduct,
  onQtyDecVoidedProduct,
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{/* Bereich */}Bereich</th>
            <th>{/* Wunsch MA */}Wunsch MA</th>
            <th>{/* Artikel */}Artikel</th>
            <th className={styles.thRight}>Anzahl</th>
            <th className={styles.thRight}>Preis</th>
            <th className={styles.thRight}></th>
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className={styles.tdEmpty}>
                Keine Positionen.
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const priceValue = Number(r.unitPrice || 0).toFixed(2);

              return (
                <tr key={r.key}>
                  <td className={styles.tdMuted}>{r.kind === "product" ? r.categoryName : (r.areaName || "—")}</td>
                  <td className={styles.tdMuted}>{r.staffName || "—"}</td>

                  <td>
                    <div className={styles.tdTitle}>{r.title}</div>
                    <div className={styles.tdSub}>
                      {r.kind === "service" ? "Behandlung" : "Produkt"}
                    </div>
                  </td>

                  <td className={styles.tdRight}>
                    <div className={styles.qtyCell}>
                      <button
                        type="button"
                        className={styles.qtyBtn}
                        onClick={() => {
                          if (mode === "active") {
                            if (r.kind === "service") onQtyDecService?.(r.serviceId);
                            else onQtyDecProduct?.(r.productId);
                          } else {
                            if (r.kind === "service") onQtyDecVoidedService?.(r.serviceId);
                            else onQtyDecVoidedProduct?.(r.productId);
                          }
                        }}
                        title="Menge reduzieren"
                      >
                        −
                      </button>
                      <div className={styles.qtyVal}>{Number(r.qty || 0)}</div>
                      <button
                        type="button"
                        className={styles.qtyBtn}
                        onClick={() => {
                          if (mode === "active") {
                            if (r.kind === "service") onQtyIncService?.(r.serviceId);
                            else onQtyIncProduct?.(r.productId);
                          } else {
                            if (r.kind === "service") onQtyIncVoidedService?.(r.serviceId);
                            else onQtyIncVoidedProduct?.(r.productId);
                          }
                        }}
                        title="Menge erhöhen"
                      >
                        +
                      </button>
                    </div>
                  </td>

                  {/* Preis inline editierbar */}
                  <td className={styles.tdRight}>
                    <div className={styles.priceCell}>
                      <input
                        className={styles.priceInput}
                        defaultValue={priceValue}
                        inputMode="decimal"
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
                    </div>
                  </td>

                  <td className={styles.tdRight}>
                    {mode === "active" ? (
                      r.kind === "service" ? (
                        <button className={styles.rowAction} type="button" onClick={() => onVoidService?.(r.serviceId)}>
                          Stornieren
                        </button>
                      ) : (
                        <button className={styles.rowAction} type="button" onClick={() => onVoidProduct?.(r.productId)}>
                          Stornieren
                        </button>
                      )
                    ) : r.kind === "service" ? (
                      <button className={styles.rowActionGhost} type="button" onClick={() => onRestoreService?.(r.serviceId)}>
                        Wiederherstellen
                      </button>
                    ) : (
                      <button className={styles.rowActionGhost} type="button" onClick={() => onRestoreProduct?.(r.productId)}>
                        Wiederherstellen
                      </button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      
    </div>
  );
}
