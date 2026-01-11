import { useState } from "react";
import styles from "./GuestProfileForm.module.css";
import { openDb } from "../../../db/dexie";
import { db } from "../../../db/dexie";

function uid() {
  return crypto.randomUUID();
}

export default function GuestProfileForm({ onDone, disabled }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [insta, setInsta] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setMsg("");
    const n = name.trim();
    if (!n) return setMsg("Name ist Pflicht.");

    setSaving(true);
    try {
      await openDb();

      const now = new Date().toISOString();
      await db.customers.add({
        id: uid(),
        name: n,
        phone: phone.trim(),
        insta: insta.trim(),
        email: email.trim(),
        createdAt: now,
        updatedAt: now,
      });

      setMsg("Gespeichert.");
      onDone?.();
    } catch (e) {
      setMsg(e?.message || "Fehler beim Speichern.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.title}>Kundenprofil</div>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Name*</span>
          <input disabled={disabled || saving} value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className={styles.field}>
          <span>Telefon</span>
          <input disabled={disabled || saving} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>

        <label className={styles.field}>
          <span>Instagram</span>
          <input disabled={disabled || saving} value={insta} onChange={(e) => setInsta(e.target.value)} />
        </label>

        <label className={styles.field}>
          <span>E-Mail</span>
          <input disabled={disabled || saving} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>

      {msg ? <div className={styles.msg}>{msg}</div> : null}

      <div className={styles.actions}>
        <button className={styles.btn} disabled={disabled || saving} onClick={save}>
          {saving ? "Speichert..." : "Fertig"}
        </button>
      </div>

      {disabled ? <div className={styles.note}>Hinweis: Mit USB eingeloggt ist Guest-Profil-Tablet gesperrt.</div> : null}
    </div>
  );
}
