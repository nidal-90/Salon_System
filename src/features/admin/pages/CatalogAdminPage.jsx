// src/features/admin/pages/CatalogAdminPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../db/index.js";
import styles from "./CatalogAdminPage.module.css";

function pad2(n) {
  const x = Number(n || 0);
  return String(x).padStart(2, "0");
}

async function nextFreeDisplayNo(tableName) {
  const rows = await db.table(tableName).toArray();
  const used = new Set(rows.map((r) => Number(r.displayNo || 0)).filter((x) => x > 0));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

function Switch({ value, onToggle }) {
  return (
    <label className={styles.switch}>
      <input type="checkbox" checked={!!value} onChange={onToggle} />
      <span />
    </label>
  );
}

export default function CatalogAdminPage() {
  const nav = useNavigate();

  // Tabs
  const [topTab, setTopTab] = useState("treatments"); // treatments | products
  const [subTabTreat, setSubTabTreat] = useState("areas"); // areas | treatments
  const [subTabProd, setSubTabProd] = useState("categories"); // categories | products

  const [q, setQ] = useState("");

  // Data
  const [areas, setAreas] = useState([]);
  const [treatments, setTreatments] = useState([]); // service_catalog
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);

  // Selected filter
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");

  // Create forms
  const [areaName, setAreaName] = useState("");
  const [areaActive, setAreaActive] = useState(true);

  const [treatName, setTreatName] = useState("");
  const [treatPrice, setTreatPrice] = useState(0);
  const [treatActive, setTreatActive] = useState(true);

  const [catName, setCatName] = useState("");
  const [catActive, setCatActive] = useState(true);

  const [prodName, setProdName] = useState("");
  const [prodPrice, setProdPrice] = useState(0);
  const [prodActive, setProdActive] = useState(true);

  async function reload() {
    const [a, s, c, p] = await Promise.all([
      db.areas.toArray(),
      db.service_catalog.toArray(),
      db.product_categories.toArray(),
      db.product_catalog.toArray(),
    ]);

    a.sort(
      (x, y) =>
        Number(x.displayNo || 9999) - Number(y.displayNo || 9999) ||
        String(x.name || "").localeCompare(String(y.name || ""))
    );
    c.sort(
      (x, y) =>
        Number(x.displayNo || 9999) - Number(y.displayNo || 9999) ||
        String(x.title || "").localeCompare(String(y.title || ""))
    );

    const areaNo = new Map(a.map((x) => [x.id, Number(x.displayNo || 9999)]));
    s.sort(
      (x, y) =>
        areaNo.get(x.areaId) - areaNo.get(y.areaId) ||
        String(x.name || "").localeCompare(String(y.name || ""))
    );

    const catNo = new Map(c.map((x) => [x.id, Number(x.displayNo || 9999)]));
    p.sort(
      (x, y) =>
        catNo.get(x.categoryId) - catNo.get(y.categoryId) ||
        String(x.name || "").localeCompare(String(y.name || ""))
    );

    setAreas(a);
    setTreatments(s);
    setCategories(c);
    setProducts(p);

    if (!selectedAreaId && a[0]?.id) setSelectedAreaId(a[0].id);
    if (!selectedCategoryId && c[0]?.id) setSelectedCategoryId(c[0].id);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // Search filter (applies to current view)
  const qlc = q.trim().toLowerCase();

  const filteredAreas = useMemo(() => {
    if (!qlc) return areas;
    return areas.filter((a) => String(a.name || "").toLowerCase().includes(qlc));
  }, [areas, qlc]);

  const filteredTreatments = useMemo(() => {
    let list = treatments;
    if (selectedAreaId) list = list.filter((s) => s.areaId === selectedAreaId);
    if (!qlc) return list;
    return list.filter((s) => String(s.name || s.title || "").toLowerCase().includes(qlc));
  }, [treatments, selectedAreaId, qlc]);

  const filteredCategories = useMemo(() => {
    if (!qlc) return categories;
    return categories.filter((c) => String(c.title || "").toLowerCase().includes(qlc));
  }, [categories, qlc]);

  const filteredProducts = useMemo(() => {
    let list = products;
    if (selectedCategoryId) list = list.filter((p) => p.categoryId === selectedCategoryId);
    if (!qlc) return list;
    return list.filter((p) => String(p.name || p.title || "").toLowerCase().includes(qlc));
  }, [products, selectedCategoryId, qlc]);

  // CRUD: Areas
  async function addArea() {
    const name = areaName.trim();
    if (!name) return;
    const displayNo = await nextFreeDisplayNo("areas");
    await db.areas.put({
      id: crypto.randomUUID(),
      displayNo,
      name,
      active: areaActive ? 1 : 0,
      code: "",
      sortOrder: 0,
    });
    setAreaName("");
    setAreaActive(true);
    await reload();
  }

  async function updateArea(id, patch) {
    await db.areas.update(id, patch);
    await reload();
  }

  async function removeArea(id) {
    const count = await db.service_catalog.where("areaId").equals(id).count();
    if (count > 0) {
      alert(
        "Der Bereich kann nicht gelöscht werden, da noch Services vorhanden sind. Bitte löschen Sie zuerst die Services."
      );
      return;
    }
    await db.areas.delete(id);
    if (selectedAreaId === id) setSelectedAreaId("");
    await reload();
  }

  // CRUD: Treatments (service_catalog)
  async function addTreatment() {
    if (!selectedAreaId) return;
    const name = treatName.trim();
    if (!name) return;

    await db.service_catalog.put({
      id: crypto.randomUUID(),
      areaId: selectedAreaId,
      name,
      title: name,
      price: Number(treatPrice || 0),
      active: treatActive ? 1 : 0,
      category: "",
      sortOrder: 0,
    });

    setTreatName("");
    setTreatPrice(0);
    setTreatActive(true);
    await reload();
  }

  async function updateTreatment(id, patch) {
    const p = { ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, "name")) p.title = String(patch.name || "");
    await db.service_catalog.update(id, p);
    await reload();
  }

  async function removeTreatment(id) {
    await db.service_catalog.delete(id);
    await reload();
  }

  // CRUD: Categories
  async function addCategory() {
    const title = catName.trim();
    if (!title) return;
    const displayNo = await nextFreeDisplayNo("product_categories");
    await db.product_categories.put({
      id: crypto.randomUUID(),
      displayNo,
      title,
      active: catActive ? 1 : 0,
      sortOrder: 0,
    });
    setCatName("");
    setCatActive(true);
    await reload();
  }

  async function updateCategory(id, patch) {
    await db.product_categories.update(id, patch);
    await reload();
  }

  async function removeCategory(id) {
    const count = await db.product_catalog.where("categoryId").equals(id).count();
    if (count > 0) {
      alert("Diese Kategorie wird noch von Produkten verwendet. Bitte zuerst Produkte entfernen.");
      return;
    }
    await db.product_categories.delete(id);
    if (selectedCategoryId === id) setSelectedCategoryId("");
    await reload();
  }

  // CRUD: Products
  async function addProduct() {
    if (!selectedCategoryId) return;
    const name = prodName.trim();
    if (!name) return;

    await db.product_catalog.put({
      id: crypto.randomUUID(),
      categoryId: selectedCategoryId,
      name,
      title: name,
      price: Number(prodPrice || 0),
      active: prodActive ? 1 : 0,
      brand: "",
      sku: "",
      sortOrder: 0,
    });

    setProdName("");
    setProdPrice(0);
    setProdActive(true);
    await reload();
  }

  async function updateProduct(id, patch) {
    const p = { ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, "name")) p.title = String(patch.name || "");
    await db.product_catalog.update(id, p);
    await reload();
  }

  async function removeProduct(id) {
    await db.product_catalog.delete(id);
    await reload();
  }

  // UI helpers
  const areaPills = areas;
  const catPills = categories;

  const activeAreaLabel = selectedAreaId ? areaById.get(selectedAreaId) : null;
  const activeCatLabel = selectedCategoryId ? catById.get(selectedCategoryId) : null;

  // Dynamic headings (this is what you asked: title changes when clicking)
  const treatCardTitle = subTabTreat === "areas" ? "Behandlungen" : "Services";
  const treatCardHint =
    subTabTreat === "areas"
      ? "Behandlungen-Gruppen (ehem. Bereiche) verwalten."
      : "Services (Behandlungen) je Gruppe — sauber getrennt.";

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.topBar}>
          {/* LEFT */}
          <div className={styles.topLeft}>
            <div>
              <div className={styles.title}>Katalog</div>
              <div className={styles.sub}>
                Services (Behandlungen) und Produkte (Kategorien/Produkte).
              </div>
            </div>
            <button className={styles.backBtnLeft} type="button" onClick={() => nav("/admin")}>
              ← Home
            </button>
          </div>

          {/* RIGHT */}
          <div className={styles.topRight}>
            <input
              className={styles.search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                topTab === "treatments"
                  ? "Suche Behandlungen/Services…"
                  : "Suche Kategorien/Produkte…"
              }
            />

            <div className={styles.tabs}>
              <button
                className={`${styles.tab} ${topTab === "treatments" ? styles.tabActive : ""}`}
                onClick={() => setTopTab("treatments")}
                type="button"
              >
                Behandlungen
              </button>
              <button
                className={`${styles.tab} ${topTab === "products" ? styles.tabActive : ""}`}
                onClick={() => setTopTab("products")}
                type="button"
              >
                Produkte
              </button>
            </div>
          </div>
        </div>

        {/* CONTENT */}
        {topTab === "treatments" ? (
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <div className={styles.cardTitle}>{treatCardTitle}</div>
                <div className={styles.cardHint}>{treatCardHint}</div>
              </div>

              <div className={styles.subTabs}>
                {/* CHANGED: Bereiche -> Behandlungen */}
                <button
                  className={`${styles.subTab} ${subTabTreat === "areas" ? styles.subTabActive : ""}`}
                  onClick={() => setSubTabTreat("areas")}
                  type="button"
                >
                  Behandlungen
                </button>

                {/* CHANGED: Behandlungen -> Services */}
                <button
                  className={`${styles.subTab} ${subTabTreat === "treatments" ? styles.subTabActive : ""}`}
                  onClick={() => setSubTabTreat("treatments")}
                  type="button"
                >
                  Services
                </button>
              </div>
            </div>

            {subTabTreat === "areas" ? (
              <>
                <div className={styles.formRow}>
                  <div className={styles.field}>
                    <div className={styles.label}>Behandlung (Gruppe)</div>
                    <input
                      className={styles.input}
                      value={areaName}
                      onChange={(e) => setAreaName(e.target.value)}
                      placeholder="z. B. Augenbrauen, Haare, SPA"
                    />
                  </div>
                  <div className={styles.fieldInline}>
                    <div className={styles.label}>Aktiv</div>
                    <Switch value={areaActive} onToggle={() => setAreaActive((v) => !v)} />
                  </div>
                  <button className={styles.primaryBtn} onClick={addArea} type="button">
                    Hinzufügen
                  </button>
                </div>

                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Status</th>
                        <th className={styles.right}>Aktion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAreas.length === 0 ? (
                        <tr>
                          <td colSpan={4} className={styles.muted}>
                            Keine Behandlungen.
                          </td>
                        </tr>
                      ) : (
                        filteredAreas.map((a) => (
                          <tr key={a.id}>
                            <td>
                              <span className={styles.idBadge}>{pad2(a.displayNo)}</span>
                            </td>
                            <td>
                              <input
                                className={styles.inlineInput}
                                value={a.name || ""}
                                onChange={(e) => updateArea(a.id, { name: e.target.value })}
                              />
                            </td>
                            <td>
                              <Switch
                                value={!!a.active}
                                onToggle={() => updateArea(a.id, { active: a.active ? 0 : 1 })}
                              />
                            </td>
                            <td className={styles.right}>
                              <button
                                className={styles.dangerBtn}
                                onClick={() => removeArea(a.id)}
                                type="button"
                              >
                                Löschen
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <div className={styles.pillsRow}>
                  {areaPills.map((a) => (
                    <button
                      key={a.id}
                      className={`${styles.pill} ${selectedAreaId === a.id ? styles.pillActive : ""}`}
                      onClick={() => setSelectedAreaId(a.id)}
                      type="button"
                    >
                      {a.name}
                    </button>
                  ))}
                </div>

                <div className={styles.formRow}>
                  <div className={styles.field}>
                    <div className={styles.label}>
                      Service (für {activeAreaLabel ? activeAreaLabel.name : "—"})
                    </div>
                    <input
                      className={styles.input}
                      value={treatName}
                      onChange={(e) => setTreatName(e.target.value)}
                      placeholder="z. B. Augenbrauen zupfen"
                    />
                  </div>

                  <div className={styles.field}>
                    <div className={styles.label}>Preis (€)</div>
                    <input
                      className={styles.input}
                      type="number"
                      step="0.01"
                      value={treatPrice}
                      onChange={(e) => setTreatPrice(e.target.value)}
                    />
                  </div>

                  <div className={styles.fieldInline}>
                    <div className={styles.label}>Aktiv</div>
                    <Switch value={treatActive} onToggle={() => setTreatActive((v) => !v)} />
                  </div>

                  <button className={styles.primaryBtn} onClick={addTreatment} type="button">
                    Hinzufügen
                  </button>
                </div>

                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th className={styles.right}>Preis</th>
                        <th>Status</th>
                        <th className={styles.right}>Aktion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTreatments.length === 0 ? (
                        <tr>
                          <td colSpan={4} className={styles.muted}>
                            Keine Services in dieser Behandlung.
                          </td>
                        </tr>
                      ) : (
                        filteredTreatments.map((s) => (
                          <tr key={s.id}>
                            <td>
                              <input
                                className={styles.inlineInput}
                                value={s.name || s.title || ""}
                                onChange={(e) => updateTreatment(s.id, { name: e.target.value })}
                              />
                            </td>
                            <td className={styles.right}>
                              <input
                                className={`${styles.inlineInput} ${styles.inlineRight}`}
                                type="number"
                                step="0.01"
                                value={Number(s.price || 0)}
                                onChange={(e) =>
                                  updateTreatment(s.id, { price: Number(e.target.value || 0) })
                                }
                              />
                            </td>
                            <td>
                              <Switch
                                value={!!s.active}
                                onToggle={() => updateTreatment(s.id, { active: s.active ? 0 : 1 })}
                              />
                            </td>
                            <td className={styles.right}>
                              <button
                                className={styles.dangerBtn}
                                onClick={() => removeTreatment(s.id)}
                                type="button"
                              >
                                Löschen
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <div className={styles.cardTitle}>Produkte</div>
                <div className={styles.cardHint}>Kategorien & Produkte — mit Filter je Kategorie.</div>
              </div>

              <div className={styles.subTabs}>
                <button
                  className={`${styles.subTab} ${subTabProd === "categories" ? styles.subTabActive : ""}`}
                  onClick={() => setSubTabProd("categories")}
                  type="button"
                >
                  Kategorien
                </button>
                <button
                  className={`${styles.subTab} ${subTabProd === "products" ? styles.subTabActive : ""}`}
                  onClick={() => setSubTabProd("products")}
                  type="button"
                >
                  Produkte
                </button>
              </div>
            </div>

            {subTabProd === "categories" ? (
              <>
                <div className={styles.formRow}>
                  <div className={styles.field}>
                    <div className={styles.label}>Kategorie</div>
                    <input
                      className={styles.input}
                      value={catName}
                      onChange={(e) => setCatName(e.target.value)}
                      placeholder="z. B. HairCare, Beauty, Pflege"
                    />
                  </div>
                  <div className={styles.fieldInline}>
                    <div className={styles.label}>Aktiv</div>
                    <Switch value={catActive} onToggle={() => setCatActive((v) => !v)} />
                  </div>
                  <button className={styles.primaryBtn} onClick={addCategory} type="button">
                    Hinzufügen
                  </button>
                </div>

                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Status</th>
                        <th className={styles.right}>Aktion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCategories.length === 0 ? (
                        <tr>
                          <td colSpan={4} className={styles.muted}>
                            Keine Kategorien.
                          </td>
                        </tr>
                      ) : (
                        filteredCategories.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <span className={styles.idBadge}>{pad2(c.displayNo)}</span>
                            </td>
                            <td>
                              <input
                                className={styles.inlineInput}
                                value={c.title || ""}
                                onChange={(e) => updateCategory(c.id, { title: e.target.value })}
                              />
                            </td>
                            <td>
                              <Switch
                                value={!!c.active}
                                onToggle={() => updateCategory(c.id, { active: c.active ? 0 : 1 })}
                              />
                            </td>
                            <td className={styles.right}>
                              <button
                                className={styles.dangerBtn}
                                onClick={() => removeCategory(c.id)}
                                type="button"
                              >
                                Löschen
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <div className={styles.pillsRow}>
                  {catPills.map((c) => (
                    <button
                      key={c.id}
                      className={`${styles.pill} ${selectedCategoryId === c.id ? styles.pillActive : ""}`}
                      onClick={() => setSelectedCategoryId(c.id)}
                      type="button"
                    >
                      {c.title}
                    </button>
                  ))}
                </div>

                <div className={styles.formRow}>
                  <div className={styles.field}>
                    <div className={styles.label}>
                      Produkt (für {activeCatLabel ? activeCatLabel.title : "—"})
                    </div>
                    <input
                      className={styles.input}
                      value={prodName}
                      onChange={(e) => setProdName(e.target.value)}
                      placeholder="z. B. Shampoo"
                    />
                  </div>

                  <div className={styles.field}>
                    <div className={styles.label}>Preis (€)</div>
                    <input
                      className={styles.input}
                      type="number"
                      step="0.01"
                      value={prodPrice}
                      onChange={(e) => setProdPrice(e.target.value)}
                    />
                  </div>

                  <div className={styles.fieldInline}>
                    <div className={styles.label}>Aktiv</div>
                    <Switch value={prodActive} onToggle={() => setProdActive((v) => !v)} />
                  </div>

                  <button className={styles.primaryBtn} onClick={addProduct} type="button">
                    Hinzufügen
                  </button>
                </div>

                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th className={styles.right}>Preis</th>
                        <th>Status</th>
                        <th className={styles.right}>Aktion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.length === 0 ? (
                        <tr>
                          <td colSpan={4} className={styles.muted}>
                            Keine Produkte in dieser Kategorie.
                          </td>
                        </tr>
                      ) : (
                        filteredProducts.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <input
                                className={styles.inlineInput}
                                value={p.name || p.title || ""}
                                onChange={(e) => updateProduct(p.id, { name: e.target.value })}
                              />
                            </td>
                            <td className={styles.right}>
                              <input
                                className={`${styles.inlineInput} ${styles.inlineRight}`}
                                type="number"
                                step="0.01"
                                value={Number(p.price || 0)}
                                onChange={(e) =>
                                  updateProduct(p.id, { price: Number(e.target.value || 0) })
                                }
                              />
                            </td>
                            <td>
                              <Switch
                                value={!!p.active}
                                onToggle={() => updateProduct(p.id, { active: p.active ? 0 : 1 })}
                              />
                            </td>
                            <td className={styles.right}>
                              <button
                                className={styles.dangerBtn}
                                onClick={() => removeProduct(p.id)}
                                type="button"
                              >
                                Löschen
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className={styles.footNote}>
                  Hinweis: Auswertung später über <code>visit_services</code> / <code>visit_products</code>.
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
