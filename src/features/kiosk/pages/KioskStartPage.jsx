import { useNavigate } from "react-router-dom";
import { useState } from "react";
import styles from "./KioskStartPage.module.css";

export default function KioskStartPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState("guest"); // guest|profile
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    instagram: "",
    marketingConsent: false,
  });

  function next() {
    const payload = { mode, customer: mode === "profile" ? form : null };
    sessionStorage.setItem("kiosk_payload_step0", JSON.stringify(payload));
    nav("/kiosk/services");
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.title}>Willkommen</h1>
          <p className={styles.sub}>Profil anlegen oder als Gast fortfahren.</p>
        </div>

        <div className={styles.switchRow}>
          <button
            className={`${styles.pill} ${mode === "guest" ? styles.pillActive : ""}`}
            onClick={() => setMode("guest")}
          >
            Als Gast
          </button>
          <button
            className={`${styles.pill} ${mode === "profile" ? styles.pillActive : ""}`}
            onClick={() => setMode("profile")}
          >
            Mit Profil
          </button>
        </div>

        {mode === "profile" && (
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Vorname</span>
              <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            </label>

            <label className={styles.field}>
              <span>Nachname</span>
              <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </label>

            <label className={styles.field}>
              <span>Telefon</span>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>

            <label className={styles.field}>
              <span>E-Mail (optional)</span>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>

            <label className={styles.field}>
              <span>Instagram (optional)</span>
              <input value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} />
            </label>

            <label className={styles.check}>
              <input
                type="checkbox"
                checked={form.marketingConsent}
                onChange={(e) => setForm({ ...form, marketingConsent: e.target.checked })}
              />
              <span>Marketing-Kontakt erlaubt (optional)</span>
            </label>
          </div>
        )}

        <div className={styles.footer}>
          <button className={styles.primary} onClick={next}>
            Weiter
          </button>
        </div>
      </div>
    </div>
  );
}
