// src/hooks/useUsbSession.js
import { useEffect, useMemo, useState } from "react";
import { clearSession, readSession, writeSession, parseKeyFileJson } from "../services/usb/usbSession.js";
import { Roles } from "../app/config/roles.js";

function normalizeSession(s) {
  if (!s) return { usbPresent: false, role: Roles.GUEST, staffId: null, staffName: null };

  return {
    usbPresent: true,
    role: s.role || Roles.STAFF,
    staffId: s.staffId || null,
    staffName: s.staffName || null,
  };
}

export default function useUsbSession() {
  const [session, setSession] = useState(() => normalizeSession(readSession()));

  useEffect(() => {
    const onStorage = () => setSession(normalizeSession(readSession()));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return useMemo(
    () => ({
      ...session,
      setSession: (next) => {
        writeSession(next);
        setSession(normalizeSession(readSession()));
      },
      loadKeyFromFile: async (file) => {
        const text = await file.text();
        const next = parseKeyFileJson(text);
        writeSession(next);
        setSession(normalizeSession(readSession()));
        return next;
      },
      clear: () => {
        clearSession();
        setSession(normalizeSession(readSession()));
      },
    }),
    [session]
  );
}
