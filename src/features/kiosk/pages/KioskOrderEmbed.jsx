//feature-kiosk-page-order-embed

import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../../db/index.js";
import { toDateKeyISO } from "../../../services/time/dateKeys.js";
import { createVisitFromOrder } from "../api/orderApi.js";
import styles from "./KioskOrderEmbed.module.css";

/**
 * Erweiterte Props (abwärtskompatibel):
 * - profile: Pflicht
 * - onDone: optional, wird nach Finalize aufgerufen
 * - onCancel: optional, schließt Embed ohne Finalize
 * - draftId: optional, wenn du Bearbeiten machst
 */
export default function KioskOrderEmbed({ profile, onDone, onCancel, draftId }) {
  const [tab, setTab] = useState("treatment"); // treatment|staff|notes|products

  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [areas, setAreas] = useState([]);
  const [productCategories, setProductCategories] = useState([]);

  // Auswahl
  const [selectedServiceIds, setSelectedServiceIds] = useState(new Set());
  const [preferredStaffByArea, setPreferredStaffByArea] = useState({});
  const [comment, setComment] = useState(profile?.note || "");
  const [cart, setCart] = useState([]); // [{id,title,price,qty}]

  // Filter
  const [serviceAreaId, setServiceAreaId] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const [productCategoryId, setProductCategoryId] = useState("");
  const [productQuery, setProductQuery] = useState("");

  // Draft meta
  const [activeDraftId, setActiveDraftId] = useState(draftId || "");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");

  // Debounce save
  const saveTimer = useRef(null);
  const lastSavedHash = useRef("");

  // keep comment in sync when profile changes
  useEffect(() => {
    setComment(profile?.note || "");
  }, [profile]);

  // Load catalogs
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

  // Default chips
  useEffect(() => {
    if (!serviceAreaId) {
      const first = areas.find((a) => services.some((s) => String(s.areaId) === String(a.id)));
      if (first?.id) setServiceAreaId(first.id);
      else if (areas[0]?.id) setServiceAreaId(areas[0].id);
    }
  }, [areas, services, serviceAreaId]);

  useEffect(() => {
    if (!productCategoryId) {
      const first = productCategories.find((c) =>
        products.some((p) => String(p.categoryId) === String(c.id))
      );
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

  // Visible lists
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

  // Selected services as objects (with editable price support)
  const selectedServices = useMemo(() => {
    const ids = selectedServiceIds;
    return services
      .filter((s) => ids.has(s.id))
      .map((s) => ({
        serviceId: s.id,
        areaId: s.areaId || "",
        title: s.name || s.title || "Service",
        price: Number(s.price || 0),
      }));
  }, [services, selectedServiceIds]);

  const requestedAreaIds = useMemo(() => {
    const set = new Set(selectedServices.map((s) => s.areaId).filter(Boolean));
    return Array.from(set);
  }, [selectedServices]);

  // staff map per area (simple, robust)
  const staffByArea = useMemo(() => {
    const activeStaff = staff.filter((x) => Number(x.active) === 1 || x.active === true);
    const map = {};
    for (const areaId of requestedAreaIds) map[areaId] = activeStaff;
    return map;
  }, [staff, requestedAreaIds]);

  // ---- Draft helpers ----
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

  function buildDraftPayload() {
    const dk = toDateKeyISO(new Date());
    const meta = draftMetaFromProfile(profile);

    return {
      dateKey: dk,
      status: "draft",
      ...meta,
      comment: String(comment || ""),
      requestedStaffByArea: preferredStaffByArea || {},
      servicesJson: JSON.stringify(
        selectedServices.map((x) => ({
          ...x,
          // keep in draft snapshot (so later history survives catalog edits)
          price: Number(x.price || 0),
        }))
      ),
      productsJson: JSON.stringify(
        (cart || []).map((x) => ({
          productId: x.id,
          title: x.title,
          price: Number(x.price || 0),
          qty: Number(x.qty || 0),
        }))
      ),
    };
  }

  async function logOrderEvent(type, payload) {
    try {
      const dk = toDateKeyISO(new Date());
      const row = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        dateKey: dk,
        draftId: activeDraftId || "",
        type,
        actorStaffId: "",
        actorName: "",
        payloadJson: JSON.stringify(payload || {}),
      };
      await db.order_events.add(row);
    } catch {
      // never block UX on audit failure
    }
  }

  async function ensureDraft() {
    // If no draft table exists (older DB), fail safely without breaking kiosk.
    const hasDraftTable = (db?.tables || []).some((t) => t?.name === "order_drafts");
    if (!hasDraftTable) return;

    if (activeDraftId) {
      // load existing draft into UI
      const d = await db.order_drafts.get(activeDraftId).catch(() => null);
      if (d) {
        // hydrate UI state
        const s = safeJson(d.servicesJson, []);
        const p = safeJson(d.productsJson, []);

        setSelectedServiceIds(new Set((s || []).map((x) => x.serviceId).filter(Boolean)));
        setPreferredStaffByArea(d.requestedStaffByArea || {});
        setComment(String(d.comment || profile?.note || ""));

        setCart(
          (p || []).map((x) => ({
            id: x.productId || x.id,
            title: x.title,
            price: Number(x.price || 0),
            qty: Number(x.qty || 0),
          }))
        );

        // keep filters stable
        lastSavedHash.current = ""; // force first save after hydrate
      }
      return;
    }

    // create new draft
    const now = new Date().toISOString();
    const payload = buildDraftPayload();
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
      const payload = buildDraftPayload();

      // tiny hash to avoid writing on every keystroke
      const hash = JSON.stringify(payload);
      if (hash === lastSavedHash.current) return;
      lastSavedHash.current = hash;

      await db.order_drafts.update(activeDraftId, { updatedAt: now, ...payload }).catch(() => {});
      await logOrderEvent("draft_saved", { changed: true });
    }, 350);
  }

  // Init draft on mount / when profile changes
  useEffect(() => {
    ensureDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, draftId]);

  // Auto-save on state change
  useEffect(() => {
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServiceIds, preferredStaffByArea, comment, cart]);

  // ---- Actions ----
  function toggleService(id) {
    setSelectedServiceIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function addProduct(p) {
    setCart((prev) => {
      const title = p.name || p.title || "Produkt";
      const price = Number(p.price || 0);
      const idx = prev.findIndex((x) => x.id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { id: p.id, title, price, qty: 1 }];
    });
  }

  function decProduct(id) {
    setCart((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const item = next[idx];
      if (item.qty <= 1) return next.filter((x) => x.id !== id);
      next[idx] = { ...item, qty: item.qty - 1 };
      return next;
    });
  }

  function editServicePrice(serviceId) {
    const s = selectedServices.find((x) => x.serviceId === serviceId);
    if (!s) return;
    const x = prompt(`Preis ändern für "${s.title}"`, String(Number(s.price || 0).toFixed(2)));
    if (x == null) return;
    const n = Number(String(x).replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return;

    // price override: store override into "services" snapshot by patching services list in memory
    // We keep override in draft via servicesJson; easiest: maintain a local override map in state-less manner:
    // Replace by adding a pseudo service row? No.
    // Instead: patch the catalog service in memory is wrong.
    // So: store overrides inside preferredStaffByArea meta is wrong.
    // Solution: keep a local override map in state:
    setServicePriceOverrides((p) => ({ ...p, [serviceId]: Number(n.toFixed(2)) }));
  }

  function editProductPrice(productId) {
    const item = cart.find((x) => x.id === productId);
    if (!item) return;
    const x = prompt(`Preis ändern für "${item.title}"`, String(Number(item.price || 0).toFixed(2)));
    if (x == null) return;
    const n = Number(String(x).replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return;
    setCart((prev) => prev.map((z) => (z.id === productId ? { ...z, price: Number(n.toFixed(2)) } : z)));
  }

  // Price overrides for services (kept separate, written into draft snapshot)
  const [servicePriceOverrides, setServicePriceOverrides] = useState({});
  const effectiveSelectedServices = useMemo(() => {
    return selectedServices.map((s) => {
      const ov = servicePriceOverrides?.[s.serviceId];
      return { ...s, price: Number.isFinite(ov) ? Number(ov) : Number(s.price || 0) };
    });
  }, [selectedServices, servicePriceOverrides]);

  // Rebuild draft payload to include overrides
  function buildDraftPayloadWithOverrides() {
    const base = buildDraftPayload();
    return {
      ...base,
      servicesJson: JSON.stringify(
        effectiveSelectedServices.map((x) => ({
          ...x,
          price: Number(x.price || 0),
        }))
      ),
    };
  }

  // Use overrides in save
  function scheduleSaveWithOverrides() {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const hasDraftTable = (db?.tables || []).some((t) => t?.name === "order_drafts");
      if (!hasDraftTable) return;
      if (!activeDraftId) return;

      const now = new Date().toISOString();
      const payload = buildDraftPayloadWithOverrides();
      const hash = JSON.stringify(payload);
      if (hash === lastSavedHash.current) return;
      lastSavedHash.current = hash;

      await db.order_drafts.update(activeDraftId, { updatedAt: now, ...payload }).catch(() => {});
      await logOrderEvent("draft_saved", { changed: true });
    }, 350);
  }

  useEffect(() => {
    scheduleSaveWithOverrides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicePriceOverrides]);

  // Totals
  const totals = useMemo(() => {
    const serviceSum = (effectiveSelectedServices || []).reduce((s, x) => s + Number(x.price || 0), 0);
    const productSum = (cart || []).reduce((s, x) => s + Number(x.price || 0) * Number(x.qty || 0), 0);
    const total = Number(serviceSum + productSum);
    return {
      serviceSum: Number(serviceSum.toFixed(2)),
      productSum: Number(productSum.toFixed(2)),
      total: Number(total.toFixed(2)),
    };
  }, [effectiveSelectedServices, cart]);

  async function writeCustomerHistory({ visitId }) {
    try {
      const customerId = profile?.customerId ? String(profile.customerId) : "";
      if (!customerId) return;

      const now = new Date().toISOString();
      const payload = {
        displayName,
        visitId: visitId || "",
        services: effectiveSelectedServices,
        products: (cart || []).map((x) => ({ title: x.title, price: x.price, qty: x.qty })),
        requestedStaffByArea: preferredStaffByArea || {},
        note: String(comment || ""),
      };

      await db.customer_history.add({
        id: crypto.randomUUID(),
        customerId,
        createdAt: now,
        visitId: visitId || "",
        areaId: "",
        staffId: "",
        staffName: "",
        type: "order_finalized",
        payload,
      });
    } catch {
      // do not block check-in
    }
  }

  async function finalize() {
    setMsg("");

    if (effectiveSelectedServices.length === 0) {
      setMsg("Bitte mindestens eine Behandlung auswählen.");
      setTab("treatment");
      return;
    }

    setSending(true);
    try {
      // Update draft first (ensure overrides persisted)
      const hasDraftTable = (db?.tables || []).some((t) => t?.name === "order_drafts");
      if (hasDraftTable && activeDraftId) {
        const now = new Date().toISOString();
        const payload = buildDraftPayloadWithOverrides();
        await db.order_drafts.update(activeDraftId, { updatedAt: now, ...payload }).catch(() => {});
      }

      const res = await createVisitFromOrder({
        profile,
        comment,
        selectedServices: effectiveSelectedServices, // IMPORTANT: with overrides
        preferredStaffByArea,
        cart,
      });

      const visitId =
        (typeof res === "string" && res) ||
        (res && (res.visitId || res.id)) ||
        "";

      // Mark draft finalized + audit
      if ((db?.tables || []).some((t) => t?.name === "order_drafts") && activeDraftId) {
        const now = new Date().toISOString();
        await db.order_drafts.update(activeDraftId, {
          status: "finalized",
          finalizedAt: now,
          updatedAt: now,
          visitId: visitId || "",
          // also store latest snapshot with overrides
          ...buildDraftPayloadWithOverrides(),
        });
        await logOrderEvent("finalized", { visitId });
      }

      await writeCustomerHistory({ visitId });

      onDone?.({ draftId: activeDraftId, visitId });
    } catch (e) {
      setMsg(String(e?.message || e));
      await logOrderEvent("finalize_failed", { error: String(e?.message || e) });
    } finally {
      setSending(false);
    }
  }

  async function voidDraft() {
    const ok = confirm("Order stornieren? (Wird in Historie protokolliert)");
    if (!ok) return;

    const hasDraftTable = (db?.tables || []).some((t) => t?.name === "order_drafts");
    if (!hasDraftTable || !activeDraftId) {
      onCancel?.();
      return;
    }

    const now = new Date().toISOString();
    const snap = buildDraftPayloadWithOverrides();
    await db.order_drafts.update(activeDraftId, {
      status: "void",
      voidedAt: now,
      updatedAt: now,
      ...snap,
    });
    await logOrderEvent("void", { snapshot: snap });
    onCancel?.();
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        
        <div>
          <div className={styles.kicker}>Check-in</div>
          <div className={styles.name}>{displayName}</div>  
        </div>
    
      </div>

      <div className={styles.body}>
        <aside className={styles.tabs}>
          <Tab label="Behandlung" active={tab === "treatment"} onClick={() => setTab("treatment")} />
          <Tab label="Wunsch Mitarbeiter" active={tab === "staff"} onClick={() => setTab("staff")} />
          <Tab label="Produkte" active={tab === "products"} onClick={() => setTab("products")} />
          <Tab label="Kommentare" active={tab === "notes"} onClick={() => setTab("notes")} />
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
                    <div className={styles.empty}>
                      Keine Services gefunden{serviceQuery ? " (Filter aktiv)" : ""}.
                    </div>
                  ) : (
                    <div className={styles.items}>
                      {visibleServices.map((s) => {
                        const on = selectedServiceIds.has(s.id);
                        const title = s.name || s.title || "Service";
                        const basePrice = Number(s.price || 0);
                        const price =
                          servicePriceOverrides?.[s.id] != null
                            ? Number(servicePriceOverrides[s.id] || 0)
                            : basePrice;

                        return (
                          <div key={s.id} className={`${styles.item} ${on ? styles.itemOn : ""}`}>
                            <div className={styles.itemLeft}>
                              <div className={styles.itemTitle}>{title}</div>
                              <div className={styles.itemMeta}>
                              
                              </div>
                            </div>

                            <button
                              className={`${styles.itemBtn} ${on ? styles.itemBtnOn : ""}`}
                              onClick={() => toggleService(s.id)}
                              type="button"
                            >
                              {on ? "Entfernen" : "Wählen"}
                            </button>
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
                    <div className={styles.empty}>
                      Keine Produkte gefunden{productQuery ? " (Filter aktiv)" : ""}.
                    </div>
                  ) : (
                    <div className={styles.items}>
                      {visibleProducts.map((p) => (
                        <div key={p.id} className={styles.item}>
                          <div className={styles.itemLeft}>
                            <div className={styles.itemTitle}>{p.name || p.title || "Produkt"}</div>
                            <div className={styles.itemMeta}>
                              {Number(p.price || 0).toFixed(2)} €
                            </div>
                          </div>

                          <div className={styles.productBtns}>
                            <button className={styles.itemBtn} onClick={() => addProduct(p)} type="button">
                              + Hinzufügen
                            </button>
                            <button className={styles.itemBtnGhost} onClick={() => decProduct(p.id)} type="button">
                              −
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {cart?.length > 0 && (
                  <div className={styles.cartMini}>
                    <div className={styles.cartMiniTitle}>Warenkorb</div>
                    <div className={styles.cartMiniLine}>
                      {cart.reduce((n, x) => n + Number(x.qty || 0), 0)} Artikel
                      <span className={styles.cartMiniSep}>·</span>
                      {cart
                        .reduce((s, x) => s + Number(x.price || 0) * Number(x.qty || 0), 0)
                        .toFixed(2)}{" "}
                      €
                    </div>
                    
                  </div>
                )}
              </div>
            )}

            {/* STAFF */}
            {tab === "staff" && (
              <StaffPanel
                requestedAreaIds={requestedAreaIds}
                staffByArea={staffByArea}
                preferredStaffByArea={preferredStaffByArea}
                onChange={(areaId, staffId) => setPreferredStaffByArea((p) => ({ ...p, [areaId]: staffId }))}
              />
            )}

            {/* NOTES */}
            {tab === "notes" && <NotesPanel value={comment} onChange={setComment} />}

            {msg ? <div className={styles.msg}>{msg}</div> : null}
          </div>

          {/* Sticky footer: Summary + Actions */}
          <div className={styles.stickyFooter}>
            <div className={styles.orderSummary}>
              <div className={styles.summaryTitle}></div>

              <div className={styles.summaryBlock}>
                {(effectiveSelectedServices || []).length === 0 ? (
                  <div className={styles.summaryEmpty}></div>
                ) : (
                  (effectiveSelectedServices || []).map((s) => (
                    <div key={s.serviceId} className={styles.summaryRow}>
                      <div className={styles.summaryLeft}>
                        <div className={styles.summaryName}>{s.title}</div>
                       
                      </div>
                      <div className={styles.summaryRight}>{Number(s.price || 0).toFixed(2)} €</div>
                    </div>
                  ))
                )}
              </div>

              <div className={styles.summaryBlock}>
                {(cart || []).length === 0 ? (
                  <div className={styles.summaryEmpty}></div>
                ) : (
                  (cart || []).map((x) => (
                    <div key={x.id} className={styles.summaryRow}>
                      <div className={styles.summaryLeft}>
                        <div className={styles.summaryName}>
                          {x.title} <span className={styles.summaryQty}>x{x.qty}</span>
                        </div>
                       
                      </div>
                      <div className={styles.summaryRight}>
                        {(Number(x.price || 0) * Number(x.qty || 0)).toFixed(2)} €
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className={styles.summaryTotal}>
                <div>Summe</div>
                <div>{totals.total.toFixed(2)} €</div>
              </div>
            </div>

            <div className={styles.actionsRow}>
             
              <button className={styles.danger} onClick={voidDraft} type="button" disabled={!activeDraftId || sending}>
                Stornieren
              </button>
              <button className={styles.primary} onClick={finalize} disabled={sending} type="button">
                {sending ? "Senden..." : "Senden & Check-in starten"}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function safeJson(s, fallback) {
  try {
    const x = JSON.parse(String(s || ""));
    return x == null ? fallback : x;
  } catch {
    return fallback;
  }
}

function Tab({ label, active, onClick }) {
  return (
    <button className={`${styles.tab} ${active ? styles.tabOn : ""}`} onClick={onClick} type="button">
      {label}
    </button>
  );
}

function StaffPanel({ requestedAreaIds, staffByArea, preferredStaffByArea, onChange }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Wunsch Mitarbeiter</div>
      {(requestedAreaIds || []).length === 0 ? (
        <div className={styles.empty}>Bitte zuerst Behandlungen auswählen.</div>
      ) : (
        <div className={styles.staffGrid}>
          {requestedAreaIds.map((areaId) => (
            <div key={areaId} className={styles.staffCard}>
              <div className={styles.staffHead}>
                <b>Bereich:</b> <span>{areaId}</span>
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
          ))}
        </div>
      )}
    </div>
  );
}

function NotesPanel({ value, onChange }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Kommentare / Notizen</div>
      <textarea
        className={styles.textarea}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Kommentar / Hinweis..."
      />
    </div>
  );
}
