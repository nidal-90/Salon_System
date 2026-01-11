import { useEffect, useMemo, useState } from "react";
import { db } from "../../../db/index.js";
import styles from "./CatalogAdminPage.module.css";

function money(n){ return Number(n||0).toFixed(2); }

export default function CatalogAdminPage() {
  const [areas, setAreas] = useState([]);
  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);

  // service create
  const [svcAreaId, setSvcAreaId] = useState("");
  const [svcCategory, setSvcCategory] = useState("Allgemein");
  const [svcTitle, setSvcTitle] = useState("");
  const [svcPrice, setSvcPrice] = useState(0);
  const [svcActive, setSvcActive] = useState(true);

  // product create
  const [prodCategory, setProdCategory] = useState("Produkte");
  const [prodTitle, setProdTitle] = useState("");
  const [prodPrice, setProdPrice] = useState(0);
  const [prodActive, setProdActive] = useState(true);

  const serviceCategories = useMemo(() => {
    const set = new Set(services.map(s => (s.category || "").trim()).filter(Boolean));
    return ["Allgemein", ...Array.from(set).sort((a,b)=>a.localeCompare(b))];
  }, [services]);

  const productCategories = useMemo(() => {
    const set = new Set(products.map(p => (p.category || "").trim()).filter(Boolean));
    return ["Produkte", ...Array.from(set).sort((a,b)=>a.localeCompare(b))];
  }, [products]);

  async function reload() {
    const [a, s, p] = await Promise.all([
      db.areas.toArray(),
      db.service_catalog.toArray(),
      db.product_catalog.toArray(),
    ]);
    a.sort((x,y)=>(Number(x.sortOrder||0)-Number(y.sortOrder||0)) || String(x.name||"").localeCompare(String(y.name||"")));
    s.sort((x,y)=> String(x.category||"").localeCompare(String(y.category||"")) || String(x.title||"").localeCompare(String(y.title||"")));
    p.sort((x,y)=> String(x.category||"").localeCompare(String(y.category||"")) || String(x.title||"").localeCompare(String(y.title||"")));
    setAreas(a);
    setServices(s);
    setProducts(p);

    if (!svcAreaId && a[0]?.id) setSvcAreaId(a[0].id);
  }

  useEffect(() => { reload(); }, []);

  async function addService(){
    if (!svcAreaId) return;
    const title = svcTitle.trim();
    if (!title) return;

    await db.service_catalog.put({
      id: crypto.randomUUID(),
      areaId: svcAreaId,
      category: (svcCategory || "Allgemein").trim() || "Allgemein",
      title,
      price: Number(svcPrice || 0),
      active: svcActive ? 1 : 0,
      sortOrder: 100,
    });

    setSvcTitle("");
    setSvcPrice(0);
    setSvcActive(true);
    reload();
  }

  async function addProduct(){
    const title = prodTitle.trim();
    if (!title) return;

    await db.product_catalog.put({
      id: crypto.randomUUID(),
      sku: "",
      title,
      brand: "",
      price: Number(prodPrice || 0),
      active: prodActive ? 1 : 0,
      category: (prodCategory || "Produkte").trim() || "Produkte",
      sortOrder: 100,
    });

    setProdTitle("");
    setProdPrice(0);
    setProdActive(true);
    reload();
  }

  async function toggleServiceActive(s){
    await db.service_catalog.update(s.id, { active: s.active ? 0 : 1 });
    reload();
  }
  async function toggleProductActive(p){
    await db.product_catalog.update(p.id, { active: p.active ? 0 : 1 });
    reload();
  }
  async function removeService(id){ await db.service_catalog.delete(id); reload(); }
  async function removeProduct(id){ await db.product_catalog.delete(id); reload(); }

  async function updateService(id, patch){ await db.service_catalog.update(id, patch); reload(); }
  async function updateProduct(id, patch){ await db.product_catalog.update(id, patch); reload(); }

  const areaById = useMemo(() => new Map(areas.map(a=>[a.id,a])), [areas]);

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.top}>
          <div>
            <h1 className={styles.h1}>Katalog</h1>
            <div className={styles.sub}>Services (mit Bereich + Kategorie) und Produkte (mit Kategorie) verwalten.</div>
          </div>
          <div className={styles.badge}>{services.length} Services · {products.length} Produkte</div>
        </div>

        <div className={styles.grid}>
          {/* Services */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>Services</div>
            <div className={styles.form}>
              <label className={styles.fLabel}>
                Bereich
                <select className={styles.input} value={svcAreaId} onChange={(e)=>setSvcAreaId(e.target.value)}>
                  {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>

              <label className={styles.fLabel}>
                Kategorie
                <select className={styles.input} value={svcCategory} onChange={(e)=>setSvcCategory(e.target.value)}>
                  {serviceCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>

              <label className={styles.fLabel}>
                Titel
                <input className={styles.input} value={svcTitle} onChange={(e)=>setSvcTitle(e.target.value)} placeholder="z.B. Haarschnitt Männer" />
              </label>

              <label className={styles.fLabel}>
                Preis (€)
                <input className={styles.input} type="number" step="0.01" value={svcPrice} onChange={(e)=>setSvcPrice(e.target.value)} />
              </label>

              <label className={styles.check}>
                <input type="checkbox" checked={svcActive} onChange={(e)=>setSvcActive(e.target.checked)} />
                Aktiv
              </label>

              <div className={styles.actions}>
                <button className={styles.btnPrimary} onClick={addService}>Hinzufügen</button>
              </div>
            </div>

            <div className={styles.sep} />

            <div className={styles.table}>
              <div className={styles.trHeadSvc}>
                <div>Bereich</div><div>Kategorie</div><div>Titel</div>
                <div className={styles.taRight}>Preis</div><div>Aktiv</div><div className={styles.taRight}>Aktion</div>
              </div>

              {services.map(s => (
                <div key={s.id} className={styles.trSvc}>
                  <div className={styles.muted}>{areaById.get(s.areaId)?.name || "-"}</div>

                  <select className={styles.inlineSelect} value={s.category || "Allgemein"} onChange={(e)=>updateService(s.id,{ category: e.target.value })}>
                    {serviceCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>

                  <input className={styles.inlineInput} value={s.title || ""} onChange={(e)=>updateService(s.id,{ title: e.target.value })} />

                  <input className={styles.inlineInputRight} type="number" step="0.01" value={Number(s.price || 0)} onChange={(e)=>updateService(s.id,{ price: Number(e.target.value || 0) })} />

                  <button className={styles.toggle} onClick={()=>toggleServiceActive(s)}>{s.active ? "ja" : "nein"}</button>

                  <div className={styles.taRight}>
                    <button className={styles.btnDanger} onClick={()=>removeService(s.id)}>Löschen</button>
                  </div>
                </div>
              ))}

              {services.length === 0 ? <div className={styles.empty}>Keine Services.</div> : null}
            </div>
          </div>

          {/* Products */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>Produkte</div>
            <div className={styles.form}>
              <label className={styles.fLabel}>
                Kategorie
                <select className={styles.input} value={prodCategory} onChange={(e)=>setProdCategory(e.target.value)}>
                  {productCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>

              <label className={styles.fLabel}>
                Titel
                <input className={styles.input} value={prodTitle} onChange={(e)=>setProdTitle(e.target.value)} placeholder="z.B. Shampoo" />
              </label>

              <label className={styles.fLabel}>
                Preis (€)
                <input className={styles.input} type="number" step="0.01" value={prodPrice} onChange={(e)=>setProdPrice(e.target.value)} />
              </label>

              <label className={styles.check}>
                <input type="checkbox" checked={prodActive} onChange={(e)=>setProdActive(e.target.checked)} />
                Aktiv
              </label>

              <div className={styles.actions}>
                <button className={styles.btnPrimary} onClick={addProduct}>Hinzufügen</button>
              </div>
            </div>

            <div className={styles.sep} />

            <div className={styles.table}>
              <div className={styles.trHeadProd}>
                <div>Kategorie</div><div>Titel</div>
                <div className={styles.taRight}>Preis</div><div>Aktiv</div><div className={styles.taRight}>Aktion</div>
              </div>

              {products.map(p => (
                <div key={p.id} className={styles.trProd}>
                  <select className={styles.inlineSelect} value={p.category || "Produkte"} onChange={(e)=>updateProduct(p.id,{ category: e.target.value })}>
                    {productCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>

                  <input className={styles.inlineInput} value={p.title || ""} onChange={(e)=>updateProduct(p.id,{ title: e.target.value })} />

                  <input className={styles.inlineInputRight} type="number" step="0.01" value={Number(p.price || 0)} onChange={(e)=>updateProduct(p.id,{ price: Number(e.target.value || 0) })} />

                  <button className={styles.toggle} onClick={()=>toggleProductActive(p)}>{p.active ? "ja" : "nein"}</button>

                  <div className={styles.taRight}>
                    <button className={styles.btnDanger} onClick={()=>removeProduct(p.id)}>Löschen</button>
                  </div>
                </div>
              ))}

              {products.length === 0 ? <div className={styles.empty}>Keine Produkte.</div> : null}
            </div>
          </div>
        </div>

        <div className={styles.foot}>
          Für Reports: Services/Produkte werden später über `visit_services` / `visit_products` ausgewertet (wer hat was gemacht).
        </div>
      </div>
    </div>
  );
}
