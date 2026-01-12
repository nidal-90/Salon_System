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

  useEffect(() => {
    db.service_catalog.where("active").equals(1).sortBy("sortOrder").then(setServices);
    db.product_catalog.where("active").equals(1).sortBy("sortOrder").then(setProducts);
    db.staff.toArray().then(setStaff);
  }, []);

  const displayName = profile?.displayName || "Kunde";

  const categories = useMemo(() => {
    const set = new Set(services.map((s) => s.category || "Allgemein"));
    return Array.from(set);
  }, [services]);

  const selectedServices = useMemo(() => {
    return services.filter((s) => selectedServiceIds.has(s.id));
  }, [services, selectedServiceIds]);

  const requestedAreaIds = useMemo(() => {
    const set = new Set(selectedServices.map((s) => s.areaId));
    return Array.from(set);
  }, [selectedServices]);

  const staffByArea = useMemo(() => {
    const map = {};
    for (const s of staff) {
      let ids = [];
      try {
        ids = Array.isArray(s.areaIds) ? s.areaIds : JSON.parse(s.areaIds || "[]");
      } catch {
        ids = [];
      }
      ids.forEach((a) => {
        if (!map[a]) map[a] = [];
        map[a].push(s);
      });
    }
    return map;
  }, [staff]);

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
        selectedServices,
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
              <TreatmentPanel
                categories={categories}
                services={services}
                selectedServiceIds={selectedServiceIds}
                onToggleService={toggleService}
              />
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

  const visible = services.filter((s) => (s.category || "Allgemein") === cat);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <div className={styles.panelTitle}>Behandlungen</div>
        <div className={styles.pillsRow}>
          {categories.map((c) => (
            <button
              key={c}
              className={`${styles.pill} ${c === cat ? styles.pillOn : ""}`}
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
      {requestedAreaIds.length === 0 ? (
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
                value={preferredStaffByArea[areaId] || ""}
                onChange={(e) => onChange(areaId, e.target.value)}
              >
                <option value="">Freilassen</option>
                {(staffByArea[areaId] || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <div className={styles.small}>
                Optional: Wunsch-Mitarbeiter pro Bereich.
              </div>
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
          {products.map((p) => (
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
          {cart.length === 0 ? (
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
