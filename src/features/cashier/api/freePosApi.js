// src/features/cashier/api/freePosApi.js
import { db } from "../../../db/index.js";

/** ISO dateKey YYYY-MM-DD (lokal, stabil für Tagesabschluss) */
export function toDateKeyLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0.00";
  return v.toFixed(2);
}

export function clampInt(v, min, max) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Master data für Free POS */
export async function loadFreePosMasterData() {
  // staff: cashier + staff + admin dürfen hier als "Mitarbeiter" auswählbar sein
  const staff = await db.staff
    .filter((s) => s.active === 1 || s.active === true)
    .toArray();

  const services = await db.service_catalog
    .filter((s) => s.active === 1 || s.active === true)
    .toArray();

  const products = await db.product_catalog
    .filter((p) => p.active === 1 || p.active === true)
    .toArray();

  // Normalisieren für UI
  const serviceItems = services.map((s) => ({
    id: s.id,
    kind: "service",
    category: s.category || "Service",
    title: s.title || "",
    price: Number(s.price || 0),
    areaId: s.areaId || "",
    sortOrder: Number(s.sortOrder || 0),
  }));

  const productItems = products.map((p) => ({
    id: p.id,
    kind: "product",
    category: p.category || "Produkte",
    title: p.title || "",
    price: Number(p.price || 0),
    sku: p.sku || "",
    sortOrder: Number(p.sortOrder || 0),
  }));

  return {
    staff,
    items: [...serviceItems, ...productItems],
  };
}

/**
 * Checkout ohne Kundensystem:
 * - schreibt direkt in payments_today (eine Zeile pro Cart-Position)
 * - method: "cash"|"card"
 * - amount: lineTotal
 * - staffId/staffName: aus Line (bei Service Pflicht, bei Produkt optional)
 * - memberId: leer
 * - visitId: "FREE_<uuid>" (damit du später gruppieren kannst)
 */
export async function checkoutFreePos({ cart, method, cashierStaffId, cashierName }) {
  if (!cart?.length) return { ok: false, reason: "EMPTY" };

  const dateKey = toDateKeyLocal(new Date());
  const nowIso = new Date().toISOString();

  const visitId = `FREE_${crypto.randomUUID()}`;

  // Validierung: Service benötigt staffId
  const missing = cart.some((l) => l.kind === "service" && !l.staffId);
  if (missing) return { ok: false, reason: "MISSING_STAFF_FOR_SERVICE" };

  const rows = cart.map((l) => {
    const qty = clampInt(l.qty, 1, 99);
    const unit = Number(l.unitPrice || 0);
    const lineTotal = Number((unit * qty).toFixed(2));

    return {
      id: crypto.randomUUID(),
      visitId,
      memberId: "",

      dateKey,
      method, // cash | card
      amount: lineTotal,
      createdAt: nowIso,

      // Kassierer (aus USB Session / Role)
      cashierStaffId: cashierStaffId || "",
      cashierName: cashierName || "",

      // "Mitarbeiter" der Leistung/Produkt (für Auswertung)
      staffId: l.staffId || "",
      staffName: l.staffName || "",

      // Für spätere Exporte
      exportedAt: "",
      // Extra Infos (nicht im Schema – Dexie speichert zusätzliche Felder trotzdem)
      meta: {
        title: String(l.title || ""),
        kind: l.kind,
        qty,
        unitPrice: Number(unit.toFixed(2)),
      },
    };
  });

  await db.transaction("rw", db.payments_today, async () => {
    await db.payments_today.bulkPut(rows);
  });

  return { ok: true, visitId };
}

/** Tagesübersicht (heutiger Tag) aus payments_today */
export async function loadDailyFreePos(dateKey = toDateKeyLocal(new Date())) {
  const [staffAll, payments] = await Promise.all([
    db.staff.toArray(),
    db.payments_today.where("dateKey").equals(dateKey).toArray(),
  ]);

  const staffNameById = new Map(staffAll.map((s) => [s.id, s.name]));

  const total = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const cash = payments.filter((p) => p.method === "cash").reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const card = payments.filter((p) => p.method === "card").reduce((sum, p) => sum + Number(p.amount || 0), 0);

  // Gruppierung nach Mitarbeiter (staffId)
  const byStaff = new Map();
  for (const p of payments) {
    const sid = p.staffId || "UNKNOWN";
    const cur = byStaff.get(sid) || { total: 0, count: 0 };
    cur.total += Number(p.amount || 0);
    cur.count += 1;
    byStaff.set(sid, cur);
  }

  const byEmployee = Array.from(byStaff.entries())
    .map(([staffId, v]) => ({
      staffId,
      name: staffId === "UNKNOWN" ? "Ohne Mitarbeiter" : (staffNameById.get(staffId) || "Unbekannt"),
      total: Number(v.total.toFixed(2)),
      count: v.count,
    }))
    .sort((a, b) => b.total - a.total);

  // Top Artikel (meta.title)
  const byItemAgg = new Map();
  for (const p of payments) {
    const title = p?.meta?.title || "Unbekannt";
    const qty = Number(p?.meta?.qty || 1);
    const cur = byItemAgg.get(title) || { qty: 0, total: 0 };
    cur.qty += qty;
    cur.total += Number(p.amount || 0);
    byItemAgg.set(title, cur);
  }

  const byItem = Array.from(byItemAgg.entries())
    .map(([title, v]) => ({
      title,
      qty: v.qty,
      total: Number(v.total.toFixed(2)),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    dateKey,
    summary: {
      total: Number(total.toFixed(2)),
      cash: Number(cash.toFixed(2)),
      card: Number(card.toFixed(2)),
      linesCount: payments.length,
    },
    byEmployee,
    byItem,
  };
}
