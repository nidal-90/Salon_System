import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../db/index.js";
import styles from "./KioskProductsPage.module.css";

export default function KioskProductsPage() {
  const nav = useNavigate();
  const step2 = JSON.parse(sessionStorage.getItem("kiosk_payload_step2") || "{}");

  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]); // {id,title,price,qty}

  useEffect(() => {
    db.product_catalog.where("active").equals(1).sortBy("sortOrder").then(setProducts);
  }, []);

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

  function remove(id) {
    setCart((prev) => prev.filter((x) => x.id !== id));
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
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h2 className={styles.title}>Produkte (optional)</h2>
          <p className={styles.sub}>Sie können auch Produkte auswählen.</p>
        </div>

        <div className={styles.grid}>
          <div className={styles.list}>
            {products.map((p) => (
              <div key={p.id} className={styles.item}>
                <div className={styles.itemLeft}>
                  <div className={styles.itemTitle}>{p.title}</div>
                  <div className={styles.itemMeta}>{p.brand} · {p.category}</div>
                </div>
                <div className={styles.itemRight}>
                  <div className={styles.price}>{Number(p.price).toFixed(2)} €</div>
                  <button className={styles.add} onClick={() => add(p)} type="button">+ Hinzufügen</button>
                </div>
              </div>
            ))}
          </div>

          <div className={styles.cart}>
            <div className={styles.cartHead}>
              <div className={styles.bold}>Warenkorb</div>
              <div className={styles.total}>{total.toFixed(2)} €</div>
            </div>

            {cart.length === 0 ? (
              <div className={styles.empty}>Noch keine Produkte gewählt.</div>
            ) : (
              cart.map((x) => (
                <div key={x.id} className={styles.cartRow}>
                  <div className={styles.cartTitle}>{x.title}</div>
                  <div className={styles.cartQty}>x{x.qty}</div>
                  <div className={styles.cartPrice}>{(x.price * x.qty).toFixed(2)} €</div>
                  <button className={styles.remove} onClick={() => remove(x.id)} type="button">×</button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.secondary} onClick={() => nav("/kiosk/group")} type="button">Zurück</button>
          <button className={styles.primary} onClick={next} type="button">Weiter</button>
        </div>
      </div>
    </div>
  );
}
