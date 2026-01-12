// src/features/vouchers/api/vouchersApi.js
import { db } from "../../../db/index.js";

function asMoney(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

/**
 * Erzeugt einen 12-stelligen numerischen Code.
 * crypto.getRandomValues ist stabil im Browser.
 */
function randomNumericCode(len = 12) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += String(bytes[i] % 10);
  }
  return out;
}

async function generateUniqueCode(len = 12, maxTries = 20) {
  for (let i = 0; i < maxTries; i++) {
    const code = randomNumericCode(len);
    const exists = await db.vouchers.where("code").equals(code).count();
    if (exists === 0) return code;
  }
  throw new Error("Konnte keinen eindeutigen Gutschein-Code erzeugen. Bitte erneut versuchen.");
}

/**
 * Gutschein verkaufen / erstellen.
 * amount = frei (z.B. 50, 100, 73.20)
 */
export async function createVoucher({
  amount,
  currency = "EUR",
  customerId = null,
  createdByStaffId = "",
  createdByStaffName = "",
  note = "",
}) {
  const amt = asMoney(amount);
  if (amt <= 0) throw new Error("Betrag muss größer als 0 sein.");

  const code = await generateUniqueCode(12);

  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    code,
    status: "active",
    amount: amt,
    currency: String(currency || "EUR").toUpperCase(),
    customerId: customerId || null,
    createdAt: now,
    createdByStaffId: createdByStaffId || "",
    createdByStaffName: createdByStaffName || "",
    redeemedAt: null,
    redeemedByStaffId: "",
    redeemedByStaffName: "",
    redeemedVisitId: "",
    note: String(note || ""),
  };

  await db.vouchers.add(row);
  return row;
}

/**
 * Coupon/Gutschein nach Code finden.
 */
export async function getVoucherByCode(code) {
  const c = String(code || "").trim();
  if (!c) return null;
  return db.vouchers.where("code").equals(c).first();
}

/**
 * Gutschein einlösen:
 * - markiert als redeemed
 * - verknüpft mit visitId
 * - (Optional) später könntest du auch Teil-Einlösung ergänzen
 */
export async function redeemVoucher({
  code,
  visitId,
  redeemedByStaffId = "",
  redeemedByStaffName = "",
}) {
  const c = String(code || "").trim();
  if (!c) throw new Error("Code fehlt.");
  if (!visitId) throw new Error("visitId fehlt.");

  return db.transaction("rw", db.vouchers, async () => {
    const v = await db.vouchers.where("code").equals(c).first();
    if (!v) throw new Error("Gutschein nicht gefunden.");
    if (v.status !== "active") throw new Error("Gutschein ist nicht mehr gültig (bereits benutzt oder storniert).");

    const now = new Date().toISOString();
    const updated = {
      ...v,
      status: "redeemed",
      redeemedAt: now,
      redeemedVisitId: String(visitId),
      redeemedByStaffId: redeemedByStaffId || "",
      redeemedByStaffName: redeemedByStaffName || "",
    };

    await db.vouchers.put(updated);
    return updated;
  });
}

/**
 * Gutschein stornieren/ungültig machen (nicht gelöscht, audit-sicher).
 */
export async function voidVoucher({ code, note = "" }) {
  const c = String(code || "").trim();
  if (!c) throw new Error("Code fehlt.");

  return db.transaction("rw", db.vouchers, async () => {
    const v = await db.vouchers.where("code").equals(c).first();
    if (!v) throw new Error("Gutschein nicht gefunden.");
    if (v.status !== "active") throw new Error("Nur aktive Gutscheine können storniert werden.");

    const updated = {
      ...v,
      status: "void",
      note: String(note || v.note || ""),
    };

    await db.vouchers.put(updated);
    return updated;
  });
}
