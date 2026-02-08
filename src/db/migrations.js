// src/db/migrations.js
function asMoney(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}
function safeStr(x) {
  return String(x == null ? "" : x).trim();
}
function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}
function normalizeActive(v) {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v == null) return 1;
  return Number(v) === 1 ? 1 : 0;
}

async function assignDisplayNos(tx, tableName, titleField) {
  const rows = await tx.table(tableName).toArray();
  let next = 1;
  for (const r of rows) {
    if (!r.displayNo || Number(r.displayNo) <= 0) {
      r.displayNo = next++;
    } else {
      next = Math.max(next, Number(r.displayNo) + 1);
    }
    if (titleField && r[titleField] != null) r[titleField] = String(r[titleField] || "").trim();
  }
  await tx.table(tableName).bulkPut(rows);
}

export async function upgradeToV2(tx) {
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

export async function upgradeToV4(tx) {
  await assignDisplayNos(tx, "areas", "name");
  await tx.table("areas").toCollection().modify((a) => {
    a.active = normalizeActive(a.active);
    a.name = String(a.name || "").trim();
  });

  await assignDisplayNos(tx, "product_categories", "title");
  await tx.table("product_categories").toCollection().modify((c) => {
    c.active = normalizeActive(c.active);
    c.title = String(c.title || "").trim();
  });

  await tx.table("service_catalog").toCollection().modify((s) => {
    s.active = normalizeActive(s.active);
    s.price = asMoney(s.price ?? 0);
    if (!s.name) s.name = String(s.title || "").trim();
    s.title = String(s.title || s.name || "").trim();
  });

  const cats = await tx.table("product_categories").toArray();
  const byTitle = new Map(cats.map((c) => [String(c.title || "").toLowerCase(), c]));

  await tx.table("product_catalog").toCollection().modify((p) => {
    p.active = normalizeActive(p.active);
    p.price = asMoney(p.price ?? 0);

    if (!p.name) p.name = String(p.title || "").trim();
    p.title = String(p.title || p.name || "").trim();

    if (!p.categoryId) {
      const old = String(p.category || "").trim();
      const key = old.toLowerCase();
      if (old) {
        let c = byTitle.get(key);
        if (!c) {
          c = { id: crypto.randomUUID(), displayNo: 0, title: old, active: 1 };
          cats.push(c);
          byTitle.set(key, c);
        }
        p.categoryId = c.id;
      }
    }
  });

  if (cats.some((c) => !c.displayNo || Number(c.displayNo) <= 0)) {
    let next = 1;
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

export async function upgradeToV5(tx) {
  // v5 adds order_drafts/order_events/checkout_events/visit_voids
  // intentionally no heavy changes here
}

/**
 * v6 migration:
 * - legacy group entries that were stored inside customers -> move to groups + group_members
 * - backfill visits.groupId for legacy group visits (type="group" and customerId used as groupId)
 */
export async function upgradeToV6(tx) {
  const now = new Date().toISOString();

  // ---- 1) migrate legacy groups from customers (if they exist) ----
  const customers = await tx.table("customers").toArray().catch(() => []);
  const legacyGroups = (customers || []).filter((c) => {
    // accept multiple legacy flags (robust)
    const kind = String(c?.kind || "").toLowerCase();
    return kind === "group" || !!c?.group || String(c?.type || "").toLowerCase() === "group";
  });

  for (const c of legacyGroups) {
    const groupId = String(c.id);
    const legacy = c?.group || {};
    const title =
      safeStr(legacy?.title) ||
      safeStr(c?.displayName) ||
      safeStr(`${c?.firstName || ""} ${c?.lastName || ""}`) ||
      "Gruppe";

    // create/overwrite group row (id stable)
    await tx.table("groups").put({
      id: groupId,
      createdAt: c.createdAt || now,
      updatedAt: c.updatedAt || now,
      title,
      active: 1,

      contactFirstName: safeStr(c.firstName),
      contactLastName: safeStr(c.lastName),
      phone: onlyDigits(c.phone),
      email: safeStr(c.email).toLowerCase(),
      instagram: safeStr(c.instagram),

      marketingConsent: c.marketingConsent ? 1 : 0,
      address: c.address || { street: "", city: "" },
      note: safeStr(c.note),

      paymentMode: safeStr(legacy?.paymentMode) === "split" ? "split" : "single",
    });

    const members = Array.isArray(legacy?.members) ? legacy.members : [];
    const rows = members.map((m, idx) => ({
      id: crypto.randomUUID(),
      groupId,
      displayName: safeStr(m.displayName) || `Mitglied ${idx + 1}`,
      phone: onlyDigits(m.phone),
      customerId: safeStr(m.customerId),
      sortOrder: idx + 1,
      createdAt: c.createdAt || now,
      updatedAt: c.updatedAt || now,
    }));

    if (rows.length) {
      await tx.table("group_members").bulkPut(rows);
    }
  }

  // ---- 2) backfill visits.groupId for legacy group-visits ----
  // Legacy behaviour in your orderApi: customerId = groupId (for group visits)
  const visits = await tx.table("visits").toArray().catch(() => []);
  for (const v of visits || []) {
    const type = String(v?.type || "").toLowerCase();
    const hasGroupId = String(v?.groupId || "").trim().length > 0;
    if (hasGroupId) continue;

    if (type === "group") {
      const cid = String(v?.customerId || "").trim();
      if (cid) {
        // If customerId looks like a groupId, store it
        await tx.table("visits").update(String(v.id), { groupId: cid });
      }
    }
  }
}
