// src/features/kiosk/pages/KioskOrderEmbed.jsx
import { useEffect, useMemo, useState } from "react";
import { db } from "../../../db/index.js";
import { createVisitFromOrder } from "../api/orderApi.js";
import styles from "./KioskOrderEmbed.module.css";

/**
 * profile minimal:
 * {
 *   displayName: string,
 *   customerId?: string|null,
 *   mode?: "existing"|"guest"|"group"|"profile"|"wedding",
 *   customer?: { phone?: string }
 *   group?: { members: [{displayName, phone?, customerId?}], paymentMode: "single"|"split" }
 *   note?: string
 * }
 */
export default function KioskOrderEmbed({ profile, onDone }) {
  const [tab, setTab] = useState("treatment"); // treatment|staff|notes|products
  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);
  const [staff, setStaff] = useState([]);

  const [selectedServiceIds, setSelectedServiceIds] = useState(new Set());
  const [preferredStaffByArea, setPreferredStaffByArea] = useState({});
  const [comment, setComment] = useState(profile?.note || "");
  const [cart, setCart] = useState([]);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [areas, setAreas] = useState([]);
  const [productCategories, setProductCategories] = useState([]);

  // keep comment in sync when profile changes
  useEffect(() => {
    setComment(profile?.note || "");
  }, [profile]);

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

  // Services
  db.service_catalog.toArray().then((rows) => {
    const list = (rows || [])
      .filter((s) => s.active === 1 || s.active === true)
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    setServices(list);
  });

  // Products
  db.product_catalog.toArray().then((rows) => {
    const list = (rows || [])
      .filter((p) => p.active === 1 || p.active === true)
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    setProducts(list);
  });

  db.staff.toArray().then((rows) => setStaff(rows || []));
}, []);

const [serviceAreaId, setServiceAreaId] = useState("");
const [serviceQuery, setServiceQuery] = useState("");

const [productCategoryId, setProductCategoryId] = useState("");
const [productQuery, setProductQuery] = useState("");
useEffect(() => {
  if (!serviceAreaId) {
    // bevorzugt: erster Bereich, der auch Services hat
    const first = areas.find((a) => services.some((s) => s.areaId === a.id));
    if (first?.id) setServiceAreaId(first.id);
    else if (areas[0]?.id) setServiceAreaId(areas[0].id);
  }
}, [areas, services, serviceAreaId]);

useEffect(() => {
  if (!productCategoryId) {
    const first = productCategories.find((c) => products.some((p) => p.categoryId === c.id));
    if (first?.id) setProductCategoryId(first.id);
    else if (productCategories[0]?.id) setProductCategoryId(productCategories[0].id);
  }
}, [productCategories, products, productCategoryId]);

useEffect(() => {
  setServiceQuery("");
}, [serviceAreaId]);

useEffect(() => {
  setProductQuery("");
}, [productCategoryId]);

const visibleServices = useMemo(() => {
  const q = serviceQuery.trim().toLowerCase();
  const list = services.filter((s) => {
    if (serviceAreaId && String(s.areaId || "") !== String(serviceAreaId)) return false;
    if (!q) return true;
    const hay = `${s.title || s.name || ""}`.toLowerCase();
    return hay.includes(q);
  });
  return list;
}, [services, serviceAreaId, serviceQuery]);

