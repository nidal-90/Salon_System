// src/db/migrations.js
function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

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

export async function upgradeToV2(tx) {
  // staff defaults
  await tx.table("staff").toCollection().modify((s) => {
    if (!s.id) s.id = crypto.randomUUID();

    s.active = normalizeActive(s.active);
    s.name = String(s.name || "").trim() || "Unbekannt";

    s.role = s.role || "staff";
    if (!Array.isArray(s.areaIds)) s.areaIds = s.areaIds ? [s.areaIds] : [];
    if (s.usbKeyId == null) s.usbKeyId = "";

    s.commissionPct = clamp(s.commissionPct ?? 100, 0, 100);
    s.baseSalary = asMoney(s.baseSalary ?? 0);
    s.yearlyVacationDays = Math.max(0, Math.floor(Number(s.yearlyVacationDays ?? 20) || 20));

    if (s.sortOrder == null) s.sortOrder = 9999;
  });

  // absences
  await tx.table("absences").toCollection().modify((a) => {
    if (!a.id) a.id = crypto.randomUUID();
    a.staffId = a.staffId || "";
    a.dateKey = String(a.dateKey || "").slice(0, 10);
    if (a.type !== "vacation" && a.type !== "sick") a.type = "vacation";
    if (!a.createdAt) a.createdAt = new Date().toISOString();
  });

  // advances
  await tx.table("advances").toCollection().modify((x) => {
    if (!x.id) x.id = crypto.randomUUID();
    x.staffId = x.staffId || "";
    if (!x.timestamp) x.timestamp = new Date().toISOString();
    if (!x.dateKey) x.dateKey = String(x.timestamp).slice(0, 10);
    x.dateKey = String(x.dateKey || "").slice(0, 10);
    x.amount = asMoney(x.amount ?? 0);
    if (!x.note) x.note = "";
  });

  // manual_sales
  await tx.table("manual_sales").toCollection().modify((r) => {
    if (!r.id) r.id = crypto.randomUUID();
    r.staffId = r.staffId || "";
    r.dateKey = String(r.dateKey || "").slice(0, 10);
    if (!r.monthKey) r.monthKey = String(r.dateKey || "").slice(0, 7);
    r.amount = asMoney(r.amount ?? 0);
    if (!r.note) r.note = "";
  });

  // sanitize catalogs
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

/**
 * v3: Gutscheine (vouchers) sind neu.
 * Es gibt keine Alt-Daten, aber wir normieren falls du bereits testweise Einträge hattest.
 */
export async function upgradeToV3(tx) {
  const table = tx.table("vouchers");

  // Wenn es die Tabelle frisch gibt, ist sie leer. Trotzdem robust:
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
