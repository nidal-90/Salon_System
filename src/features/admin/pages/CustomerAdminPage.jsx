// src/features/admin/pages/CustomerAdminPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AdminShell from "../components/AdminShell.jsx";
import Modal from "../components/Modal.jsx";
import styles from "./CustomerAdminPage.module.css";
import { db } from "../../../db/index.js";

/** ---------- Helpers ---------- */
function safeName(c) {
  if (!c) return "Unbekannt";
  const a = String(c.firstName || "").trim();
  const b = String(c.lastName || "").trim();
  const full = `${a} ${b}`.trim();
  return full || String(c.displayName || "").trim() || "Unbekannt";
}

function groupTitle(c) {
  if (!c) return "Gruppe";
  const t =
    String(c.group?.title || "").trim() ||
    String(c.displayName || "").trim() ||
    String(c.title || "").trim();
  return t || "Gruppe";
}

const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

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

function splitFullName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function fmtDateTime(iso) {
  const s = String(iso || "");
  if (!s) return "-";
  return s.replace("T", " ").slice(0, 16);
}

async function loadHistory(customerId, limit = 120) {
  if (!customerId) return [];
  const rows = await db.customer_history
    .where("customerId")
    .equals(customerId)
    .toArray()
    .catch(async () => {
      const all = await db.customer_history.toArray();
      return all.filter((h) => h.customerId === customerId);
    });

  rows.sort((a, b) => (String(a.createdAt) < String(b.createdAt) ? 1 : -1));
  return rows.slice(0, limit);
}

