import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../db/index.js";
import styles from "./KioskProductsPage.module.css";

function money(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? x.toFixed(2) : "0.00";
}

export default function KioskProductsPage() {
  const nav = useNavigate();
  const step2 = JSON.parse(sessionStorage.getItem("kiosk_payload_step2") || "{}");

  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);

  const [activeCatId, setActiveCatId] = useState("");
  const [q, setQ] = useState("");

  const [cart, setCart] = useState([]); // {id,title,price,qty}

  useEffect(() => {
    (async () => {
      const [cats, prods] = await Promise.all([
        db.product_categories.toArray(),
        db.product_catalog.toArray(),
      ]);

      const activeCats = (cats || [])
        .filter((c) => c.active === 1 || c.active === true)
        .sort(
          (x, y) =>
            Number(x.sortOrder ?? x.displayNo ?? 9999) - Number(y.sortOrder ?? y.displayNo ?? 9999) ||
            String(x.title || "").localeCompare(String(y.title || ""))
        );

      const activeProds = (prods || [])
        .filter((p) => p.active === 1 || p.active === true)
        .map((p) => ({
          ...p,
          title: (p.title || p.name || "").trim(),
          price: Number(p.price || 0),
          categoryId: String(p.categoryId || ""),
          brand: String(p.brand || "").trim(),
        }))
        .filter((p) => p.title && p.categoryId)
        .sort((a, b) => String(a.title).localeCompare(String(b.title)));

      setCategories(activeCats);
      setProducts(activeProds);

      if (activeCats[0]?.id) setActiveCatId(activeCats[0].id);
    })();
  }, []);

  const activeCat = useMemo(
    () => categories.find((c) => c.id === activeCatId) || null,
    [categories, activeCatId]
  );

  const visibleProducts = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = products.filter((p) => p.categoryId === activeCatId);
    if (!s) return list;
    return list.filter((p) => {
      const hay = `${p.title} ${p.brand}`.toLowerCase();
      return hay.includes(s);
    });
  }, [products, activeCatId, q]);

  const total = useMemo(() => {
    return cart.reduce((sum, x) => sum + x.price * x.qty, 0);
  }, [cart]);

  function add(p) {
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

  function dec(id) {
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

  function next() {
    const payload = {
      ...step2,
      products: cart.map((x) => ({ title: x.title, price: x.price, qty: x.qty })),
    };
    sessionStorage.setItem("kiosk_payload_step3", JSON.stringify(payload));
    nav("/kiosk/confirm");
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.top}>
          <div>
            <div className={styles.h1}>Produkte</div>
            <div className={styles.sub}>Optional: Kategorie wählen, suchen und in den Warenkorb legen.</div>
          </div>
          <div className={styles.badge}>Summe: {money(total)} €</div>
        </div>

        {/* Tabs + Search */}
        <div className={styles.tabsBar}>
          <div className={styles.tabsRow} role="tablist" aria-label="Kategorien">
            {categories.map((c) => (
              <button
                key={c.id}
                className={`${styles.tab} ${c.id === activeCatId ? styles.tabOn : ""}`}
                type="button"
                onClick={() => {
                  setActiveCatId(c.id);
                  setQ("");
                }}
              >
                {c.title}
              </button>
            ))}
          </div>

          <div className={styles.searchWrap}>
            <input
              className={styles.search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={activeCat ? `Suche in ${activeCat.title}…` : "Suche…"}
            />
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.grid}>
            {/* List */}
            <div className={styles.list}>
              <div className={styles.sectionHead}>
                <div className={styles.sectionTitle}>
                  Produkte {activeCat ? `· ${activeCat.title}` : ""}
                </div>
                <div className={styles.sectionHint}>Klicken zum Hinzufügen, Minus zum Entfernen.</div>
              </div>

              {(!activeCatId || visibleProducts.length === 0) ? (
                <div className={styles.empty}>
                  {activeCatId ? "Keine Produkte in dieser Kategorie gefunden." : "Bitte zuerst eine Kategorie wählen."}
                </div>
              ) : (
                visibleProducts.map((p) => (
                  <div key={p.id} className={styles.item}>
                    <div className={styles.itemLeft}>
                      <div className={styles.itemTitle}>{p.title}</div>
                      <div className={styles.itemMeta}>
                        {p.brand ? `${p.brand}` : "—"}
                      </div>
                    </div>

                    <div className={styles.itemRight}>
                      <div className={styles.price}>{money(p.price)} €</div>
                      <button className={styles.addBtn} onClick={() => add(p)} type="button">
                        + Hinzufügen
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Cart */}
            <div className={styles.cart}>
              <div className={styles.cartHead}>
                <div className={styles.cartTitle}>Warenkorb</div>
                <div className={styles.total}>{money(total)} €</div>
              </div>

              {cart.length === 0 ? (
                <div className={styles.empty}>Noch keine Produkte gewählt.</div>
              ) : (
                cart.map((x) => (
                  <div key={x.id} className={styles.cartRow}>
                    <div className={styles.cartName}>{x.title}</div>

                    <div className={styles.cartQty}>
                      <button className={styles.qtyBtn} onClick={() => dec(x.id)} type="button">-</button>
                      <span>x{x.qty}</span>
                    </div>

                    <div className={styles.cartPrice}>{money(x.price * x.qty)} €</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={styles.footer}>
            <button className={styles.secondary} onClick={() => nav("/kiosk/group")} type="button">
              Zurück
            </button>
            <button className={styles.primary} onClick={next} type="button">
              Weiter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
