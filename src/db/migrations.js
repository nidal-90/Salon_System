// src/db/migrations.js
function asMoney(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function normalizeActive(v) {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v == null) return 1;
  return Number(v) === 1 ? 1 : 0;
}

async function assignDisplayNos(tx, tableName, titleField) {
  const rows = await tx.table(tableName).toArray();
  // keep existing displayNo if present, otherwise assign sequential
  let next = 1;
  for (const r of rows) {
    if (!r.displayNo || Number(r.displayNo) <= 0) {
      r.displayNo = next++;
    } else {
      next = Math.max(next, Number(r.displayNo) + 1);
    }
    // normalize titles/names
    if (titleField && r[titleField] != null) {
      r[titleField] = String(r[titleField] || "").trim();
    }
  }
  await tx.table(tableName).bulkPut(rows);
}

export async function upgradeToV2(tx) {
  // staff defaults
  await tx.table("staff").toCollection().modify((s) => {
    if (!s.id) s.id = crypto.randomUUID();
    s.active = normalizeActive(s.active);
    s.name = String(s.name || "").trim() || "Unbekannt";
    s.role = s.role || "staff";
    if (!Array.isArray(s.areaIds)) s.areaIds = s.areaIds ? [s.areaIds] : [];
    if (s.usbKeyId == null) s.usbKeyId = "";
    if (s.sortOrder == null) s.sortOrder = 9999;
  });

  await tx.table("product_catalog").toCollection().modify((p) => {
    p.active = normalizeActive(p.active);
    p.price = asMoney(p.price ?? 0);
    if (!p.category) p.category = "Allgemein";
    if (p.sortOrder == null) p.sortOrder = 9999;
  });

  await tx.table("service_catalog").toCollection().modify((s) => {
    s.active = normalizeActive(s.active);
    s.price = asMoney(s.price ?? 0);
    if (!s.category) s.category = "Allgemein";
    if (s.sortOrder == null) s.sortOrder = 9999;
  });
}

export async function upgradeToV3(tx) {
  const table = tx.table("vouchers");
  await table.toCollection().modify((v) => {
    if (!v.id) v.id = crypto.randomUUID();
    v.code = String(v.code || "").trim();
    v.status = v.status === "redeemed" || v.status === "void" ? v.status : "active";
    v.amount = asMoney(v.amount ?? 0);
    v.currency = String(v.currency || "EUR").toUpperCase();
    if (!v.createdAt) v.createdAt = new Date().toISOString();
    if (!v.note) v.note = "";
  });
}

/**
 * v4 migration:
 * - areas.displayNo + product_categories.displayNo (UI IDs 01/02..)
 * - service_catalog.name from title
 * - product_catalog.name from title + categoryId from old category string
 */
export async function upgradeToV4(tx) {
  // Areas: add displayNo if missing
  await assignDisplayNos(tx, "areas", "name");
  await tx.table("areas").toCollection().modify((a) => {
    a.active = normalizeActive(a.active);
    a.name = String(a.name || "").trim();
  });

  // Ensure product_categories exists and has displayNo
  await assignDisplayNos(tx, "product_categories", "title");
  await tx.table("product_categories").toCollection().modify((c) => {
    c.active = normalizeActive(c.active);
    c.title = String(c.title || "").trim();
  });

  // Services: ensure name exists, normalize
  await tx.table("service_catalog").toCollection().modify((s) => {
    s.active = normalizeActive(s.active);
    s.price = asMoney(s.price ?? 0);
    // keep legacy title, but set name as primary for new UI
    if (!s.name) s.name = String(s.title || "").trim();
    s.title = String(s.title || s.name || "").trim();
  });

  // Products: ensure name exists, normalize
  // Map old string category -> product_categories row -> categoryId
  const cats = await tx.table("product_categories").toArray();
  const byTitle = new Map(cats.map((c) => [String(c.title || "").toLowerCase(), c]));

  await tx.table("product_catalog").toCollection().modify((p) => {
    p.active = normalizeActive(p.active);
    p.price = asMoney(p.price ?? 0);

    if (!p.name) p.name = String(p.title || "").trim();
    p.title = String(p.title || p.name || "").trim();

    // If old "category" exists and new categoryId missing -> create/match
    if (!p.categoryId) {
      const old = String(p.category || "").trim();
      const key = old.toLowerCase();
      if (old) {
        let c = byTitle.get(key);
        if (!c) {
          c = {
            id: crypto.randomUUID(),
            displayNo: 0, // will be assigned in a second pass
            title: old,
            active: 1,
          };
          cats.push(c);
          byTitle.set(key, c);
        }
        p.categoryId = c.id;
      }
    }
  });

  // If we created new categories during mapping, assign missing displayNo now
  if (cats.some((c) => !c.displayNo || Number(c.displayNo) <= 0)) {
    // assign sequential but keep existing
    let next = 1;
    // reserve existing
    const used = new Set(cats.map((c) => Number(c.displayNo || 0)).filter((x) => x > 0));
    while (used.has(next)) next++;

    for (const c of cats) {
      if (!c.displayNo || Number(c.displayNo) <= 0) {
        while (used.has(next)) next++;
        c.displayNo = next++;
        used.add(c.displayNo);
      }
    }
    await tx.table("product_categories").bulkPut(cats);
  }
}
