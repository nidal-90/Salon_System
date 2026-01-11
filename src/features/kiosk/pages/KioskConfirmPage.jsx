import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createVisitFromKiosk } from "../api/kioskApi.js";
import styles from "./KioskConfirmPage.module.css";

export default function KioskConfirmPage() {
  const nav = useNavigate();
  const payload = JSON.parse(sessionStorage.getItem("kiosk_payload_step3") || "{}");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const areasCount = payload.requestedAreas?.length || 0;
  const productsCount = payload.products?.length || 0;

  const display = useMemo(() => {
    return {
      name: payload.displayName || "Kunde",
      group: payload.members?.length ? `${payload.members.length} Personen` : "Einzelkunde",
      payment: payload.preferredPaymentMode === "split" ? "Separat" : "Zusammen",
      note: payload.note || "-",
    };
  }, [payload]);

  async function finish() {
    setSaving(true);
    setErr("");
    try {
      await createVisitFromKiosk(payload);

      // Lock kiosk after finish
      sessionStorage.removeItem("kiosk_payload_step0");
      sessionStorage.removeItem("kiosk_payload_step1");
      sessionStorage.removeItem("kiosk_payload_step2");
      sessionStorage.removeItem("kiosk_payload_step3");

      nav("/kiosk/locked");
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h2 className={styles.title}>Bestätigung</h2>
          <p className={styles.sub}>Bitte prüfen und abschließen.</p>
        </div>

        <div className={styles.summary}>
          <div className={styles.kv}><span>Name</span><b>{display.name}</b></div>
          <div className={styles.kv}><span>Typ</span><b>{display.group}</b></div>
          <div className={styles.kv}><span>Zahlung</span><b>{display.payment}</b></div>
          <div className={styles.kv}><span>Bereiche</span><b>{areasCount}</b></div>
          <div className={styles.kv}><span>Produkte</span><b>{productsCount}</b></div>
          <div className={styles.kv}><span>Notiz</span><b>{display.note}</b></div>
        </div>

        {err && <div className={styles.error}>Fehler: {err}</div>}

        <div className={styles.footer}>
          <button className={styles.secondary} onClick={() => nav("/kiosk/products")} type="button">
            Zurück
          </button>
          <button className={styles.primary} onClick={finish} disabled={saving} type="button">
            {saving ? "Speichern..." : "Check-in abschließen"}
          </button>
        </div>
      </div>
    </div>
  );
}
