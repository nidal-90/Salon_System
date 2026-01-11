// src/services/usb/usbSession.js
import { ROLES } from "../../app/config/constants";

const STORAGE_KEY = "sibel_session_v1";

/**
 * Erwartetes Keyfile JSON:
 * { "role": "cash" | "staff", "staffId": "...", "name": "..." }
 * - cash: cashierId = staffId (oder eigene id)
 * - staff: staffId muss gesetzt sein
 */
export function parseKeyFileJson(text) {
  const data = JSON.parse(text);
  const role = data?.role;

  if (role !== ROLES.CASH && role !== ROLES.STAFF) {
    throw new Error("Ungültige Rolle im Keyfile.");
  }

  if (!data.staffId) {
    throw new Error("Keyfile muss staffId enthalten.");
  }

  return {
    role,
    staffId: String(data.staffId),
    name: String(data.name || ""),
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

/**
 * Speichert die Session (z.B. nach Key-Import).
 */
export function writeSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

/**
 * Hilfsfunktion: TRUE wenn Session vorhanden und nicht abgelaufen (optional).
 */
export function isSessionActive(session = readSession()) {
  if (!session) return false;
  // Optional: Ablaufzeit prüfen, wenn du expiresAt nutzt
  if (session.expiresAt && Date.now() > Number(session.expiresAt)) return false;
  return true;
}

export function getSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { role: ROLES.GUEST };
    const s = JSON.parse(raw);
    if (!s?.role) return { role: ROLES.GUEST };
    return s;
  } catch {
    return { role: ROLES.GUEST };
  }
}


export function setSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isCash(session) {
  return session?.role === ROLES.CASH;
}

export function isStaff(session) {
  return session?.role === ROLES.STAFF;
}

export function isGuest(session) {
  return !session?.role || session?.role === ROLES.GUEST;
}
