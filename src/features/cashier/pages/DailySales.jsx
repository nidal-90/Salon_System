import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import styles from "./DailySales.module.css";

import {
  checkoutFreePos,
  loadFreePosMasterData,
  money,
  clampInt,
} from "../api/freePosApi.js";

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

function PillTabs({ value, onChange, tabs }) {
  return (
    <div className={styles.pills} role="tablist" aria-label="Kategorien">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          className={`${styles.pill} ${value === t.value ? styles.pillActive : ""}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function DailySales() {
  const nav = useNavigate();
  const { cashierStaffId, cashierName } = useCashierIdentityFallback();

  const [loadError, setLoadError] = useState("");
  const [staff, setStaff] = useState([]);
  const [items, setItems] = useState([]);

  const [activeCategory, setActiveCategory] = useState("");
  const [search, setSearch] = useState("");

  const [cart, setCart] = useState([]);

  // Free item dialog
  const [freeOpen, setFreeOpen] = useState(false);
  const [freeKind, setFreeKind] = useState("service"); // service|product
  const [freeTitle, setFreeTitle] = useState("");
  const [freePrice, setFreePrice] = useState("");
  const [freeStaffId, setFreeStaffId] = useState("");

  async function refreshMaster() {
    try {
      setLoadError("");
      const { staff: st, items: it } = await loadFreePosMasterData();
      setStaff(st);
      setItems(it);

      const cats = Array.from(new Set(it.map((x) => x.category)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      setActiveCategory((prev) => (prev && cats.includes(prev) ? prev : cats[0] || ""));
      setFreeStaffId((prev) => prev || st[0]?.id || "");
    } catch (e) {
      console.error(e);
      setLoadError(String(e?.message || e));
    }
  }

  useEffect(() => {
    refreshMaster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(() => {
    return Array.from(new Set(items.map((x) => x.category)))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredItems = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items
      .filter((x) => (activeCategory ? x.category === activeCategory : true))
      .filter((x) => (s ? String(x.title || "").toLowerCase().includes(s) : true))
      .sort((a, b) => {
        const so = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
        if (so !== 0) return so;
        return String(a.title).localeCompare(String(b.title));
      });
  }, [items, activeCategory, search]);

  const total = useMemo(
    () => cart.reduce((sum, l) => sum + Number(l.unitPrice) * Number(l.qty), 0),
    [cart]
  );

  const missingStaffForService = useMemo(
    () => cart.some((l) => l.kind === "service" && !l.staffId),
    [cart]
  );

  function addToCart(item) {
    setCart((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        kind: item.kind, // service|product
        title: item.title,
        unitPrice: Number(item.price || 0),
        qty: 1,
        staffId: item.kind === "service" ? staff[0]?.id || "" : "",
        staffName: item.kind === "service" ? staff[0]?.name || "" : "",
      },
    ]);
  }

  function updateLine(id, patch) {
    setCart((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLine(id) {
    setCart((prev) => prev.filter((l) => l.id !== id));
  }

  function openFree() {
    setFreeOpen(true);
    setFreeKind("service");
    setFreeTitle("");
    setFreePrice("");
    setFreeStaffId(staff[0]?.id || "");
  }

  function addFreeLine() {
    const title = freeTitle.trim();
    const price = Number(freePrice);
    if (!title) return;
    if (!Number.isFinite(price) || price <= 0) return;
    if (freeKind === "service" && !freeStaffId) return;

    const staffName =
      freeKind === "service" ? staff.find((s) => s.id === freeStaffId)?.name || "" : "";

    setCart((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        kind: freeKind,
        title,
        unitPrice: Number(price.toFixed(2)),
        qty: 1,
        staffId: freeKind === "service" ? freeStaffId : "",
        staffName,
      },
    ]);

    setFreeOpen(false);
  }

  async function checkout(method) {
    if (!cart.length) return;
    if (missingStaffForService) return;

    const res = await checkoutFreePos({
      cart,
      method,
      cashierStaffId,
      cashierName,
    });

    if (!res.ok) {
      alert(
        res.reason === "MISSING_STAFF_FOR_SERVICE"
          ? "Mindestens ein Service hat keinen Mitarbeiter."
          : "Checkout fehlgeschlagen."
      );
      return;
    }

    setCart([]);
    setSearch("");
  }

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <div>
          <div className={styles.h1}>Salon POS</div>
          <div className={styles.sub}>Freier Verkauf (ohne Kundensystem)</div>
        </div>

        <div className={styles.topActions}>
          <button className={styles.btnGhost} type="button" onClick={refreshMaster}>
            Refresh Daten
          </button>

          <button className={styles.btnGhost} type="button" onClick={() => nav("/cashier")}>
            Zurück
          </button>

          <button className={styles.btnGhost} type="button" onClick={() => nav("/cashier/freepos/daily")}>
            Tagesübersicht
          </button>

          <button className={styles.btnPrimary} type="button" onClick={openFree}>
            Freier Preis
          </button>
        </div>
      </div>

      {loadError ? (
        <div className={styles.alertErr}>
          DB-Fehler: {loadError}
          <div className={styles.smallMuted}>
            Wenn du gerade am Schema warst: IndexedDB löschen und neu laden.
          </div>
        </div>
      ) : null}

      <div className={styles.grid}>
        <div className={styles.center}>
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <div className={styles.cardTitle}>Leistungen / Produkte</div>
                <div className={styles.cardSub}>
                  Kategorie: <b>{activeCategory || "-"}</b>
                </div>
              </div>

              <div className={styles.searchWrap}>
                <input
                  className={styles.search}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Suchen…"
                />
              </div>
            </div>

            <PillTabs
              value={activeCategory}
              onChange={setActiveCategory}
              tabs={categories.map((c) => ({ value: c, label: c }))}
            />

            <div className={styles.itemsGrid}>
              {filteredItems.length === 0 ? (
                <div className={styles.alertInfo}>Keine Items in dieser Kategorie.</div>
              ) : (
                filteredItems.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    className={styles.itemCard}
                    onClick={() => addToCart(it)}
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
                    <div className={styles.itemBtn}>In Warenkorb</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className={styles.right}>
          <div className={`${styles.card} ${styles.sticky}`}>
            <div className={styles.cardHeadRow}>
              <div>
                <div className={styles.cardTitle}>Warenkorb</div>
                <div className={styles.cardSub}>
                  {cart.length} Position{cart.length === 1 ? "" : "en"}
                </div>
              </div>
              <div className={styles.totalBadge}>{money(total)} €</div>
            </div>

            {missingStaffForService ? (
              <div className={styles.alertWarn}>
                Mindestens ein <b>Service</b> hat keinen Mitarbeiter. Bitte auswählen.
              </div>
            ) : null}

            <div className={styles.cartList}>
              {cart.length === 0 ? (
                <div className={styles.alertInfo}>Noch keine Positionen im Warenkorb.</div>
              ) : (
                cart.map((l) => {
                  const needs = l.kind === "service";
                  const empMissing = needs && !l.staffId;

                  return (
                    <div key={l.id} className={styles.cartLine}>
                      <div className={styles.cartLineTop}>
                        <div>
                          <div className={styles.cartTitle}>{l.title}</div>
                          <div className={styles.cartMeta}>
                            {needs ? "Service (Mitarbeiter Pflicht)" : "Produkt (optional Mitarbeiter)"}
                          </div>
                        </div>
                        <button
                          className={styles.iconBtn}
                          type="button"
                          onClick={() => removeLine(l.id)}
                          aria-label="Entfernen"
                        >
                          ✕
                        </button>
                      </div>

                      <div className={styles.cartRow}>
                        <select
                          className={`${styles.select} ${empMissing ? styles.selectError : ""}`}
                          value={l.staffId}
                          onChange={(e) => {
                            const sid = e.target.value;
                            const sn = staff.find((s) => s.id === sid)?.name || "";
                            updateLine(l.id, { staffId: sid, staffName: sn });
                          }}
                        >
                          {!needs ? <option value="">— optional —</option> : null}
                          {staff.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>

                        <div className={styles.qtyBox}>
                          <button
                            type="button"
                            className={styles.qtyBtn}
                            onClick={() => updateLine(l.id, { qty: clampInt(l.qty - 1, 1, 99) })}
                          >
                            −
                          </button>
                          <div className={styles.qtyVal}>x{clampInt(l.qty, 1, 99)}</div>
                          <button
                            type="button"
                            className={styles.qtyBtn}
                            onClick={() => updateLine(l.id, { qty: clampInt(l.qty + 1, 1, 99) })}
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <div className={styles.cartRow}>
                        <input
                          className={styles.priceInput}
                          type="number"
                          step="0.01"
                          min="0"
                          value={l.unitPrice}
                          onChange={(e) => updateLine(l.id, { unitPrice: Number(e.target.value) })}
                        />
                        <div className={styles.lineTotal}>
                          {money(Number(l.unitPrice) * Number(l.qty))} €
                        </div>
                      </div>

                      {empMissing ? <div className={styles.miniWarn}>Mitarbeiter nötig</div> : null}
                    </div>
                  );
                })
              )}
            </div>

            <div className={styles.checkout}>
              <div className={styles.checkoutRow}>
                <div className={styles.checkoutLabel}>Total</div>
                <div className={styles.checkoutValue}>{money(total)} €</div>
              </div>

              <div className={styles.checkoutBtns}>
                <button
                  className={styles.btnPay}
                  type="button"
                  disabled={!cart.length || missingStaffForService}
                  onClick={() => checkout("cash")}
                >
                  CASH
                </button>
                <button
                  className={styles.btnPay}
                  type="button"
                  disabled={!cart.length || missingStaffForService}
                  onClick={() => checkout("card")}
                >
                  CARD
                </button>
              </div>

              <div className={styles.smallMuted}>
                Services: Mitarbeiter Pflicht. Produkte: Mitarbeiter optional.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Free price modal */}
      {freeOpen ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalTitle}>Freier Verkauf</div>

            <div className={styles.modalGrid}>
              <label className={styles.fLabel}>
                Name
                <input
                  className={styles.input}
                  value={freeTitle}
                  onChange={(e) => setFreeTitle(e.target.value)}
                  placeholder="z. B. Sonderleistung"
                />
              </label>

              <label className={styles.fLabel}>
                Preis (€)
                <input
                  className={styles.input}
                  value={freePrice}
                  onChange={(e) => setFreePrice(e.target.value)}
                  type="number"
                  step="0.01"
                  min="0"
                />
              </label>

              <label className={styles.fLabel}>
                Typ
                <select
                  className={styles.select}
                  value={freeKind}
                  onChange={(e) => setFreeKind(e.target.value)}
                >
                  <option value="service">Service (Mitarbeiter Pflicht)</option>
                  <option value="product">Produkt (Mitarbeiter optional)</option>
                </select>
              </label>

              {freeKind === "service" ? (
                <label className={styles.fLabel}>
                  Mitarbeiter
                  <select
                    className={styles.select}
                    value={freeStaffId}
                    onChange={(e) => setFreeStaffId(e.target.value)}
                  >
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {freeKind === "service" && !freeStaffId ? (
                <div className={styles.alertWarn}>Bitte Mitarbeiter wählen.</div>
              ) : null}
            </div>

            <div className={styles.modalActions}>
              <button className={styles.btnGhost} type="button" onClick={() => setFreeOpen(false)}>
                Abbrechen
              </button>
              <button className={styles.btnPrimary} type="button" onClick={addFreeLine}>
                In Warenkorb
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
