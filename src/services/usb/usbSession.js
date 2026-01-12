// src/services/usb/usbSession.js
import { Roles } from "../../app/config/roles.js";

const STORAGE_KEY = "sibel:usbSession:v1";

/**
 * Keyfile JSON – unterstützt alt + neu:
 * Neu empfohlen:
 *  { "role": "admin"|"cashier"|"staff", "staffId": "...", "staffName": "..." }
 *
 * Legacy:
 *  { "role": "cash", "staffId": "...", "name": "..." }
 */
export function parseKeyFileJson(text) {
  let data;
  try {
    // BOM entfernen falls vorhanden
    const cleaned = String(text || "").replace(/^\uFEFF/, "").trim();
    data = JSON.parse(cleaned);
  } catch {
    throw new Error("Keyfile ist kein gültiges JSON.");
  }

  let role = String(data?.role || "").trim().toLowerCase();

  // Legacy mapping
  if (role === "cash") role = Roles.CASHIER;
  if (role === "administrator") role = Roles.ADMIN;

  const allowed = [Roles.STAFF, Roles.CASHIER, Roles.ADMIN];
  if (!allowed.includes(role)) {
    throw new Error(`Ungültige Rolle im Keyfile: "${role}"`);
  }

  const staffId = data?.staffId != null ? String(data.staffId).trim() : "";
  const staffName =
    String(data?.staffName || data?.name || "").trim();

  // staff/cashier: staffId empfohlen (kannst du zwingend machen)
  if ((role === Roles.STAFF || role === Roles.CASHIER) && !staffId) {
    throw new Error("Keyfile muss staffId enthalten (für staff/cashier).");
  }

  return {
    role,
    staffId: staffId || null,
    staffName: staffName || null,
    loadedAt: new Date().toISOString(),
  };
}

export function readSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isSessionActive(session = readSession()) {
  if (!session) return false;
  if (session.expiresAt && Date.now() > Number(session.expiresAt)) return false;
  return true;
}

export function getSession() {
  const s = readSession();
  if (!s?.role) return { role: Roles.GUEST };
  return s;
}

export function hasCashAccess(session) {
  const r = session?.role;
  return r === Roles.CASHIER || r === Roles.ADMIN;
}

export function isStaff(session) {
  return session?.role === Roles.STAFF;
}

export function isCashier(session) {
  return session?.role === Roles.CASHIER;
}

export function isAdmin(session) {
  return session?.role === Roles.ADMIN;
}

export function isGuest(session) {
  return !session?.role || session?.role === Roles.GUEST;
}
