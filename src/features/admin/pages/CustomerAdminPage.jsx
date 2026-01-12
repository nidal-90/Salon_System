// src/features/admin/pages/CustomerAdminPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AdminShell from "../components/AdminShell.jsx";
import Modal from "../components/Modal.jsx";
import styles from "./CustomerAdminPage.module.css";
import { db } from "../../../db/index.js";

/* ---------- Helpers ---------- */
function safeCustomer(c) {
  return c && typeof c === "object" ? c : null;
}

function safeName(c) {
  const x = safeCustomer(c);
  if (!x) return "Unbekannt";
  const a = String(x.firstName || "").trim();
  const b = String(x.lastName || "").trim();
  const full = `${a} ${b}`.trim();
  return full || String(x.displayName || "").trim() || "Unbekannt";
}

const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

function normalizeInstagram(value) {
  let v = String(value || "").trim();
  if (v.startsWith("@")) v = v.slice(1);
  v = v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "");
  v = v.split(/[/?#]/)[0];
  return v;
}

function isValidEmail(email) {
  const v = String(email || "").trim();
  if (!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isValidInstagramHandle(handle) {
  const v = String(handle || "").trim();
  if (!v) return true;
  if (v.length < 1 || v.length > 30) return false;
  if (!/^[a-zA-Z0-9._]+$/.test(v)) return false;
  if (v.endsWith(".")) return false;
  if (v.includes("..")) return false;
  return true;
}

function splitFullName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function fmtDateTime(iso) {
  const s = String(iso || "");
  if (!s) return "-";
  // 2026-01-12T19:52:00.000Z -> 2026-01-12 19:52
  return s.replace("T", " ").slice(0, 16);
}

function isGroup(c) {
  return String(c?.kind || "") === "group" || !!c?.group;
}

/* ---------- Page ---------- */
export default function CustomerAdminPage() {
  const nav = useNavigate();

  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState("customers"); // customers | groups
  const [q, setQ] = useState("");

  // view modal
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);

  // edit modal (same view modal, editable)
  const [editMode, setEditMode] = useState(false);

  // create modal
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
    paymentMode: "single",
    marketingConsent: false,
  });

  const [members, setMembers] = useState([{ displayName: "Braut", phone: "" }]);

  // quick-create member profile modal
  const [memberCreateOpen, setMemberCreateOpen] = useState(false);
  const [memberDraft, setMemberDraft] = useState({ displayName: "", phone: "", email: "", instagram: "" });

  async function reload() {
    const arr = await db.customers.toArray().catch(() => []);
    // sanitize nulls
    const clean = arr.filter(Boolean);
    clean.sort((a, b) => safeName(a).localeCompare(safeName(b)));
    setRows(clean);
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    const base = tab === "groups" ? rows.filter(isGroup) : rows.filter((c) => !isGroup(c));

    if (!text) return base;

    return base.filter((c) => {
      const hay = [
        safeName(c),
        c.phone,
        c.email,
        c.instagram,
        c.lastServedByStaffName,
        c.group?.title,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(text);
    });
  }, [rows, q, tab]);

  async function openCustomer(c) {
    const x = safeCustomer(c);
    if (!x) return;

    setSelected(x);
    setEditMode(false);

    const rows = await db.customer_history
      .where("customerId")
      .equals(x.id)
      .toArray()
      .catch(async () => {
        const all = await db.customer_history.toArray().catch(() => []);
        return all.filter((h) => h?.customerId === x.id);
      });

    rows.sort((a, b) => (String(a.createdAt || "") < String(b.createdAt || "") ? 1 : -1));
    setHistory(rows.slice(0, 120));
    setOpen(true);
  }

  function closeView() {
    setOpen(false);
    setSelected(null);
    setHistory([]);
    setEditMode(false);
  }

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
      if (onlyDigits(phone).length < 6) e.profilePhone = "Bitte gültige Telefonnummer (min. 6 Ziffern).";
      if (!isValidEmail(profile.email)) e.profileEmail = "Bitte gültige E-Mail.";
      if (!isValidInstagramHandle(profile.instagram)) e.profileInstagram = "Bitte gültiger Instagram-Handle.";
    }

    if (createMode === "wedding") {
      const title = wedding.title.trim();
      const contact = wedding.contactName.trim();
      const phone = wedding.phone.trim();
      if (title.length < 2) e.weddingTitle = "Bitte mindestens 2 Zeichen.";
      if (contact.length < 2) e.weddingContact = "Bitte mindestens 2 Zeichen.";
      if (onlyDigits(phone).length < 6) e.weddingPhone = "Bitte gültige Telefonnummer (min. 6 Ziffern).";
      if (!isValidEmail(wedding.email)) e.weddingEmail = "Bitte gültige E-Mail.";
      if (!members.length) e.members = "Mindestens 1 Mitglied erforderlich.";

      members.forEach((m, idx) => {
        if (String(m.displayName || "").trim().length < 2) e[`memberName_${idx}`] = "Name: mindestens 2 Zeichen.";
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
        email: String(profile.email || "").trim(),
        instagram: normalizeInstagram(profile.instagram),
        marketingConsent: !!profile.marketingConsent,
        lastVisitAt: "",
        lastServedByStaffId: "",
        lastServedByStaffName: "",
        displayName: fullName,
        address: { street: String(profile.street || "").trim(), city: String(profile.city || "").trim() },
        note: String(note || "").trim(),
        kind: "profile",
      };

      await db.customers.put(row);

      if (String(note || "").trim()) {
        await db.customer_history.add({
          id: crypto.randomUUID(),
          customerId: row.id,
          createdAt: now,
          visitId: "",
          areaId: "",
          staffId: "",
          staffName: "",
          type: "admin_note",
          payload: { note: String(note || "").trim() },
        });
      }
    }

    if (createMode === "wedding") {
      const title = wedding.title.trim();

      const row = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        ...splitFullName(wedding.contactName.trim()),
        phone: onlyDigits(wedding.phone),
        email: String(wedding.email || "").trim(),
        instagram: "",
        marketingConsent: !!wedding.marketingConsent,
        lastVisitAt: "",
        lastServedByStaffId: "",
        lastServedByStaffName: "",
        displayName: title,
        address: { street: String(wedding.street || "").trim(), city: String(wedding.city || "").trim() },
        note: String(note || "").trim(),
        kind: "group",
        group: {
          title,
          paymentMode: wedding.paymentMode,
          members: members.map((m) => ({
            displayName: String(m.displayName || "").trim(),
            phone: onlyDigits(m.phone || ""),
          })),
        },
      };

      await db.customers.put(row);

      await db.customer_history.add({
        id: crypto.randomUUID(),
        customerId: row.id,
        createdAt: now,
        visitId: "",
        areaId: "",
        staffId: "",
        staffName: "",
        type: "group_created",
        payload: { title, paymentMode: wedding.paymentMode, membersCount: members.length, note: String(note || "").trim() },
      });
    }

    await reload();
    setCreateOpen(false);
  }

  async function deleteCustomer(id) {
    if (!id) return;
    // optional: hier könntest du prüfen ob Visits existieren, sonst löschen
    await db.customers.delete(id);
    // history cleanup
    const hist = await db.customer_history.where("customerId").equals(id).toArray().catch(() => []);
    await Promise.all(hist.map((h) => db.customer_history.delete(h.id)));
    await reload();
    closeView();
  }

  async function saveEdits() {
    if (!selected?.id) return;
    const now = new Date().toISOString();

    // selected enthält bei groups: group + address etc.
    const patch = {
      ...selected,
      updatedAt: now,
      phone: onlyDigits(selected.phone || ""),
      email: String(selected.email || "").trim(),
      instagram: normalizeInstagram(selected.instagram || ""),
    };

    await db.customers.put(patch);
    await reload();
    setEditMode(false);
  }

  function openMemberProfileCreate(m) {
    const name = String(m?.displayName || "").trim();
    setMemberDraft({
      displayName: name,
      phone: onlyDigits(m?.phone || ""),
      email: "",
      instagram: "",
    });
    setMemberCreateOpen(true);
  }

  function closeMemberProfileCreate() {
    setMemberCreateOpen(false);
  }

  const memberCreateValid = useMemo(() => {
    const nameOk = String(memberDraft.displayName || "").trim().length >= 2;
    const phoneOk = onlyDigits(memberDraft.phone || "").length >= 6; // du wolltest schnell + sicher
    const emailOk = isValidEmail(memberDraft.email);
    const instaOk = isValidInstagramHandle(memberDraft.instagram);
    return nameOk && phoneOk && emailOk && instaOk;
  }, [memberDraft]);

  async function createProfileFromMember() {
    if (!memberCreateValid) return;
    const now = new Date().toISOString();
    const fullName = String(memberDraft.displayName || "").trim();
    const { firstName, lastName } = splitFullName(fullName);

    const row = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      firstName,
      lastName,
      phone: onlyDigits(memberDraft.phone || ""),
      email: String(memberDraft.email || "").trim(),
      instagram: normalizeInstagram(memberDraft.instagram),
      marketingConsent: 0,
      lastVisitAt: "",
      lastServedByStaffId: "",
      lastServedByStaffName: "",
      displayName: fullName,
      address: { street: "", city: "" },
      note: "",
      kind: "profile",
    };

    await db.customers.put(row);
    await db.customer_history.add({
      id: crypto.randomUUID(),
      customerId: row.id,
      createdAt: now,
      visitId: "",
      areaId: "",
      staffId: "",
      staffName: "",
      type: "profile_created_from_group_member",
      payload: { fromGroupId: selected?.id || "" },
    });

    setMemberCreateOpen(false);
    await reload();
  }

  return (
    <AdminShell
      title="Kunden"
      subtitle="Kunden & Gruppen getrennt, Details bearbeitbar, Gruppen-Mitglieder optional als eigene Profile."
      right={
        <div className={styles.rightTools}>
          <div className={styles.searchBox}>
            <input
              className={styles.input}
              placeholder={tab === "groups" ? "Suche Gruppen…" : "Suche Kunden…"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tabBtn} ${tab === "customers" ? styles.tabBtnActive : ""}`}
              onClick={() => setTab("customers")}
            >
              Kunden
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${tab === "groups" ? styles.tabBtnActive : ""}`}
              onClick={() => setTab("groups")}
            >
              Gruppen
            </button>
          </div>

          <button className={styles.primaryBtn} type="button" onClick={openCreate}>
            + Neu
          </button>
        </div>
      }
    >
      <div className={styles.wrap}>
        <div className={styles.card}>
          <div className={styles.headerRow}>
            <div>
              <h2 className={styles.title}>{tab === "groups" ? "Gruppen" : "Kunden"}</h2>
              <p className={styles.sub}>
                Klick auf eine Zeile öffnet Details. In Details kannst du bearbeiten und löschen.
              </p>
            </div>

            {/* WICHTIG: Zurück-Button (du willst überall) */}
            <button type="button" className={styles.backBtn} onClick={() => nav("/admin")} aria-label="Zurück">
              ← Admin
            </button>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Telefon</th>
                  <th>E-Mail</th>
                  <th>Instagram</th>
                  <th>Letzter Staff</th>
                  <th className={styles.right}>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={styles.muted}>
                      Keine Treffer.
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => (
                    <tr key={c.id} className={styles.row} onClick={() => openCustomer(c)}>
                      <td className={styles.nameCell}>{safeName(c)}</td>
                      <td>{c.phone || "-"}</td>
                      <td className={styles.muted}>{c.email || "-"}</td>
                      <td className={styles.muted}>{c.instagram || "-"}</td>
                      <td className={styles.muted}>{c.lastServedByStaffName || "-"}</td>
                      <td className={styles.right} onClick={(e) => e.stopPropagation()}>
                        <button className={styles.dangerBtn} onClick={() => deleteCustomer(c.id)} type="button">
                          Löschen
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className={styles.hint}>
              Tipp: Gruppen öffnen → Mitglieder → “Profil erstellen” erzeugt optional ein echtes Kundenprofil.
            </div>
          </div>
        </div>
      </div>

      {/* DETAILS MODAL */}
      <Modal
        open={open}
        title={selected ? (isGroup(selected) ? `Gruppe: ${safeName(selected)}` : `Kunde: ${safeName(selected)}`) : "Details"}
        onClose={closeView}
        footer={
          <div className={styles.modalFooter}>
            <button className={styles.ghostBtn} onClick={closeView} type="button">
              Schließen
            </button>
            <button className={styles.dangerBtn} onClick={() => deleteCustomer(selected?.id)} type="button">
              Löschen
            </button>
            {editMode ? (
              <button className={styles.primaryBtn} onClick={saveEdits} type="button">
                Speichern
              </button>
            ) : (
              <button className={styles.secondaryBtn} onClick={() => setEditMode(true)} type="button">
                Bearbeiten
              </button>
            )}
          </div>
        }
      >
        <div className={styles.modalGrid}>
          <div className={styles.panel}>
            <div className={styles.panelTitle}>Stammdaten</div>

            <Field label={isGroup(selected) ? "Titel" : "Name"}>
              <input
                className={styles.fieldInput}
                value={selected?.displayName || ""}
                disabled={!editMode}
                onChange={(e) => setSelected((p) => ({ ...p, displayName: e.target.value }))}
              />
            </Field>

            {isGroup(selected) ? (
              <Field label="Kontakt Name">
                <input
                  className={styles.fieldInput}
                  value={`${selected?.firstName || ""} ${selected?.lastName || ""}`.trim()}
                  disabled={!editMode}
                  onChange={(e) => {
                    const { firstName, lastName } = splitFullName(e.target.value);
                    setSelected((p) => ({ ...p, firstName, lastName }));
                  }}
                />
              </Field>
            ) : (
              <Field label="Vorname / Nachname">
                <input
                  className={styles.fieldInput}
                  value={`${selected?.firstName || ""} ${selected?.lastName || ""}`.trim()}
                  disabled={!editMode}
                  onChange={(e) => {
                    const { firstName, lastName } = splitFullName(e.target.value);
                    setSelected((p) => ({ ...p, firstName, lastName, displayName: e.target.value }));
                  }}
                />
              </Field>
            )}

            <div className={styles.twoCol}>
              <Field label="Telefon">
                <input
                  className={styles.fieldInput}
                  value={selected?.phone || ""}
                  disabled={!editMode}
                  onChange={(e) => setSelected((p) => ({ ...p, phone: onlyDigits(e.target.value) }))}
                />
              </Field>

              <Field label="E-Mail">
                <input
                  className={styles.fieldInput}
                  value={selected?.email || ""}
                  disabled={!editMode}
                  onChange={(e) => setSelected((p) => ({ ...p, email: e.target.value }))}
                />
              </Field>
            </div>

            <Field label="Instagram">
              <input
                className={styles.fieldInput}
                value={selected?.instagram || ""}
                disabled={!editMode}
                onChange={(e) => setSelected((p) => ({ ...p, instagram: normalizeInstagram(e.target.value) }))}
              />
            </Field>

            <Field label="Notiz">
              <input
                className={styles.fieldInput}
                value={selected?.note || ""}
                disabled={!editMode}
                onChange={(e) => setSelected((p) => ({ ...p, note: e.target.value }))}
              />
            </Field>

            {isGroup(selected) ? (
              <div className={styles.groupBox}>
                <div className={styles.groupHead}>
                  <div>
                    <div className={styles.groupTitle}>Mitglieder</div>
                    <div className={styles.groupSub}>Buttons sind immer sichtbar (Profil erstellen / Entfernen).</div>
                  </div>
                </div>

                <div className={styles.memberList}>
                  {(selected?.group?.members || []).map((m, idx) => (
                    <div key={idx} className={styles.memberRow}>
                      <input
                        className={styles.memberInput}
                        value={String(m.displayName || "")}
                        disabled={!editMode}
                        placeholder="Name"
                        onChange={(e) => {
                          const next = [...(selected.group.members || [])];
                          next[idx] = { ...next[idx], displayName: e.target.value };
                          setSelected((p) => ({ ...p, group: { ...p.group, members: next } }));
                        }}
                      />
                      <input
                        className={styles.memberInput}
                        value={String(m.phone || "")}
                        disabled={!editMode}
                        placeholder="Telefon"
                        onChange={(e) => {
                          const next = [...(selected.group.members || [])];
                          next[idx] = { ...next[idx], phone: onlyDigits(e.target.value) };
                          setSelected((p) => ({ ...p, group: { ...p.group, members: next } }));
                        }}
                      />

                      <div className={styles.memberActions}>
                        <button
                          type="button"
                          className={styles.memberBtn}
                          onClick={() => openMemberProfileCreate(m)}
                          title="Aus Mitglied Kundenprofil erstellen"
                        >
                          Profil erstellen
                        </button>

                        {editMode ? (
                          <button
                            type="button"
                            className={styles.memberDanger}
                            onClick={() => {
                              const next = [...(selected.group.members || [])].filter((_, i) => i !== idx);
                              setSelected((p) => ({ ...p, group: { ...p.group, members: next } }));
                            }}
                            title="Mitglied entfernen"
                          >
                            Entfernen
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>

                {editMode ? (
                  <button
                    type="button"
                    className={styles.addMemberBtn}
                    onClick={() => {
                      const next = [...(selected.group.members || []), { displayName: "", phone: "" }];
                      setSelected((p) => ({ ...p, group: { ...p.group, members: next } }));
                    }}
                  >
                    + Mitglied hinzufügen
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className={styles.panel}>
            <div className={styles.panelTitle}>Historie</div>
            <div className={styles.panelSub}>Bis zu 120 letzte Einträge.</div>

            <div className={styles.hist}>
              {history.length === 0 ? (
                <div className={styles.empty}>Keine Historie vorhanden.</div>
              ) : (
                history.map((h) => (
                  <div key={h.id} className={styles.histRow}>
                    <div className={styles.histTop}>
                      <div className={styles.histTitle}>{h.type || "event"}</div>
                      <div className={styles.histTime}>{fmtDateTime(h.createdAt)}</div>
                    </div>
                    <div className={styles.histMeta}>
                      area: {h.areaId || "-"} · staff: {h.staffName || "-"}
                    </div>
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
        title="Neu anlegen"
        onClose={closeCreate}
        footer={
          <div className={styles.modalFooter}>
            <button className={styles.ghostBtn} type="button" onClick={closeCreate}>
              Abbrechen
            </button>
            <button className={styles.primaryBtn} type="button" onClick={saveNewCustomer} disabled={!createValid}>
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
            className={`${styles.tabBtn2} ${createMode === "profile" ? styles.tabBtn2Active : ""}`}
            onClick={() => setCreateMode("profile")}
          >
            Kunde
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={createMode === "wedding"}
            className={`${styles.tabBtn2} ${createMode === "wedding" ? styles.tabBtn2Active : ""}`}
            onClick={() => setCreateMode("wedding")}
          >
            Hochzeit / Gruppe
          </button>
        </div>

        {createMode === "profile" ? (
          <div className={styles.formGrid}>
            <Field label="Name *" error={createErrors.profileFullName}>
              <input
                className={styles.fieldInput}
                value={profile.fullName}
                onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))}
                placeholder="Vor- und Nachname"
              />
            </Field>

            <Field label="Telefon *" hint="Nur Zahlen" error={createErrors.profilePhone}>
              <input
                className={styles.fieldInput}
                value={profile.phone}
                onChange={(e) => setProfile((p) => ({ ...p, phone: onlyDigits(e.target.value) }))}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="z. B. 015112345678"
              />
            </Field>

            <Field label="E-Mail (optional)" error={createErrors.profileEmail}>
              <input
                className={styles.fieldInput}
                type="email"
                value={profile.email}
                onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                placeholder="name@domain.de"
              />
            </Field>

            <Field label="Instagram (optional)" hint="Handle" error={createErrors.profileInstagram}>
              <input
                className={styles.fieldInput}
                value={profile.instagram}
                onChange={(e) => setProfile((p) => ({ ...p, instagram: normalizeInstagram(e.target.value) }))}
                placeholder="z. B. salon.system"
              />
            </Field>

            <Field label="Straße (optional)">
              <input
                className={styles.fieldInput}
                value={profile.street}
                onChange={(e) => setProfile((p) => ({ ...p, street: e.target.value }))}
                placeholder="Straße, Hausnummer"
              />
            </Field>

            <Field label="Stadt (optional)">
              <input
                className={styles.fieldInput}
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

            <Field label="Notiz (optional)">
              <input
                className={styles.fieldInput}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="z. B. Allergie, Wunsch…"
              />
            </Field>
          </div>
        ) : (
          <div className={styles.formGrid}>
            <Field label="Titel * (z. B. Hochzeit Anna)" error={createErrors.weddingTitle}>
              <input className={styles.fieldInput} value={wedding.title} onChange={(e) => setWedding((w) => ({ ...w, title: e.target.value }))} />
            </Field>

            <Field label="Kontakt Name *" error={createErrors.weddingContact}>
              <input className={styles.fieldInput} value={wedding.contactName} onChange={(e) => setWedding((w) => ({ ...w, contactName: e.target.value }))} />
            </Field>

            <Field label="Telefon *" hint="Nur Zahlen" error={createErrors.weddingPhone}>
              <input
                className={styles.fieldInput}
                value={wedding.phone}
                onChange={(e) => setWedding((w) => ({ ...w, phone: onlyDigits(e.target.value) }))}
                inputMode="numeric"
                pattern="[0-9]*"
              />
            </Field>

            <Field label="E-Mail (optional)" error={createErrors.weddingEmail}>
              <input className={styles.fieldInput} type="email" value={wedding.email} onChange={(e) => setWedding((w) => ({ ...w, email: e.target.value }))} />
            </Field>

            <Field label="Straße (optional)">
              <input className={styles.fieldInput} value={wedding.street} onChange={(e) => setWedding((w) => ({ ...w, street: e.target.value }))} />
            </Field>

            <Field label="Stadt (optional)">
              <input className={styles.fieldInput} value={wedding.city} onChange={(e) => setWedding((w) => ({ ...w, city: e.target.value }))} />
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

            <div className={styles.membersBox}>
              <div className={styles.membersHead}>
                <b>Mitglieder *</b>
                <button className={styles.smallBtn} onClick={addMember} type="button">
                  + Mitglied
                </button>
              </div>

              {createErrors.members ? <div className={styles.error}>{createErrors.members}</div> : null}

              {members.map((m, i) => (
                <div key={i} className={styles.memberRowCreate}>
                  <div className={styles.memberCol}>
                    <input
                      className={styles.fieldInput}
                      value={m.displayName}
                      placeholder={i === 0 ? "Braut / Hauptperson" : "Name"}
                      onChange={(e) => updateMember(i, { displayName: e.target.value })}
                    />
                    {createErrors[`memberName_${i}`] ? <div className={styles.error}>{createErrors[`memberName_${i}`]}</div> : null}
                  </div>

                  <input
                    className={styles.fieldInput}
                    value={m.phone}
                    placeholder="Telefon (optional)"
                    onChange={(e) => updateMember(i, { phone: onlyDigits(e.target.value) })}
                    inputMode="numeric"
                    pattern="[0-9]*"
                  />

                  <div className={styles.memberActionsCreate}>
                    <button type="button" className={styles.memberBtn} onClick={() => openMemberProfileCreate(m)}>
                      Profil erstellen
                    </button>
                    {i > 0 ? (
                      <button className={styles.memberDanger} onClick={() => removeMember(i)} type="button">
                        Entfernen
                      </button>
                    ) : (
                      <div className={styles.memberSpacer} />
                    )}
                  </div>
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

            <Field label="Notiz (optional)">
              <input className={styles.fieldInput} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Hinweis…" />
            </Field>
          </div>
        )}
      </Modal>

      {/* MEMBER QUICK PROFILE MODAL */}
      <Modal
        open={memberCreateOpen}
        title="Profil aus Mitglied erstellen"
        onClose={closeMemberProfileCreate}
        footer={
          <div className={styles.modalFooter}>
            <button className={styles.ghostBtn} type="button" onClick={closeMemberProfileCreate}>
              Abbrechen
            </button>
            <button className={styles.primaryBtn} type="button" onClick={createProfileFromMember} disabled={!memberCreateValid}>
              Profil erstellen
            </button>
          </div>
        }
      >
        <div className={styles.formGrid}>
          <Field label="Name *">
            <input
              className={styles.fieldInput}
              value={memberDraft.displayName}
              onChange={(e) => setMemberDraft((p) => ({ ...p, displayName: e.target.value }))}
            />
          </Field>
          <Field label="Telefon *">
            <input
              className={styles.fieldInput}
              value={memberDraft.phone}
              onChange={(e) => setMemberDraft((p) => ({ ...p, phone: onlyDigits(e.target.value) }))}
            />
          </Field>
          <Field label="E-Mail (optional)">
            <input
              className={styles.fieldInput}
              value={memberDraft.email}
              onChange={(e) => setMemberDraft((p) => ({ ...p, email: e.target.value }))}
            />
          </Field>
          <Field label="Instagram (optional)">
            <input
              className={styles.fieldInput}
              value={memberDraft.instagram}
              onChange={(e) => setMemberDraft((p) => ({ ...p, instagram: normalizeInstagram(e.target.value) }))}
            />
          </Field>
          {!memberCreateValid ? (
            <div className={styles.inlineWarn}>
              Name min. 2 Zeichen, Telefon min. 6 Ziffern. E-Mail/Instagram optional aber wenn gefüllt → gültig.
            </div>
          ) : null}
        </div>
      </Modal>
    </AdminShell>
  );
}

/* ---------- Small reusable field ---------- */
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
