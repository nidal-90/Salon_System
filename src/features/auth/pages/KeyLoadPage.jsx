// src/features/auth/pages/KeyLoadPage.jsx
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import useUsbSession from "../../../hooks/useUsbSession.js";
import { parseKeyFileJson } from "../../../services/usb/usbSession.js";
import styles from "./KeyLoadPage.module.css";

export default function KeyLoadPage() {
  const nav = useNavigate();
  const usb = useUsbSession();
  const [err, setErr] = useState("");
  const [info, setInfo] = useState(null);

  async function onPick(e) {
    setErr("");
    setInfo(null);

    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();

      // Robust parse + Normalisierung (admin/cashier/staff + legacy)
      const session = parseKeyFileJson(text);

      // Hook schreibt in localStorage + aktualisiert State
      usb.setSession(session);

      setInfo(session);
    } catch (ex) {
      console.error("Key load failed:", ex);
      setErr(ex?.message || "Key konnte nicht gelesen werden. Bitte JSON prüfen.");
    }
  }

  function go() {
    const role = usb.role;
    if (role === "cashier") nav("/reception"); // oder "/cashier" je nach neuer Struktur
    else if (role === "admin") nav("/admin");
    else if (role === "staff") nav("/staff");
    else nav("/start");
  }

  const canContinue = usb.role && usb.role !== "guest";

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <h2 className={styles.title}>Key laden</h2>
        <p className={styles.sub}>Lade die Key-Datei (.json). Danach werden Rechte gesetzt.</p>

        <div className={styles.box}>
          <input
            className={styles.file}
            type="file"
            accept=".json,.txt,application/json"
            onChange={onPick}
          />
          <div className={styles.hint}>Unterstützt .json Dateien (z. B. vom USB-Stick).</div>
        </div>

        <div className={styles.preview}>
          <div>
            <span>Rolle:</span>
            <b>{usb.role || info?.role || "guest"}</b>
          </div>
          <div>
            <span>User:</span>
            <b>{usb.staffName || info?.staffName || "-"}</b>
          </div>
        </div>

        {err && <div className={styles.error}>{err}</div>}

        <div className={styles.footer}>
          <button className={styles.secondary} onClick={() => nav("/start")} type="button">
            Zurück
          </button>
          <button className={styles.primary} onClick={go} disabled={!canContinue} type="button">
            Weiter
          </button>
        </div>
      </div>
    </div>
  );
}