export default function CustomerAdminPage() {
  const nav = useNavigate();

  const [customers, setCustomers] = useState([]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("customers"); // customers | groups

  // View/Edit modal
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("view"); // view | edit
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState("profile"); // profile | group

  // Create fields
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

  const [group, setGroup] = useState({
    title: "Hochzeit",
    contactName: "",
    phone: "",
    email: "",
    instagram: "",
    street: "",
    city: "",
    paymentMode: "single", // single|split
    marketingConsent: false,
    note: "",
  });

  const [members, setMembers] = useState([{ displayName: "Braut", phone: "" }]);

  // Edit fields (für selected)
  const [editRow, setEditRow] = useState(null);

  async function reload() {
    const arr = await db.customers.toArray().catch(() => []);
    const clean = (arr || []).filter(Boolean);
    clean.sort((x, y) => safeName(x).localeCompare(safeName(y)));
    setCustomers(clean);
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = customers.filter(Boolean);

    const wantGroups = tab === "groups";
    const rows = base.filter((c) => {
      const kind = String(c.kind || "");
      const isGroup = kind === "group" || !!c.group;
      return wantGroups ? isGroup : !isGroup;
    });

    if (!q) return rows;

    return rows.filter((c) => {
      const hay = [
        wantGroups ? groupTitle(c) : safeName(c),
        c.phone,
        c.email,
        c.instagram,
        c.lastServedByStaffName,
        c.group?.title,
        c.group?.paymentMode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [customers, query, tab]);

  /** ---------- Open modal ---------- */
  async function openCustomer(c) {
    if (!c) return;

    setSelected(c);
    setMode("view");

    const rows = await loadHistory(c.id, 120);
    setHistory(rows);

    setEditRow(structuredCloneForEdit(c));
    setOpen(true);
  }

  function structuredCloneForEdit(c) {
    return {
      id: c.id,
      kind: c.kind || (c.group ? "group" : "profile"),
      displayName: c.displayName || "",
      firstName: c.firstName || "",
      lastName: c.lastName || "",
      phone: c.phone || "",
      email: c.email || "",
      instagram: c.instagram || "",
      marketingConsent: !!c.marketingConsent,
      address: {
        street: c.address?.street || "",
        city: c.address?.city || "",
      },
      note: c.note || "",
      group: c.group
        ? {
            title: c.group?.title || c.displayName || "",
            paymentMode: c.group?.paymentMode || "single",
            members: Array.isArray(c.group?.members)
              ? c.group.members.map((m) => ({ ...m }))
              : [],
          }
        : null,
    };
  }

  function closeView() {
    setOpen(false);
    setSelected(null);
    setHistory([]);
    setMode("view");
    setEditRow(null);
  }

  /** ---------- Create modal ---------- */
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
    setGroup({
      title: "Hochzeit",
      contactName: "",
      phone: "",
      email: "",
      instagram: "",
      street: "",
      city: "",
      paymentMode: "single",
      marketingConsent: false,
      note: "",
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
      if (onlyDigits(phone).length < 6)
        e.profilePhone = "Bitte eine gültige Telefonnummer eingeben (min. 6 Ziffern).";
      if (!isValidEmail(profile.email)) e.profileEmail = "Bitte eine gültige E-Mail eingeben.";
      if (!isValidInstagramHandle(profile.instagram))
        e.profileInstagram = "Bitte einen gültigen Instagram-Handle eingeben.";
    }

    if (createMode === "group") {
      const title = group.title.trim();
      const contact = group.contactName.trim();
      const phone = group.phone.trim();
      if (title.length < 2) e.groupTitle = "Bitte mindestens 2 Zeichen.";
      if (contact.length < 2) e.groupContact = "Bitte mindestens 2 Zeichen.";
      if (onlyDigits(phone).length < 6)
        e.groupPhone = "Bitte eine gültige Telefonnummer eingeben (min. 6 Ziffern).";
      if (!isValidEmail(group.email)) e.groupEmail = "Bitte eine gültige E-Mail eingeben.";

      if (!members.length) e.members = "Mindestens 1 Mitglied erforderlich.";
      members.forEach((m, idx) => {
        if ((m.displayName || "").trim().length < 2)
          e[`memberName_${idx}`] = "Name: mindestens 2 Zeichen.";
      });
    }

    return e;
  }, [createMode, profile, group, members]);

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
        displayName: fullName,
        address: {
          street: (profile.street || "").trim(),
          city: (profile.city || "").trim(),
        },
        note: (note || "").trim(),
        kind: "profile",
      };

      await db.customers.put(row);

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

    if (createMode === "group") {
      const title = group.title.trim();
      const contactName = group.contactName.trim();

      const row = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        ...splitFullName(contactName),
        phone: onlyDigits(group.phone),
        email: (group.email || "").trim(),
        instagram: normalizeInstagram(group.instagram),
        marketingConsent: !!group.marketingConsent,
        lastVisitAt: "",
        lastServedByStaffId: "",
        lastServedByStaffName: "",
        displayName: title,
        address: {
          street: (group.street || "").trim(),
          city: (group.city || "").trim(),
        },
        note: (note || "").trim(),
        kind: "group",
        group: {
          title,
          paymentMode: group.paymentMode,
          members: members.map((m) => ({
            displayName: (m.displayName || "").trim(),
            phone: onlyDigits(m.phone || ""),
            customerId: m.customerId || "",
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
        payload: {
          title,
          paymentMode: group.paymentMode,
          membersCount: members.length,
          note: (note || "").trim(),
        },
      });
    }

    await reload();
    setCreateOpen(false);
  }

  /** ---------- Edit/Save/Delete ---------- */
  async function saveEdit() {
    if (!editRow?.id) return;

    const now = new Date().toISOString();
    const patch = {
      updatedAt: now,
      firstName: String(editRow.firstName || "").trim(),
      lastName: String(editRow.lastName || "").trim(),
      phone: onlyDigits(editRow.phone),
      email: String(editRow.email || "").trim(),
      instagram: normalizeInstagram(editRow.instagram),
      marketingConsent: !!editRow.marketingConsent,
      address: {
        street: String(editRow.address?.street || "").trim(),
        city: String(editRow.address?.city || "").trim(),
      },
      note: String(editRow.note || "").trim(),
    };

    if (editRow.kind === "group") {
      const title = String(editRow.group?.title || editRow.displayName || "").trim();
      patch.displayName = title;
      patch.kind = "group";
      patch.group = {
        title,
        paymentMode: editRow.group?.paymentMode === "split" ? "split" : "single",
        members: Array.isArray(editRow.group?.members)
          ? editRow.group.members.map((m) => ({
              displayName: String(m.displayName || "").trim(),
              phone: onlyDigits(m.phone || ""),
              customerId: String(m.customerId || ""),
            }))
          : [],
      };
    } else {
      const dn = String(editRow.displayName || "").trim() || safeName(editRow);
      patch.displayName = dn;
      patch.kind = "profile";
      patch.group = undefined;
    }

    await db.customers.update(editRow.id, patch);

    await db.customer_history.add({
      id: crypto.randomUUID(),
      customerId: editRow.id,
      createdAt: now,
      visitId: "",
      areaId: "",
      staffId: "",
      staffName: "",
      type: editRow.kind === "group" ? "group_updated" : "customer_updated",
      payload: {},
    });

    await reload();

    const refreshed = await db.customers.get(editRow.id);
    setSelected(refreshed || null);
    setEditRow(refreshed ? structuredCloneForEdit(refreshed) : null);
    setHistory(await loadHistory(editRow.id, 120));
    setMode("view");
  }

  async function deleteSelected() {
    if (!selected?.id) return;
    const ok = confirm("Wirklich löschen? (Kunde/Gruppe + Historie)");
    if (!ok) return;

    const h = await db.customer_history
      .where("customerId")
      .equals(selected.id)
      .toArray()
      .catch(() => []);
    await Promise.all(h.map((x) => db.customer_history.delete(x.id)));

    await db.customers.delete(selected.id);
    await reload();
    closeView();
  }

  /** ---------- Member profile creation (group) ---------- */
  async function createProfileFromMember(memberIndex) {
    if (!editRow?.id || editRow.kind !== "group") return;

    const mem = editRow.group?.members?.[memberIndex];
    if (!mem) return;
    if (mem.customerId) return;

    const name = String(mem.displayName || "").trim();
    if (name.length < 2) {
      alert("Bitte zuerst den Namen des Mitglieds eintragen.");
      return;
    }

    let phone = onlyDigits(mem.phone || "");
    if (phone.length < 6) {
      const x = prompt(
        "Telefon fehlt/zu kurz. Bitte Telefonnummer eingeben (optional, aber empfohlen):",
        mem.phone || ""
      );
      if (x == null) return;
      phone = onlyDigits(x);
    }

    const now = new Date().toISOString();
    const { firstName, lastName } = splitFullName(name);

    const newCustomerId = crypto.randomUUID();
    await db.customers.put({
      id: newCustomerId,
      createdAt: now,
      updatedAt: now,
      firstName,
      lastName,
      phone,
      email: "",
      instagram: "",
      marketingConsent: false,
      lastVisitAt: "",
      lastServedByStaffId: "",
      lastServedByStaffName: "",
      displayName: name,
      address: { street: "", city: "" },
      note: "",
      kind: "profile",
    });

    const nextMembers = editRow.group.members.map((m, i) =>
      i === memberIndex ? { ...m, customerId: newCustomerId, phone } : m
    );
    const nextEdit = { ...editRow, group: { ...editRow.group, members: nextMembers } };
    setEditRow(nextEdit);

    await db.customers.update(editRow.id, {
      updatedAt: now,
      group: { ...editRow.group, members: nextMembers },
    });

    await db.customer_history.add({
      id: crypto.randomUUID(),
      customerId: editRow.id,
      createdAt: now,
      visitId: "",
      areaId: "",
      staffId: "",
      staffName: "",
      type: "member_profile_created",
      payload: { memberName: name, newCustomerId },
    });

    await db.customer_history.add({
      id: crypto.randomUUID(),
      customerId: newCustomerId,
      createdAt: now,
      visitId: "",
      areaId: "",
      staffId: "",
      staffName: "",
      type: "profile_created_from_group_member",
      payload: { groupId: editRow.id, groupTitle: editRow.group.title || editRow.displayName },
    });

    setHistory(await loadHistory(editRow.id, 120));
    await reload();
  }

  async function unlinkMemberProfile(memberIndex) {
    if (!editRow?.id || editRow.kind !== "group") return;
    const mem = editRow.group?.members?.[memberIndex];
    if (!mem?.customerId) return;

    const ok = confirm("Verknüpfung zum Kundenprofil entfernen? (Profil bleibt bestehen.)");
    if (!ok) return;

    const now = new Date().toISOString();
    const nextMembers = editRow.group.members.map((m, i) =>
      i === memberIndex ? { ...m, customerId: "" } : m
    );
    const nextEdit = { ...editRow, group: { ...editRow.group, members: nextMembers } };
    setEditRow(nextEdit);

    await db.customers.update(editRow.id, {
      updatedAt: now,
      group: { ...editRow.group, members: nextMembers },
    });

    await db.customer_history.add({
      id: crypto.randomUUID(),
      customerId: editRow.id,
      createdAt: now,
      visitId: "",
      areaId: "",
      staffId: "",
      staffName: "",
      type: "member_profile_unlinked",
      payload: { memberName: mem.displayName, oldCustomerId: mem.customerId },
    });

    setHistory(await loadHistory(editRow.id, 120));
    await reload();
  }

  /** ---------- UI columns ---------- */
  const columns = useMemo(
    () => [
      { key: "name", label: "Name" },
      { key: "phone", label: "Telefon" },
      { key: "email", label: "E-Mail" },
      { key: "instagram", label: "Instagram" },
      { key: "last", label: "Letzter Staff" },
      { key: "action", label: "Aktion", right: true },
    ],
    []
  );

  const title = tab === "groups" ? "Gruppen" : "Kunden";
  const subtitle =
    tab === "groups"
      ? "Gruppen (z. B. Hochzeit) verwalten. Mitglieder können optional eigene Profile erhalten."
      : "Kundenprofile verwalten. Klick öffnet Details, Historie und Bearbeiten/Löschen.";

  return (
    <AdminShell
      title={title}
      subtitle={subtitle}
      left={
        <button className={styles.backBtnLeft} type="button" onClick={() => nav("/admin")}>
          ← Home
        </button>
      }
      right={
        <div className={styles.rightTools}>
          <div className={styles.searchWrap}>
            <input
              className={styles.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === "groups" ? "Suche Gruppen…" : "Suche Kunden…"}
            />
          </div>

          <div className={styles.tabPills}>
            <button
              type="button"
              className={`${styles.pill} ${tab === "customers" ? styles.pillActive : ""}`}
              onClick={() => setTab("customers")}
            >
              Kunden
            </button>
            <button
              type="button"
              className={`${styles.pill} ${tab === "groups" ? styles.pillActive : ""}`}
              onClick={() => setTab("groups")}
            >
              Gruppen
            </button>
          </div>

          <button className={styles.btnPrimary} type="button" onClick={openCreate}>
            + Neu
          </button>
        </div>
      }
    >
      <div className={styles.card}>
        <div className={styles.head}>
          <div className={styles.headLeft}>
            <div className={styles.title}>{title}</div>
            <div className={styles.sub}>
              Klick auf eine Zeile öffnet Details. In Details kannst du bearbeiten und löschen.
            </div>
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.right ? styles.right : ""}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className={styles.muted}>
                    Keine Treffer.
                  </td>
                </tr>
              ) : (
                filtered.map((c) => {
                  const isGroup = String(c.kind || "") === "group" || !!c.group;
                  const rowName = isGroup ? groupTitle(c) : safeName(c);

                  return (
                    <tr key={c.id} className={styles.row} onClick={() => openCustomer(c)}>
                      <td className={styles.nameCell}>
                        {rowName}
                        {isGroup ? <span className={styles.tag}>Gruppe</span> : null}
                      </td>
                      <td>{c.phone || "-"}</td>
                      <td className={styles.muted}>{c.email || "-"}</td>
                      <td className={styles.muted}>{c.instagram || "-"}</td>
                      <td className={styles.muted}>{c.lastServedByStaffName || "-"}</td>
                      <td className={styles.right} onClick={(e) => e.stopPropagation()}>
                        <button
                          className={styles.dangerBtn}
                          type="button"
                          onClick={() => {
                            openCustomer(c);
                          }}
                        >
                          Öffnen
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          <div className={styles.hint}>
            Tipp: Gruppen öffnen → Mitglieder → „Profil erstellen“ erzeugt optional ein echtes Kundenprofil und verknüpft es.
          </div>
        </div>
      </div>

      {/* VIEW/EDIT MODAL */}
      <Modal
        open={open}
        title={
          selected
            ? String(selected.kind || "") === "group" || selected.group
              ? `Gruppe: ${groupTitle(selected)}`
              : `Kunde: ${safeName(selected)}`
            : ""
        }
        onClose={closeView}
        footer={
          <div className={styles.modalFooterRow}>
            <button className={styles.btnGhost} onClick={closeView} type="button">
              Schließen
            </button>

            {mode === "edit" ? (
              <button className={styles.btnPrimary} onClick={saveEdit} type="button">
                Speichern
              </button>
            ) : (
              <button className={styles.btnPrimary} onClick={() => setMode("edit")} type="button">
                Bearbeiten
              </button>
            )}

            <button className={styles.btnDanger} onClick={deleteSelected} type="button">
              Löschen
            </button>
          </div>
        }
      >
        {!selected ? null : (
          <div className={styles.modalGrid}>
            <div className={styles.box}>
              <div className={styles.boxTitle}>Stammdaten</div>

              {(() => {
                const isGroup = String(selected.kind || "") === "group" || !!selected.group;
                const e = editRow;
                if (!e) return null;

                if (isGroup) {
                  const membersArr = Array.isArray(e.group?.members) ? e.group.members : [];
                  return (
                    <>
                      <Field label="Titel" disabled={mode !== "edit"}>
                        <input
                          className={styles.input}
                          value={e.group?.title || ""}
                          disabled={mode !== "edit"}
                          onChange={(ev) =>
                            setEditRow((p) => ({
                              ...p,
                              group: { ...(p.group || {}), title: ev.target.value },
                            }))
                          }
                        />
                      </Field>

                      <Field label="Kontakt Name" disabled={mode !== "edit"}>
                        <input
                          className={styles.input}
                          value={`${e.firstName || ""}${e.lastName ? ` ${e.lastName}` : ""}`.trim()}
                          disabled={mode !== "edit"}
                          onChange={(ev) => {
                            const { firstName, lastName } = splitFullName(ev.target.value);
                            setEditRow((p) => ({ ...p, firstName, lastName }));
                          }}
                        />
                      </Field>

                      <div className={styles.twoCol}>
                        <Field label="Telefon" disabled={mode !== "edit"}>
                          <input
                            className={styles.input}
                            value={e.phone || ""}
                            disabled={mode !== "edit"}
                            onChange={(ev) =>
                              setEditRow((p) => ({ ...p, phone: onlyDigits(ev.target.value) }))
                            }
                          />
                        </Field>
left={
  <button className={styles.backBtnLeft} type="button" onClick={() => nav(-1)}>
    ← Zurück
  </button>
}

                        <Field label="E-Mail" disabled={mode !== "edit"}>
                          <input
                            className={styles.input}
                            value={e.email || ""}
                            disabled={mode !== "edit"}
                            onChange={(ev) => setEditRow((p) => ({ ...p, email: ev.target.value }))}
                          />
                        </Field>
                      </div>

                      <Field label="Instagram" disabled={mode !== "edit"}>
                        <input
                          className={styles.input}
                          value={e.instagram || ""}
                          disabled={mode !== "edit"}
                          onChange={(ev) =>
                            setEditRow((p) => ({ ...p, instagram: normalizeInstagram(ev.target.value) }))
                          }
                        />
                      </Field>

                      <Field label="Notiz" disabled={mode !== "edit"}>
                        <input
                          className={styles.input}
                          value={e.note || ""}
                          disabled={mode !== "edit"}
                          onChange={(ev) => setEditRow((p) => ({ ...p, note: ev.target.value }))}
                        />
                      </Field>

                      <div className={styles.membersCard}>
                        <div className={styles.membersHead}>
                          <div>
                            <div className={styles.membersTitle}>Mitglieder</div>
                            <div className={styles.membersSub}>
                              Buttons sind immer sichtbar (Profil erstellen / Entfernen).
                            </div>
                          </div>

                          {mode === "edit" ? (
                            <button
                              className={styles.btnSmall}
                              type="button"
                              onClick={() => {
                                setEditRow((p) => ({
                                  ...p,
                                  group: {
                                    ...(p.group || {}),
                                    members: [
                                      ...(p.group?.members || []),
                                      { displayName: "", phone: "", customerId: "" },
                                    ],
                                  },
                                }));
                              }}
                            >
                              + Mitglied
                            </button>
                          ) : null}
                        </div>

                        <div className={styles.memberList}>
                          {membersArr.length === 0 ? (
                            <div className={styles.muted}>Keine Mitglieder.</div>
                          ) : (
                            membersArr.map((m, idx) => {
                              const hasProfile = !!m.customerId;
                              return (
                                <div key={idx} className={styles.memberRow}>
                                  <input
                                    className={styles.input}
                                    value={m.displayName || ""}
                                    disabled={mode !== "edit"}
                                    placeholder="Name"
                                    onChange={(ev) => {
                                      const v = ev.target.value;
                                      setEditRow((p) => {
                                        const next = p.group.members.map((x, i) =>
                                          i === idx ? { ...x, displayName: v } : x
                                        );
                                        return { ...p, group: { ...p.group, members: next } };
                                      });
                                    }}
                                  />

                                  <input
                                    className={styles.input}
                                    value={m.phone || ""}
                                    disabled={mode !== "edit"}
                                    placeholder="Telefon (optional)"
                                    onChange={(ev) => {
                                      const v = onlyDigits(ev.target.value);
                                      setEditRow((p) => {
                                        const next = p.group.members.map((x, i) =>
                                          i === idx ? { ...x, phone: v } : x
                                        );
                                        return { ...p, group: { ...p.group, members: next } };
                                      });
                                    }}
                                  />

                                  <div className={styles.memberActions}>
                                    {!hasProfile ? (
                                      <button
                                        type="button"
                                        className={styles.btnPrimarySm}
                                        onClick={() => createProfileFromMember(idx)}
                                      >
                                        Profil erstellen
                                      </button>
                                    ) : (
                                      <button type="button" className={styles.btnNeutralSm} disabled>
                                        Profil vorhanden
                                      </button>
                                    )}

                                    {hasProfile ? (
                                      <button
                                        type="button"
                                        className={styles.btnDangerSm}
                                        onClick={() => unlinkMemberProfile(idx)}
                                      >
                                        Entfernen
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </>
                  );
                }

                // CUSTOMER profile
                return (
                  <>
                    <Field label="Name (Anzeige)" disabled={mode !== "edit"}>
                      <input
                        className={styles.input}
                        value={e.displayName || safeName(e)}
                        disabled={mode !== "edit"}
                        onChange={(ev) => setEditRow((p) => ({ ...p, displayName: ev.target.value }))}
                      />
                    </Field>

                    <div className={styles.twoCol}>
                      <Field label="Vorname" disabled={mode !== "edit"}>
                        <input
                          className={styles.input}
                          value={e.firstName || ""}
                          disabled={mode !== "edit"}
                          onChange={(ev) => setEditRow((p) => ({ ...p, firstName: ev.target.value }))}
                        />
                      </Field>

                      <Field label="Nachname" disabled={mode !== "edit"}>
                        <input
                          className={styles.input}
                          value={e.lastName || ""}
                          disabled={mode !== "edit"}
                          onChange={(ev) => setEditRow((p) => ({ ...p, lastName: ev.target.value }))}
                        />
                      </Field>
                    </div>

                    <div className={styles.twoCol}>
                      <Field label="Telefon" disabled={mode !== "edit"}>
                        <input
                          className={styles.input}
                          value={e.phone || ""}
                          disabled={mode !== "edit"}
                          onChange={(ev) => setEditRow((p) => ({ ...p, phone: onlyDigits(ev.target.value) }))}
                        />
                      </Field>

                      <Field label="E-Mail" disabled={mode !== "edit"}>
                        <input
                          className={styles.input}
                          value={e.email || ""}
                          disabled={mode !== "edit"}
                          onChange={(ev) => setEditRow((p) => ({ ...p, email: ev.target.value }))}
                        />
                      </Field>
                    </div>

                    <Field label="Instagram" disabled={mode !== "edit"}>
                      <input
                        className={styles.input}
                        value={e.instagram || ""}
                        disabled={mode !== "edit"}
                        onChange={(ev) =>
                          setEditRow((p) => ({ ...p, instagram: normalizeInstagram(ev.target.value) }))
                        }
                      />
                    </Field>

                    <Field label="Notiz" disabled={mode !== "edit"}>
                      <input
                        className={styles.input}
                        value={e.note || ""}
                        disabled={mode !== "edit"}
                        onChange={(ev) => setEditRow((p) => ({ ...p, note: ev.target.value }))}
                      />
                    </Field>
                  </>
                );
              })()}
            </div>

            <div className={styles.boxWide}>
              <div className={styles.boxTitle}>Historie</div>
              <div className={styles.boxSub}>Bis zu 120 letzte Einträge.</div>

              <div className={styles.hist}>
                {history.length === 0 ? (
                  <div className={styles.empty2}>Keine Historie vorhanden.</div>
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
        )}
      </Modal>

      {/* CREATE MODAL */}
      <Modal
        open={createOpen}
        title="Neu anlegen"
        onClose={closeCreate}
        footer={
          <div className={styles.modalFooterRow}>
            <button className={styles.btnGhost} type="button" onClick={closeCreate}>
              Abbrechen
            </button>
            <button
              className={styles.btnPrimary}
              type="button"
              onClick={saveNewCustomer}
              disabled={!createValid}
            >
              Speichern
            </button>
          </div>
        }
      >
        <div className={styles.createTabs} role="tablist" aria-label="Typ">
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
            aria-selected={createMode === "group"}
            className={`${styles.tabBtn} ${createMode === "group" ? styles.tabBtnActive : ""}`}
            onClick={() => setCreateMode("group")}
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

            <Field
              label="Instagram (optional)"
              hint="Handle, z. B. salon.system"
              error={createErrors.profileInstagram}
            >
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
            <Field label="Titel * (z. B. Hochzeit Anna)" error={createErrors.groupTitle}>
              <input
                className={styles.input}
                value={group.title}
                onChange={(e) => setGroup((w) => ({ ...w, title: e.target.value }))}
              />
            </Field>

            <Field label="Kontakt Name *" error={createErrors.groupContact}>
              <input
                className={styles.input}
                value={group.contactName}
                onChange={(e) => setGroup((w) => ({ ...w, contactName: e.target.value }))}
              />
            </Field>

            <Field label="Telefon *" hint="Nur Zahlen." error={createErrors.groupPhone}>
              <input
                className={styles.input}
                value={group.phone}
                onChange={(e) => setGroup((w) => ({ ...w, phone: onlyDigits(e.target.value) }))}
                inputMode="numeric"
                pattern="[0-9]*"
              />
            </Field>

            <Field label="E-Mail (optional)" error={createErrors.groupEmail}>
              <input
                className={styles.input}
                type="email"
                value={group.email}
                onChange={(e) => setGroup((w) => ({ ...w, email: e.target.value }))}
              />
            </Field>

            <Field label="Instagram (optional)">
              <input
                className={styles.input}
                value={group.instagram}
                onChange={(e) => setGroup((w) => ({ ...w, instagram: normalizeInstagram(e.target.value) }))}
              />
            </Field>

            <Field label="Straße (optional)">
              <input
                className={styles.input}
                value={group.street}
                onChange={(e) => setGroup((w) => ({ ...w, street: e.target.value }))}
              />
            </Field>

            <Field label="Stadt (optional)">
              <input
                className={styles.input}
                value={group.city}
                onChange={(e) => setGroup((w) => ({ ...w, city: e.target.value }))}
              />
            </Field>

            <div className={styles.payRow}>
              <span className={styles.payLabel}>Zahlung</span>
              <button
                className={`${styles.pillSm} ${group.paymentMode === "single" ? styles.pillSmActive : ""}`}
                onClick={() => setGroup((w) => ({ ...w, paymentMode: "single" }))}
                type="button"
              >
                zusammen
              </button>
              <button
                className={`${styles.pillSm} ${group.paymentMode === "split" ? styles.pillSmActive : ""}`}
                onClick={() => setGroup((w) => ({ ...w, paymentMode: "split" }))}
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
                <div key={i} className={styles.memberRowCreate}>
                  <div className={styles.memberCol}>
                    <input
                      className={styles.input}
                      value={m.displayName}
                      placeholder={i === 0 ? "Braut / Hauptperson" : "Name"}
                      onChange={(e) => updateMember(i, { displayName: e.target.value })}
                    />
                    {createErrors[`memberName_${i}`] ? (
                      <div className={styles.error}>{createErrors[`memberName_${i}`]}</div>
                    ) : null}
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
                  ) : (
                    <div />
                  )}
                </div>
              ))}
            </div>

            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={!!group.marketingConsent}
                onChange={(e) => setGroup((w) => ({ ...w, marketingConsent: e.target.checked }))}
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


function Field({ label, hint, error, disabled, children }) {
  return (
    <label className={styles.field} data-disabled={disabled ? "1" : "0"}>
      <span className={styles.labelRow}>
        <span className={styles.label}>{label}</span>
        {hint ? <span className={styles.hintInline}>{hint}</span> : null}
      </span>
      {children}
      {error ? <div className={styles.error}>{error}</div> : null}
    </label>
    
  );
  
}
