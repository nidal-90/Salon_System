// src/features/admin/pages/CatalogAdminPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../db/index.js";
import styles from "./CatalogAdminPage.module.css";

function pad2(n) {
  const x = Number(n || 0);
  return String(x).padStart(2, "0");
}

function money(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? x.toFixed(2) : "0.00";
}

async function nextFreeDisplayNo(tableName) {
  const rows = await db.table(tableName).toArray();
  const used = new Set(rows.map((r) => Number(r.displayNo || 0)).filter((x) => x > 0));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

export default function CatalogAdminPage() {
    const navigate = useNavigate();
  // Data
  const [areas, setAreas] = useState([]);
  const [serviceRows, setServiceRows] = useState([]);
  const [productCategories, setProductCategories] = useState([]);
  const [productRows, setProductRows] = useState([]);

  // Create: Area
  const [areaName, setAreaName] = useState("");
  const [areaActive, setAreaActive] = useState(true);

  // Create: Service
  const [svcAreaId, setSvcAreaId] = useState("");
  const [svcName, setSvcName] = useState("");
  const [svcPrice, setSvcPrice] = useState(0);
  const [svcActive, setSvcActive] = useState(true);

  // Create: Product Category
  const [catName, setCatName] = useState("");
  const [catActive, setCatActive] = useState(true);

  // Create: Product
  const [prodCategoryId, setProdCategoryId] = useState("");
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

    // Sort by displayNo then name
    a.sort((x, y) => (Number(x.displayNo || 9999) - Number(y.displayNo || 9999)) || String(x.name || "").localeCompare(String(y.name || "")));
    c.sort((x, y) => (Number(x.displayNo || 9999) - Number(y.displayNo || 9999)) || String(x.title || "").localeCompare(String(y.title || "")));

    // Sort services by area displayNo then name
    const areaNo = new Map(a.map((x) => [x.id, Number(x.displayNo || 9999)]));
    s.sort((x, y) => (areaNo.get(x.areaId) - areaNo.get(y.areaId)) || String(x.name || "").localeCompare(String(y.name || "")));

    // Sort products by category displayNo then name
    const catNo = new Map(c.map((x) => [x.id, Number(x.displayNo || 9999)]));
    p.sort((x, y) => (catNo.get(x.categoryId) - catNo.get(y.categoryId)) || String(x.name || "").localeCompare(String(y.name || "")));

    setAreas(a);
    setServiceRows(s);
    setProductCategories(c);
    setProductRows(p);

    if (!svcAreaId && a[0]?.id) setSvcAreaId(a[0].id);
    if (!prodCategoryId && c[0]?.id) setProdCategoryId(c[0].id);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);
  const catById = useMemo(() => new Map(productCategories.map((c) => [c.id, c])), [productCategories]);

  // ---------- Toggle UI ----------
  function Switch({ value, onToggle }) {
    return (
      <div className={styles.switchWrap}>
        <button
          type="button"
          className={`${styles.switch} ${value ? styles.switchOn : ""}`}
          onClick={onToggle}
          aria-pressed={!!value}
          aria-label={value ? "Aktiv" : "Inaktiv"}
        >
          <span className={styles.knob} />
        </button>
        <span className={styles.switchText}>{value ? "Aktiv" : "Inaktiv"}</span>
      </div>
    );
  }

  // ---------- Areas ----------
  async function addArea() {
    const name = areaName.trim();
    if (!name) return;

    const displayNo = await nextFreeDisplayNo("areas");

    await db.areas.put({
      id: crypto.randomUUID(),
      displayNo,
      name,
      active: areaActive ? 1 : 0,
      // legacy fields kept for compatibility (not used)
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
    // optional safety: prevent delete if referenced by services
    const count = await db.service_catalog.where("areaId").equals(id).count();
    if (count > 0) {
      alert("Dieser Bereich wird noch von Services verwendet. Bitte zuerst Services entfernen oder umhängen.");
      return;
    }
    await db.areas.delete(id);
    await reload();
  }

  // ---------- Services ----------
  async function addService() {
    if (!svcAreaId) return;
    const name = svcName.trim();
    if (!name) return;

    await db.service_catalog.put({
      id: crypto.randomUUID(),
      areaId: svcAreaId,
      name,
      price: Number(svcPrice || 0),
      active: svcActive ? 1 : 0,
      // legacy fields kept (not used)
      title: name,
      category: "",
      sortOrder: 0,
    });

    setSvcName("");
    setSvcPrice(0);
    setSvcActive(true);
    await reload();
  }

  async function updateService(id, patch) {
    // keep title in sync if user edits name
    const p = { ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, "name")) {
      p.title = String(patch.name || "");
    }
    await db.service_catalog.update(id, p);
    await reload();
  }

  async function removeService(id) {
    await db.service_catalog.delete(id);
    await reload();
  }

  // ---------- Product Categories ----------
  async function addCategory() {
    const title = catName.trim();
    if (!title) return;

    const displayNo = await nextFreeDisplayNo("product_categories");

    await db.product_categories.put({
      id: crypto.randomUUID(),
      displayNo,
      title,
      active: catActive ? 1 : 0,
      sortOrder: 0, // legacy
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
      alert("Diese Kategorie wird noch von Produkten verwendet. Bitte zuerst Produkte entfernen oder umhängen.");
      return;
    }
    await db.product_categories.delete(id);
    await reload();
  }

  // ---------- Products ----------
  async function addProduct() {
    if (!prodCategoryId) return;
    const name = prodName.trim();
    if (!name) return;

    await db.product_catalog.put({
      id: crypto.randomUUID(),
      categoryId: prodCategoryId,
      name,
      price: Number(prodPrice || 0),
      active: prodActive ? 1 : 0,
      // legacy fields kept (not used)
      title: name,
      category: "",
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
    if (Object.prototype.hasOwnProperty.call(patch, "name")) {
      p.title = String(patch.name || "");
    }
    await db.product_catalog.update(id, p);
    await reload();
  }

  async function removeProduct(id) {
    await db.product_catalog.delete(id);
    await reload();
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
<div className={styles.top}>
  <div className={styles.topLeft}>
    <button
      type="button"
      className={styles.backBtn}
      onClick={() => navigate("/admin")}
      aria-label="Zurück zum Admin-Menü"
    >
      <span className={styles.backIcon}>←</span>
      <span>Admin</span>
    </button>

    <div>
      <h1 className={styles.h1}>Katalog</h1>
      <div className={styles.sub}>
        Verwalte Bereiche, Services, Produkt-Kategorien und Produkte.
        Alles offline in Dexie / IndexedDB.
      </div>
    </div>
  </div>

  <div className={styles.badge}>
    {areas.length} Bereiche · {serviceRows.length} Services ·{" "}
    {productCategories.length} Kategorien · {productRows.length} Produkte
  </div>
</div>


        <div className={styles.grid}>
          {/* AREAS */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>
              <span>Bereiche</span>
              <span className={styles.cardHint}>Nur Name + Aktiv. ID wird automatisch als 01/02… angezeigt.</span>
            </div>

            <div className={styles.form}>
              <label className={styles.fLabel}>
                Bereich
                <input
                  className={styles.input}
                  value={areaName}
                  onChange={(e) => setAreaName(e.target.value)}
                  placeholder="z. B. Haarschnitt, Farbe, SPA"
                />
              </label>

              <label className={styles.fLabel}>
                Status
                <Switch value={areaActive} onToggle={() => setAreaActive((v) => !v)} />
              </label>

              <div className={styles.actions}>
                <button className={styles.btnPrimary} onClick={addArea} type="button">
                  Hinzufügen
                </button>
              </div>
            </div>

            <div className={styles.sep} />

            <div className={styles.table}>
              <div className={styles.trHead}>
                <div>ID</div><div>Name</div><div className={styles.taRight}>—</div><div>Status</div><div className={styles.taRight}>Aktion</div>
              </div>

              {areas.map((a) => (
                <div key={a.id} className={styles.row}>
                  <div><span className={styles.idBadge}>{pad2(a.displayNo)}</span></div>

                  <input
                    className={styles.inlineInput}
                    value={a.name || ""}
                    onChange={(e) => updateArea(a.id, { name: e.target.value })}
                  />

                  <div className={styles.taRight} />

                  <Switch value={!!a.active} onToggle={() => updateArea(a.id, { active: a.active ? 0 : 1 })} />

                  <div className={styles.taRight}>
                    <button className={styles.btnDanger} onClick={() => removeArea(a.id)} type="button">
                      Löschen
                    </button>
                  </div>
                </div>
              ))}

              {areas.length === 0 ? <div className={styles.empty}>Noch keine Bereiche.</div> : null}
            </div>
          </div>

          {/* SERVICES */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>
              <span>Services</span>
              <span className={styles.cardHint}>Kein Kategorie-Feld mehr. Nur Bereich + Name + Preis.</span>
            </div>

            <div className={styles.form}>
              <label className={styles.fLabel}>
                Bereich
                <select className={styles.select} value={svcAreaId} onChange={(e) => setSvcAreaId(e.target.value)}>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {pad2(a.displayNo)} · {a.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.fLabel}>
                Name
                <input
                  className={styles.input}
                  value={svcName}
                  onChange={(e) => setSvcName(e.target.value)}
                  placeholder="z. B. Haarschnitt Herren"
                />
              </label>

              <label className={styles.fLabel}>
                Preis (€)
                <input
                  className={styles.input}
                  type="number"
                  step="0.01"
                  value={svcPrice}
                  onChange={(e) => setSvcPrice(e.target.value)}
                />
              </label>

              <label className={styles.fLabel}>
                Status
                <Switch value={svcActive} onToggle={() => setSvcActive((v) => !v)} />
              </label>

              <div className={styles.actions}>
                <button className={styles.btnPrimary} onClick={addService} type="button">
                  Hinzufügen
                </button>
              </div>
            </div>

            <div className={styles.sep} />

            <div className={styles.table}>
              <div className={styles.trHead}>
                <div>Bereich</div><div>Name</div><div className={styles.taRight}>Preis</div><div>Status</div><div className={styles.taRight}>Aktion</div>
              </div>

              {serviceRows.map((s) => {
                const a = areaById.get(s.areaId);
                return (
                  <div key={s.id} className={styles.row}>
                    <div className={styles.muted}>
                      {a ? `${pad2(a.displayNo)} · ${a.name}` : "—"}
                    </div>

                    <input
                      className={styles.inlineInput}
                      value={s.name || s.title || ""}
                      onChange={(e) => updateService(s.id, { name: e.target.value })}
                    />

                    <input
                      className={`${styles.inlineInput} ${styles.inlineRight}`}
                      type="number"
                      step="0.01"
                      value={Number(s.price || 0)}
                      onChange={(e) => updateService(s.id, { price: Number(e.target.value || 0) })}
                    />

                    <Switch value={!!s.active} onToggle={() => updateService(s.id, { active: s.active ? 0 : 1 })} />

                    <div className={styles.taRight}>
                      <button className={styles.btnDanger} onClick={() => removeService(s.id)} type="button">
                        Löschen
                      </button>
                    </div>
                  </div>
                );
              })}

              {serviceRows.length === 0 ? <div className={styles.empty}>Noch keine Services.</div> : null}
            </div>
          </div>

          {/* PRODUCT CATEGORIES */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>
              <span>Produkt-Kategorien</span>
              <span className={styles.cardHint}>Eigene Tabelle. Anzeige-ID 01/02… wird automatisch vergeben.</span>
            </div>

            <div className={styles.form}>
              <label className={styles.fLabel}>
                Kategorie
                <input
                  className={styles.input}
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="z. B. HairCare, Beauty, Pflege"
                />
              </label>

              <label className={styles.fLabel}>
                Status
                <Switch value={catActive} onToggle={() => setCatActive((v) => !v)} />
              </label>

              <div className={styles.actions}>
                <button className={styles.btnPrimary} onClick={addCategory} type="button">
                  Hinzufügen
                </button>
              </div>
            </div>

            <div className={styles.sep} />

            <div className={styles.table}>
              <div className={styles.trHead}>
                <div>ID</div><div>Name</div><div className={styles.taRight}>—</div><div>Status</div><div className={styles.taRight}>Aktion</div>
              </div>

              {productCategories.map((c) => (
                <div key={c.id} className={styles.row}>
                  <div><span className={styles.idBadge}>{pad2(c.displayNo)}</span></div>

                  <input
                    className={styles.inlineInput}
                    value={c.title || ""}
                    onChange={(e) => updateCategory(c.id, { title: e.target.value })}
                  />

                  <div className={styles.taRight} />

                  <Switch value={!!c.active} onToggle={() => updateCategory(c.id, { active: c.active ? 0 : 1 })} />

                  <div className={styles.taRight}>
                    <button className={styles.btnDanger} onClick={() => removeCategory(c.id)} type="button">
                      Löschen
                    </button>
                  </div>
                </div>
              ))}

              {productCategories.length === 0 ? <div className={styles.empty}>Noch keine Kategorien.</div> : null}
            </div>
          </div>

          {/* PRODUCTS */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>
              <span>Produkte</span>
              <span className={styles.cardHint}>Kategorie ist ein Foreign Key (categoryId). Kein Dropdown “Modus” mehr.</span>
            </div>

            <div className={styles.form}>
              <label className={styles.fLabel}>
                Kategorie
                <select className={styles.select} value={prodCategoryId} onChange={(e) => setProdCategoryId(e.target.value)}>
                  {productCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {pad2(c.displayNo)} · {c.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.fLabel}>
                Name
                <input
                  className={styles.input}
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  placeholder="z. B. Shampoo"
                />
              </label>

              <label className={styles.fLabel}>
                Preis (€)
                <input
                  className={styles.input}
                  type="number"
                  step="0.01"
                  value={prodPrice}
                  onChange={(e) => setProdPrice(e.target.value)}
                />
              </label>

              <label className={styles.fLabel}>
                Status
                <Switch value={prodActive} onToggle={() => setProdActive((v) => !v)} />
              </label>

              <div className={styles.actions}>
                <button className={styles.btnPrimary} onClick={addProduct} type="button">
                  Hinzufügen
                </button>
              </div>
            </div>

            <div className={styles.sep} />

            <div className={styles.table}>
              <div className={styles.trHead}>
                <div>Kategorie</div><div>Name</div><div className={styles.taRight}>Preis</div><div>Status</div><div className={styles.taRight}>Aktion</div>
              </div>

              {productRows.map((p) => {
                const c = catById.get(p.categoryId);
                return (
                  <div key={p.id} className={styles.row}>
                    <div className={styles.muted}>
                      {c ? `${pad2(c.displayNo)} · ${c.title}` : "—"}
                    </div>

                    <input
                      className={styles.inlineInput}
                      value={p.name || p.title || ""}
                      onChange={(e) => updateProduct(p.id, { name: e.target.value })}
                    />

                    <input
                      className={`${styles.inlineInput} ${styles.inlineRight}`}
                      type="number"
                      step="0.01"
                      value={Number(p.price || 0)}
                      onChange={(e) => updateProduct(p.id, { price: Number(e.target.value || 0) })}
                    />

                    <Switch value={!!p.active} onToggle={() => updateProduct(p.id, { active: p.active ? 0 : 1 })} />

                    <div className={styles.taRight}>
                      <button className={styles.btnDanger} onClick={() => removeProduct(p.id)} type="button">
                        Löschen
                      </button>
                    </div>
                  </div>
                );
              })}

              {productRows.length === 0 ? <div className={styles.empty}>Noch keine Produkte.</div> : null}
            </div>

            <div className={styles.foot}>
              Hinweis: Services/Produkte werden später über <code>visit_services</code> / <code>visit_products</code> ausgewertet.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
