import { useEffect, useMemo, useState } from "react";
import { clearSession, readSession, writeSession } from "../services/usb/usbSession.js";
import { Roles } from "../app/config/roles.js";

function normalizeSession(s) {
  if (!s) return { usbPresent: false, role: null, staffId: null, staffName: null };
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

  const api = useMemo(() => {
    return {
      ...session,
      async loadKeyFromFile(file) {
        const text = await file.text();
        const json = JSON.parse(text);

        // expected: { role: "cashier"|"staff"|"admin", staffId, staffName }
        writeSession(json);
        setSession(normalizeSession(json));
      },
      lock() {
        clearSession();
        setSession(normalizeSession(null));
      },
      // “Login once per day” tracking will be stored as staff_events later
    };
  }, [session]);

  return api;
}
