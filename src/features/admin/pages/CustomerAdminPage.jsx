import { useEffect, useMemo, useState } from "react";
import AdminShell from "../components/AdminShell.jsx";
import Modal from "../components/Modal.jsx";
import styles from "./CustomerAdminPage.module.css";
import { db } from "../../../db/index.js";

/** Helpers */
function safeName(c) {
  const a = String(c.firstName || "").trim();
  const b = String(c.lastName || "").trim();
  const full = `${a} ${b}`.trim();
  return full || c.displayName || "Unbekannt";
}

const onlyDigits = (s) => (s || "").replace(/\D/g, "");

const normalizeInstagram = (value) => {
  let v = (value || "").trim();
  if (v.startsWith("@")) v = v.slice(1);
  v = v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "");
  v = v.split(/[/?#]/)[0];
  return v;
};

const isValidEmail = (email) => {
  const v = (email || "").trim();
  if (!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
};

const isValidInstagramHandle = (handle) => {
  const v = (handle || "").trim();
  if (!v) return true;
  if (v.length < 1 || v.length > 30) return false;
  if (!/^[a-zA-Z0-9._]+$/.test(v)) return false;
  if (v.endsWith(".")) return false;
  if (v.includes("..")) return false;
  return true;
};

/**
 * Optional: Fullname split (best effort)
 */
function splitFullName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export default function CustomerAdminPage() {
  const [customers, setCustomers] = useState([]);
  const [query, setQuery] = useState("");

  // View modal (existing)
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState("profile"); // profile | wedding

  const [note, setNote] = useState("");

  const [profile, setProfile] = useState({
    fullName: "",
    phone: "",
    email: "",
    instagram: "",
    street: "",
    city: "",
    marketingConsent: false,
  });

  const [wedding, setWedding] = useState({
    title: "Hochzeit",
    contactName: "",
    phone: "",
    email: "",
    street: "",
    city: "",
    paymentMode: "single", // single|split
    marketingConsent: false,
  });

  const [members, setMembers] = useState([{ displayName: "Braut", phone: "" }]);

  async function reload() {
    const arr = await db.customers.toArray();
    arr.sort((x, y) => safeName(x).localeCompare(safeName(y)));
    setCustomers(arr);
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const hay = [
        safeName(c),
        c.phone,
        c.email,
        c.instagram,
        c.lastServedByStaffName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [customers, query]);

  async function openCustomer(c) {
    setSelected(c);

    const rows = await db.customer_history
      .where("customerId")
      .equals(c.id)
      .toArray()
      .catch(async () => {
        const all = await db.customer_history.toArray();
        return all.filter((h) => h.customerId === c.id);
      });

    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    setHistory(rows.slice(0, 80));
    setOpen(true);
  }

  function closeView() {
    setOpen(false);
    setSelected(null);
    setHistory([]);
  }

  // ---------- Create modal helpers ----------
  function openCreate() {
    setCreateMode("profile");
    setNote("");
    setProfile({
      fullName: "",
      phone: "",
      email: "",
      instagram: "",
      street: "",
      city: "",
      marketingConsent: false,
    });
    setWedding({
      title: "Hochzeit",
      contactName: "",
      phone: "",
      email: "",
      street: "",
      city: "",
      paymentMode: "single",
      marketingConsent: false,
    });
    setMembers([{ displayName: "Braut", phone: "" }]);
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
  }

  function addMember() {
    setMembers((p) => [...p, { displayName: "", phone: "" }]);
  }
  function updateMember(i, patch) {
    setMembers((p) => p.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }
  function removeMember(i) {
    setMembers((p) => p.filter((_, idx) => idx !== i));
  }

  const createErrors = useMemo(() => {
    const e = {};

    if (createMode === "profile") {
      const fullName = profile.fullName.trim();
      const phone = profile.phone.trim();
      if (fullName.length < 2) e.profileFullName = "Bitte mindestens 2 Zeichen.";
      if (onlyDigits(phone).length < 6) e.profilePhone = "Bitte eine gültige Telefonnummer eingeben (min. 6 Ziffern).";
      if (!isValidEmail(profile.email)) e.profileEmail = "Bitte eine gültige E-Mail eingeben.";
      if (!isValidInstagramHandle(profile.instagram)) e.profileInstagram = "Bitte einen gültigen Instagram-Handle eingeben.";
    }

    if (createMode === "wedding") {
      const title = wedding.title.trim();
      const contact = wedding.contactName.trim();
      const phone = wedding.phone.trim();
      if (title.length < 2) e.weddingTitle = "Bitte mindestens 2 Zeichen.";
      if (contact.length < 2) e.weddingContact = "Bitte mindestens 2 Zeichen.";
      if (onlyDigits(phone).length < 6) e.weddingPhone = "Bitte eine gültige Telefonnummer eingeben (min. 6 Ziffern).";
      if (!isValidEmail(wedding.email)) e.weddingEmail = "Bitte eine gültige E-Mail eingeben.";

      if (!members.length) e.members = "Mindestens 1 Mitglied erforderlich.";
      members.forEach((m, idx) => {
        if ((m.displayName || "").trim().length < 2) e[`memberName_${idx}`] = "Name: mindestens 2 Zeichen.";
      });
    }

    return e;
  }, [createMode, profile, wedding, members]);

  const createValid = useMemo(() => Object.keys(createErrors).length === 0, [createErrors]);

  async function saveNewCustomer() {
    if (!createValid) return;

    const now = new Date().toISOString();

    if (createMode === "profile") {
      const fullName = profile.fullName.trim();
      const { firstName, lastName } = splitFullName(fullName);

      const row = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,

        firstName,
        lastName,
        phone: onlyDigits(profile.phone),
        email: (profile.email || "").trim(),
        instagram: normalizeInstagram(profile.instagram),

        marketingConsent: !!profile.marketingConsent,

        lastVisitAt: "",
        lastServedByStaffId: "",
        lastServedByStaffName: "",

        // optional extras (Dexie erlaubt das)
        displayName: fullName,
        address: {
          street: (profile.street || "").trim(),
          city: (profile.city || "").trim(),
        },
        note: (note || "").trim(),
        kind: "profile",
      };

      await db.customers.put(row);

      // optional: Timeline-Eintrag
      if ((note || "").trim()) {
        await db.customer_history.add({
          id: crypto.randomUUID(),
          customerId: row.id,
          createdAt: now,
          visitId: "",
          areaId: "",
          staffId: "",
          staffName: "",
          type: "admin_note",
          payload: { note: (note || "").trim() },
        });
      }
    }

    if (createMode === "wedding") {
      // Hochzeit/Gruppe wird als "Kunde" (DisplayName = Titel) gespeichert
      const title = wedding.title.trim();

      const row = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,

        // im Kundenstamm: Kontaktperson
        ...splitFullName(wedding.contactName.trim()),
        phone: onlyDigits(wedding.phone),
        email: (wedding.email || "").trim(),
        instagram: "",

        marketingConsent: !!wedding.marketingConsent,

        lastVisitAt: "",
        lastServedByStaffId: "",
        lastServedByStaffName: "",

        // Extras: damit Liste/Detail sinnvoll ist
        displayName: title,
        address: {
          street: (wedding.street || "").trim(),
          city: (wedding.city || "").trim(),
        },
        note: (note || "").trim(),
        kind: "group",
        group: {
          title,
          paymentMode: wedding.paymentMode,
          members: members.map((m) => ({
            displayName: (m.displayName || "").trim(),
            phone: onlyDigits(m.phone || ""),
          })),
        },
      };

      await db.customers.put(row);

      // optional: Timeline-Eintrag
      await db.customer_history.add({
        id: crypto.randomUUID(),
        customerId: row.id,
        createdAt: now,
        visitId: "",
        areaId: "",
        staffId: "",
        staffName: "",
        type: "group_created",
        payload: {
          title,
          paymentMode: wedding.paymentMode,
          membersCount: members.length,
          note: (note || "").trim(),
        },
      });
    }

    await reload();
    setCreateOpen(false);
  }

  return (
    <AdminShell
      title="Kunden"
      subtitle="Suche, Profil-Details und Historie (Customer Timeline)."
      right={
        <div className={styles.rightTools}>
          <div className={styles.searchWrap}>
            <input
              className={styles.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Suchen: Name, Telefon, Instagram, Email …"
            />
          </div>
          <button className={styles.btnPrimary} type="button" onClick={openCreate}>
            + Kunde hinzufügen
          </button>
        </div>
      }
    >
      <div className={styles.card}>
        <div className={styles.head}>
          <div className={styles.title}>Kundenliste</div>
          <div className={styles.sub}>Klick öffnet Detailansicht.</div>
        </div>

        <div className={styles.list}>
          {filtered.map((c) => (
            <button key={c.id} className={styles.row} onClick={() => openCustomer(c)}>
              <div className={styles.rowTitle}>{safeName(c)}</div>
              <div className={styles.rowMeta}>
                {c.phone || "-"} · {c.instagram || "-"} · last staff: {c.lastServedByStaffName || "-"}
              </div>
            </button>
          ))}
          {filtered.length === 0 ? <div className={styles.empty}>Keine Treffer.</div> : null}
        </div>
      </div>

      {/* VIEW MODAL */}
      <Modal
        open={open}
        title={`Kunde: ${selected ? safeName(selected) : ""}`}
        onClose={closeView}
        footer={
          <button className={styles.btnGhost} onClick={closeView} type="button">
            Schließen
          </button>
        }
      >
        <div className={styles.modalGrid}>
          <div className={styles.box}>
            <div className={styles.boxTitle}>Profil</div>
            <div className={styles.kv}>
              <div className={styles.k}>Telefon</div>
              <div className={styles.v}>{selected?.phone || "-"}</div>

              <div className={styles.k}>E-Mail</div>
              <div className={styles.v}>{selected?.email || "-"}</div>

              <div className={styles.k}>Instagram</div>
              <div className={styles.v}>{selected?.instagram || "-"}</div>

              <div className={styles.k}>Marketing</div>
              <div className={styles.v}>{selected?.marketingConsent ? "ja" : "nein"}</div>

              <div className={styles.k}>Letzter Besuch</div>
              <div className={styles.v}>{selected?.lastVisitAt ? String(selected.lastVisitAt).slice(0, 10) : "-"}</div>

              <div className={styles.k}>Letzter Staff</div>
              <div className={styles.v}>{selected?.lastServedByStaffName || "-"}</div>
            </div>
          </div>

          <div className={styles.boxWide}>
            <div className={styles.boxTitle}>Historie</div>
            <div className={styles.boxSub}>Bis zu 80 letzte Einträge (Performance).</div>

            <div className={styles.hist}>
              {history.length === 0 ? (
                <div className={styles.empty2}>Keine Historie vorhanden.</div>
              ) : (
                history.map((h) => (
                  <div key={h.id} className={styles.histRow}>
                    <div className={styles.histTop}>
                      <div className={styles.histTitle}>{h.type || "event"}</div>
                      <div className={styles.histTime}>{String(h.createdAt || "").replace("T", " ").slice(0, 16)}</div>
                    </div>
                    <div className={styles.histMeta}>area: {h.areaId || "-"} · staff: {h.staffName || "-"}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* CREATE MODAL */}
      <Modal
        open={createOpen}
        title="Kunde hinzufügen"
        onClose={closeCreate}
        footer={
          <div className={styles.modalFooterRow}>
            <button className={styles.btnGhost} type="button" onClick={closeCreate}>
              Abbrechen
            </button>
            <button className={styles.btnPrimary} type="button" onClick={saveNewCustomer} disabled={!createValid}>
              Speichern
            </button>
          </div>
        }
      >
        <div className={styles.createTabs} role="tablist" aria-label="Kundentyp">
          <button
            type="button"
            role="tab"
            aria-selected={createMode === "profile"}
            className={`${styles.tabBtn} ${createMode === "profile" ? styles.tabBtnActive : ""}`}
            onClick={() => setCreateMode("profile")}
          >
            Kunde
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={createMode === "wedding"}
            className={`${styles.tabBtn} ${createMode === "wedding" ? styles.tabBtnActive : ""}`}
            onClick={() => setCreateMode("wedding")}
          >
            Hochzeit / Gruppe
          </button>
        </div>

        {createMode === "profile" ? (
          <div className={styles.formGrid}>
            <Field label="Name *" error={createErrors.profileFullName}>
              <input
                className={styles.input}
                value={profile.fullName}
                onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))}
                placeholder="Vor- und Nachname"
              />
            </Field>

            <Field label="Telefon *" hint="Nur Zahlen." error={createErrors.profilePhone}>
              <input
                className={styles.input}
                value={profile.phone}
                onChange={(e) => setProfile((p) => ({ ...p, phone: onlyDigits(e.target.value) }))}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="z. B. 015112345678"
              />
            </Field>

            <Field label="E-Mail (optional)" error={createErrors.profileEmail}>
              <input
                className={styles.input}
                type="email"
                value={profile.email}
                onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                placeholder="name@domain.de"
              />
            </Field>

            <Field label="Instagram (optional)" hint="Nur Handle, z. B. salon.system" error={createErrors.profileInstagram}>
              <input
                className={styles.input}
                value={profile.instagram}
                onChange={(e) => setProfile((p) => ({ ...p, instagram: normalizeInstagram(e.target.value) }))}
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

            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={!!profile.marketingConsent}
                onChange={(e) => setProfile((p) => ({ ...p, marketingConsent: e.target.checked }))}
              />
              <span>Marketing-Einverständnis</span>
            </label>
          </div>
        ) : (
          <div className={styles.formGrid}>
            <Field label="Titel * (z. B. Hochzeit Anna)" error={createErrors.weddingTitle}>
              <input
                className={styles.input}
                value={wedding.title}
                onChange={(e) => setWedding((w) => ({ ...w, title: e.target.value }))}
              />
            </Field>

            <Field label="Kontakt Name *" error={createErrors.weddingContact}>
              <input
                className={styles.input}
                value={wedding.contactName}
                onChange={(e) => setWedding((w) => ({ ...w, contactName: e.target.value }))}
              />
            </Field>

            <Field label="Telefon *" hint="Nur Zahlen." error={createErrors.weddingPhone}>
              <input
                className={styles.input}
                value={wedding.phone}
                onChange={(e) => setWedding((w) => ({ ...w, phone: onlyDigits(e.target.value) }))}
                inputMode="numeric"
                pattern="[0-9]*"
              />
            </Field>

            <Field label="E-Mail (optional)" error={createErrors.weddingEmail}>
              <input
                className={styles.input}
                type="email"
                value={wedding.email}
                onChange={(e) => setWedding((w) => ({ ...w, email: e.target.value }))}
              />
            </Field>

            <Field label="Straße (optional)">
              <input
                className={styles.input}
                value={wedding.street}
                onChange={(e) => setWedding((w) => ({ ...w, street: e.target.value }))}
              />
            </Field>

            <Field label="Stadt (optional)">
              <input
                className={styles.input}
                value={wedding.city}
                onChange={(e) => setWedding((w) => ({ ...w, city: e.target.value }))}
              />
            </Field>

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

              {createErrors.members ? <div className={styles.error}>{createErrors.members}</div> : null}

              {members.map((m, i) => (
                <div key={i} className={styles.memberRow}>
                  <div className={styles.memberCol}>
                    <input
                      className={styles.input}
                      value={m.displayName}
                      placeholder={i === 0 ? "Braut / Hauptperson" : "Name"}
                      onChange={(e) => updateMember(i, { displayName: e.target.value })}
                    />
                    {createErrors[`memberName_${i}`] ? <div className={styles.error}>{createErrors[`memberName_${i}`]}</div> : null}
                  </div>

                  <input
                    className={styles.input}
                    value={m.phone}
                    placeholder="Telefon (optional)"
                    onChange={(e) => updateMember(i, { phone: onlyDigits(e.target.value) })}
                    inputMode="numeric"
                    pattern="[0-9]*"
                  />

                  {i > 0 ? (
                    <button className={styles.danger} onClick={() => removeMember(i)} type="button">
                      Entfernen
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={!!wedding.marketingConsent}
                onChange={(e) => setWedding((w) => ({ ...w, marketingConsent: e.target.checked }))}
              />
              <span>Marketing-Einverständnis (Kontakt)</span>
            </label>
          </div>
        )}

        <div className={styles.noteRow}>
          <Field label="Notiz / Kommentar (optional)">
            <input
              className={styles.input}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="z. B. Allergie, Wunsch, Hinweis…"
            />
          </Field>
        </div>
      </Modal>
    </AdminShell>
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
