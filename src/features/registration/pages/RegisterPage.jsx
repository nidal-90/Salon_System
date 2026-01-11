import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getNextGuestDisplayName } from "../services/guestCounter.js";
import styles from "./RegisterPage.module.css";

/** Helpers */
const onlyDigits = (s) => (s || "").replace(/\D/g, "");

const normalizeInstagram = (value) => {
  let v = (value || "").trim();

  // allow @handle
  if (v.startsWith("@")) v = v.slice(1);

  // if URL given, extract handle
  v = v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "");
  v = v.split(/[/?#]/)[0];

  return v;
};

const isValidEmail = (email) => {
  const v = (email || "").trim();
  if (!v) return true; // optional field is okay
  // pragmatic email check
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
};

const isValidInstagramHandle = (handle) => {
  const v = (handle || "").trim();
  if (!v) return true; // optional is okay
  if (v.length < 1 || v.length > 30) return false;
  if (!/^[a-zA-Z0-9._]+$/.test(v)) return false;
  if (v.endsWith(".")) return false;
  if (v.includes("..")) return false;
  return true;
};

export default function RegisterPage() {
  const nav = useNavigate();

  const [mode, setMode] = useState("profile"); // profile|guest|wedding
  const [note, setNote] = useState("");

  const [profile, setProfile] = useState({
    fullName: "",
    phone: "",
    email: "",
    instagram: "",
    street: "",
    city: "",
  });

  const [wedding, setWedding] = useState({
    title: "Hochzeit",
    contactName: "",
    phone: "",
    email: "",
    street: "",
    city: "",
    paymentMode: "single", // single|split
  });

  const [members, setMembers] = useState([{ displayName: "Braut", phone: "" }]);

  // Validation
  const errors = useMemo(() => {
    const e = {};

    if (mode === "profile") {
      const fullName = profile.fullName.trim();
      const phone = profile.phone.trim();
      const emailOk = isValidEmail(profile.email);
      const igOk = isValidInstagramHandle(profile.instagram);

      if (fullName.length < 2) e.profileFullName = "Bitte mindestens 2 Zeichen.";
      if (phone.length < 6) e.profilePhone = "Bitte eine gültige Telefonnummer eingeben (min. 6 Ziffern).";
      if (!emailOk) e.profileEmail = "Bitte eine gültige E-Mail eingeben.";
      if (!igOk) e.profileInstagram = "Bitte einen gültigen Instagram-Handle eingeben (ohne Leerzeichen).";
    }

    if (mode === "wedding") {
      const title = wedding.title.trim();
      const contact = wedding.contactName.trim();
      const phone = wedding.phone.trim();
      const emailOk = isValidEmail(wedding.email);

      if (title.length < 2) e.weddingTitle = "Bitte mindestens 2 Zeichen.";
      if (contact.length < 2) e.weddingContact = "Bitte mindestens 2 Zeichen.";
      if (phone.length < 6) e.weddingPhone = "Bitte eine gültige Telefonnummer eingeben (min. 6 Ziffern).";
      if (!emailOk) e.weddingEmail = "Bitte eine gültige E-Mail eingeben.";

      if (!members.length) e.members = "Mindestens 1 Mitglied erforderlich.";
      members.forEach((m, idx) => {
        if ((m.displayName || "").trim().length < 2) e[`memberName_${idx}`] = "Name: mindestens 2 Zeichen.";
      });
    }

    return e;
  }, [mode, profile, wedding, members]);

  const isValid = useMemo(() => {
    if (mode === "guest") return true;
    return Object.keys(errors).length === 0;
  }, [mode, errors]);

  function addMember() {
    setMembers((p) => [...p, { displayName: "", phone: "" }]);
  }
  function updateMember(i, patch) {
    setMembers((p) => p.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }
  function removeMember(i) {
    setMembers((p) => p.filter((_, idx) => idx !== i));
  }

  async function next() {
    if (!isValid) return;

    let payload = { mode, note: note.trim() };

    if (mode === "guest") {
      const displayName = await getNextGuestDisplayName();
      payload.displayName = displayName;
      payload.customer = null;
      payload.group = null;
    }

    if (mode === "profile") {
      const instagram = normalizeInstagram(profile.instagram);
      payload.displayName = profile.fullName.trim();
      payload.customer = {
        fullName: profile.fullName.trim(),
        phone: profile.phone.trim(),
        email: profile.email.trim(),
        instagram,
        address: {
          street: profile.street.trim(),
          city: profile.city.trim(),
        },
      };
      payload.group = null;
    }

    if (mode === "wedding") {
      payload.displayName = wedding.title.trim();
      payload.customer = {
        fullName: wedding.contactName.trim(),
        phone: wedding.phone.trim(),
        email: wedding.email.trim(),
        instagram: "",
        address: {
          street: wedding.street.trim(),
          city: wedding.city.trim(),
        },
      };
      payload.group = {
        title: wedding.title.trim(),
        paymentMode: wedding.paymentMode,
        members: members.map((m) => ({
          displayName: (m.displayName || "").trim(),
          phone: (m.phone || "").trim(),
        })),
      };
    }

    sessionStorage.setItem("kiosk_profile", JSON.stringify(payload));
    nav("/order");
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <header className={styles.header}>
          <div>
            <h2 className={styles.title}>Kunde registrieren</h2>
            <p className={styles.sub}>Profil, Gast oder Hochzeit/Gruppe.</p>
          </div>
        </header>

        <div className={styles.segment} role="tablist" aria-label="Registrierungsmodus">
          <button
            className={`${styles.segBtn} ${mode === "profile" ? styles.segBtnActive : ""}`}
            onClick={() => setMode("profile")}
            type="button"
            role="tab"
            aria-selected={mode === "profile"}
          >
            Profil
          </button>
          <button
            className={`${styles.segBtn} ${mode === "guest" ? styles.segBtnActive : ""}`}
            onClick={() => setMode("guest")}
            type="button"
            role="tab"
            aria-selected={mode === "guest"}
          >
            Gast
          </button>
          <button
            className={`${styles.segBtn} ${mode === "wedding" ? styles.segBtnActive : ""}`}
            onClick={() => setMode("wedding")}
            type="button"
            role="tab"
            aria-selected={mode === "wedding"}
          >
            Hochzeit / Gruppe
          </button>
        </div>

        {mode === "profile" && (
          <section className={styles.section}>
            <div className={styles.grid}>
              <Field label="Name *" error={errors.profileFullName}>
                <input
                  className={styles.input}
                  value={profile.fullName}
                  onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))}
                  placeholder="Vor- und Nachname"
                  required
                />
              </Field>

              <Field label="Telefon *" hint="Nur Zahlen." error={errors.profilePhone}>
                <input
                  className={styles.input}
                  value={profile.phone}
                  onChange={(e) => setProfile((p) => ({ ...p, phone: onlyDigits(e.target.value) }))}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="z. B. 015112345678"
                  required
                />
              </Field>

              <Field label="E-Mail (optional)" error={errors.profileEmail}>
                <input
                  className={styles.input}
                  type="email"
                  value={profile.email}
                  onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                  placeholder="name@domain.de"
                />
              </Field>

              <Field label="Instagram (optional)" hint="Nur Handle, z. B. salon.system" error={errors.profileInstagram}>
                <input
                  className={styles.input}
                  value={profile.instagram}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, instagram: normalizeInstagram(e.target.value) }))
                  }
                  placeholder="z. B. salon.system"
                />
              </Field>

              <Field label="Straße (optional)">
                <input
                  className={styles.input}
                  value={profile.street}
                  onChange={(e) => setProfile((p) => ({ ...p, street: e.target.value }))}
                  placeholder="Straße, Hausnummer"
                />
              </Field>

              <Field label="Stadt (optional)">
                <input
                  className={styles.input}
                  value={profile.city}
                  onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))}
                  placeholder="Stadt"
                />
              </Field>
            </div>
          </section>
        )}

        {mode === "guest" && (
          <section className={styles.section}>
            <div className={styles.infoBox}>
              <div className={styles.infoTitle}>Gast-Check-in</div>
              <p className={styles.infoText}>
                Gast bekommt automatisch eine Nummer (z. B. Gast #12). Reset jeden Tag.
                Keine Pflichtdaten erforderlich.
              </p>
            </div>
          </section>
        )}

        {mode === "wedding" && (
          <section className={styles.section}>
            <div className={styles.grid}>
              <Field label="Titel * (z. B. Hochzeit Müller)" error={errors.weddingTitle}>
                <input
                  className={styles.input}
                  value={wedding.title}
                  onChange={(e) => setWedding((w) => ({ ...w, title: e.target.value }))}
                  required
                />
              </Field>

              <Field label="Kontakt Name *" error={errors.weddingContact}>
                <input
                  className={styles.input}
                  value={wedding.contactName}
                  onChange={(e) => setWedding((w) => ({ ...w, contactName: e.target.value }))}
                  required
                />
              </Field>

              <Field label="Telefon *" hint="Nur Zahlen." error={errors.weddingPhone}>
                <input
                  className={styles.input}
                  value={wedding.phone}
                  onChange={(e) => setWedding((w) => ({ ...w, phone: onlyDigits(e.target.value) }))}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="z. B. 015112345678"
                  required
                />
              </Field>

              <Field label="E-Mail (optional)" error={errors.weddingEmail}>
                <input
                  className={styles.input}
                  type="email"
                  value={wedding.email}
                  onChange={(e) => setWedding((w) => ({ ...w, email: e.target.value }))}
                  placeholder="name@domain.de"
                />
              </Field>

              <Field label="Straße (optional)">
                <input
                  className={styles.input}
                  value={wedding.street}
                  onChange={(e) => setWedding((w) => ({ ...w, street: e.target.value }))}
                  placeholder="Straße, Hausnummer"
                />
              </Field>

              <Field label="Stadt (optional)">
                <input
                  className={styles.input}
                  value={wedding.city}
                  onChange={(e) => setWedding((w) => ({ ...w, city: e.target.value }))}
                  placeholder="Stadt"
                />
              </Field>
            </div>

            <div className={styles.payRow}>
              <span className={styles.payLabel}>Zahlung</span>
              <button
                className={`${styles.pillSm} ${wedding.paymentMode === "single" ? styles.pillSmActive : ""}`}
                onClick={() => setWedding((w) => ({ ...w, paymentMode: "single" }))}
                type="button"
              >
                zusammen
              </button>
              <button
                className={`${styles.pillSm} ${wedding.paymentMode === "split" ? styles.pillSmActive : ""}`}
                onClick={() => setWedding((w) => ({ ...w, paymentMode: "split" }))}
                type="button"
              >
                separat
              </button>
            </div>

            <div className={styles.members}>
              <div className={styles.membersHead}>
                <b>Mitglieder *</b>
                <button className={styles.btnSmall} onClick={addMember} type="button">
                  + Mitglied
                </button>
              </div>

              {errors.members && <div className={styles.error}>{errors.members}</div>}

              {members.map((m, i) => (
                <div key={i} className={styles.memberRow}>
                  <div className={styles.memberCol}>
                    <input
                      className={styles.input}
                      value={m.displayName}
                      placeholder={i === 0 ? "Braut / Hauptperson" : "Name"}
                      onChange={(e) => updateMember(i, { displayName: e.target.value })}
                    />
                    {errors[`memberName_${i}`] && <div className={styles.error}>{errors[`memberName_${i}`]}</div>}
                  </div>

                  <input
                    className={styles.input}
                    value={m.phone}
                    placeholder="Telefon (optional)"
                    onChange={(e) => updateMember(i, { phone: onlyDigits(e.target.value) })}
                    inputMode="numeric"
                    pattern="[0-9]*"
                  />

                  {i > 0 && (
                    <button className={styles.danger} onClick={() => removeMember(i)} type="button">
                      Entfernen
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className={styles.section}>
          <Field label="Notiz / Kommentar (optional)">
            <input
              className={styles.input}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="z. B. Allergie, Wunsch, Hinweis..."
            />
          </Field>
        </section>

        <footer className={styles.footer}>
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => nav("/start")} type="button">
            Zurück
          </button>
          <button className={styles.btn} onClick={next} disabled={!isValid} type="button">
            Weiter
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, hint, error, children }) {
  return (
    <label className={styles.field}>
      <span className={styles.labelRow}>
        <span className={styles.label}>{label}</span>
        {hint ? <span className={styles.hintInline}>{hint}</span> : null}
      </span>
      {children}
      {error ? <div className={styles.error}>{error}</div> : null}
    </label>
  );
}