const visibleProducts = useMemo(() => {
  const q = productQuery.trim().toLowerCase();
  const list = products.filter((p) => {
    if (productCategoryId && String(p.categoryId || "") !== String(productCategoryId)) return false;
    if (!q) return true;
    const hay = `${p.title || p.name || ""} ${p.brand || ""}`.toLowerCase();
    return hay.includes(q);
  });
  return list;
}, [products, productCategoryId, productQuery]);


  // ---- Derived state (fixes the undefined variables) ----
  const displayName = useMemo(() => {
    const n = String(profile?.displayName || "").trim();
    return n || "—";
  }, [profile]);

  const categories = useMemo(() => {
    const set = new Set(
      services.map((s) => String(s.category || "Allgemein").trim() || "Allgemein")
    );
    return Array.from(set);
  }, [services]);

  const selectedServices = useMemo(() => {
    // list of selected service objects
    const ids = selectedServiceIds;
    return services.filter((s) => ids.has(s.id));
  }, [services, selectedServiceIds]);

  const requestedAreaIds = useMemo(() => {
    // areas requested by selected services (if areaId exists)
    const set = new Set(
      selectedServices.map((s) => s.areaId).filter(Boolean)
    );
    return Array.from(set);
  }, [selectedServices]);

  const staffByArea = useMemo(() => {
    // Robust fallback:
    // - if you later store staff.areaId or staff.areaIds, you can refine here
    const activeStaff = staff.filter((x) => Number(x.active) === 1 || x.active === true);

    const map = {};
    for (const areaId of requestedAreaIds) {
      map[areaId] = activeStaff;
    }
    return map;
  }, [staff, requestedAreaIds]);

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
      const idx = prev.findIndex((x) => x.id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { id: p.id, title: p.title, price: Number(p.price), qty: 1 }];
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

  async function send() {
    setMsg("");
    if (selectedServiceIds.size === 0) {
      setMsg("Bitte mindestens eine Behandlung auswählen.");
      setTab("treatment");
      return;
    }

    setSending(true);
    try {
      await createVisitFromOrder({
        profile,
        comment,
        selectedServices, // FIX: war vorher undefiniert
        preferredStaffByArea,
        cart,
      });

      onDone?.();
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setSending(false);
    }
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
        .filter((a) => services.some((s) => s.areaId === a.id))
        .slice(0, 12) /* optional: falls du viele Bereiche hast */
        .map((a) => (
          <button
            key={a.id}
            type="button"
            className={`${styles.chip} ${serviceAreaId === a.id ? styles.chipOn : ""}`}
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
            return (
              <div key={s.id} className={`${styles.item} ${on ? styles.itemOn : ""}`}>
                <div className={styles.itemLeft}>
                  <div className={styles.itemTitle}>{s.title || s.name}</div>
                  <div className={styles.itemMeta}>
                    Preis: {Number(s.price || 0).toFixed(2)} €
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
        .filter((c) => products.some((p) => p.categoryId === c.id))
        .slice(0, 12)
        .map((c) => (
          <button
            key={c.id}
            type="button"
            className={`${styles.chip} ${productCategoryId === c.id ? styles.chipOn : ""}`}
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
                <div className={styles.itemTitle}>{p.title || p.name}</div>
                <div className={styles.itemMeta}>
                  {(p.brand ? `${p.brand} · ` : "")}{Number(p.price || 0).toFixed(2)} €
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

    {/* Optional: kleiner Warenkorb-Summary */}
    {cart?.length > 0 && (
      <div className={styles.cartMini}>
        <div className={styles.cartMiniTitle}>Warenkorb</div>
        <div className={styles.cartMiniLine}>
          {cart.reduce((n, x) => n + Number(x.qty || 0), 0)} Artikel
          <span className={styles.cartMiniSep}>·</span>
          {cart.reduce((s, x) => s + Number(x.price || 0) * Number(x.qty || 0), 0).toFixed(2)} €
        </div>
      </div>
    )}
  </div>
)}

            {tab === "staff" && (
              <StaffPanel
                requestedAreaIds={requestedAreaIds}
                staffByArea={staffByArea}
                preferredStaffByArea={preferredStaffByArea}
                onChange={(areaId, staffId) =>
                  setPreferredStaffByArea((p) => ({ ...p, [areaId]: staffId }))
                }
              />
            )}

            {tab === "notes" && <NotesPanel value={comment} onChange={setComment} />}

            {tab === "products" && (
              <ProductsPanel products={products} cart={cart} onAdd={addProduct} onDec={decProduct} />
            )}

            {msg && <div className={styles.msg}>{msg}</div>}
          </div>

          <div className={styles.stickyFooter}>
            <button className={styles.primary} onClick={send} disabled={sending} type="button">
              {sending ? "Senden..." : "Senden & Check-in starten"}
            </button>
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

function TreatmentPanel({ categories, services, selectedServiceIds, onToggleService }) {
  const [cat, setCat] = useState(categories?.[0] || "");

  useEffect(() => {
    if (!cat && categories?.[0]) setCat(categories[0]);
  }, [categories, cat]);

  const safeCat = cat || categories?.[0] || "Allgemein";
  const visible = services.filter((s) => (s.category || "Allgemein") === safeCat);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <div className={styles.panelTitle}>Behandlungen</div>
        <div className={styles.pillsRow}>
          {(categories || []).map((c) => (
            <button
              key={c}
              className={`${styles.pill} ${c === safeCat ? styles.pillOn : ""}`}
              onClick={() => setCat(c)}
              type="button"
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.grid}>
        {visible.map((s) => {
          const on = selectedServiceIds.has(s.id);
          return (
            <div key={s.id} className={`${styles.item} ${on ? styles.itemOn : ""}`}>
              <div>
                <div className={styles.itemTitle}>{s.title}</div>
                <div className={styles.itemMeta}>Preis: {Number(s.price).toFixed(2)} €</div>
              </div>
              <button className={styles.itemBtn} onClick={() => onToggleService(s.id)} type="button">
                {on ? "Entfernen" : "Wählen"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
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

function ProductsPanel({ products, cart, onAdd, onDec }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Produkte</div>
      <div className={styles.productsGrid}>
        <div className={styles.list}>
          {(products || []).map((p) => (
            <div key={p.id} className={styles.item}>
              <div>
                <div className={styles.itemTitle}>{p.title}</div>
                <div className={styles.itemMeta}>
                  {p.brand} · {Number(p.price).toFixed(2)} €
                </div>
              </div>
              <button className={styles.itemBtn} onClick={() => onAdd(p)} type="button">
                + Add
              </button>
            </div>
          ))}
        </div>

        <div className={styles.cart}>
          <div className={styles.cartTitle}>Warenkorb</div>
          {(!cart || cart.length === 0) ? (
            <div className={styles.empty}>Noch keine Produkte.</div>
          ) : (
            cart.map((x) => (
              <div key={x.id} className={styles.cartRow}>
                <div className={styles.cartName}>{x.title}</div>
                <div className={styles.cartQty}>
                  <button className={styles.qtyBtn} onClick={() => onDec(x.id)} type="button">
                    -
                  </button>
                  <span>x{x.qty}</span>
                </div>
                <div className={styles.cartPrice}>{(x.price * x.qty).toFixed(2)} €</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
