import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AdminShell from "../components/AdminShell.jsx";
import Modal from "../components/Modal.jsx";
import { db } from "../../../db/index.js";
import styles from "./CustomerAdminPage.module.css";

/** ---------- Null-safe helpers ---------- */
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
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function fmtDateTime(iso) {
  const s = String(iso || "");
  if (!s) return "-";
  return s.replace("T", " ").slice(0, 16);
}

function nowIso() {
  return new Date().toISOString();
}

/** ---------- Data mapping for forms ---------- */
function toEditFormFromCustomer(c) {
  const x = safeCustomer(c);
  if (!x) {
    return {
      kind: "profile",
      displayName: "",
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      instagram: "",
      street: "",
      city: "",
      marketingConsent: false,
      note: "",
      // group
      groupTitle: "",
      contactName: "",
      groupPaymentMode: "single",
      members: [],
    };
  }

  const street = x.address?.street || "";
  const city = x.address?.city || "";

  if (x.kind === "group") {
    const title = String(x.displayName || x.group?.title || "").trim();
    const contactName = `${String(x.firstName || "").trim()} ${String(x.lastName || "").trim()}`.trim();
    return {
      kind: "group",
      displayName: title,
      firstName: String(x.firstName || ""),
      lastName: String(x.lastName || ""),
      phone: String(x.phone || ""),
      email: String(x.email || ""),
      instagram: "",
      street: String(street || ""),
      city: String(city || ""),
      marketingConsent: !!x.marketingConsent,
      note: String(x.note || ""),
      groupTitle: title,
      contactName,
      groupPaymentMode: x.group?.paymentMode === "split" ? "split" : "single",
      members: Array.isArray(x.group?.members) ? x.group.members.map((m) => ({
        displayName: String(m?.displayName || ""),
        phone: String(m?.phone || ""),
        // optional: if you later store link
        customerId: String(m?.customerId || ""),
      })) : [],
    };
  }

  const full = String(x.displayName || safeName(x) || "").trim();
  return {
    kind: "profile",
    displayName: full,
    firstName: String(x.firstName || ""),
    lastName: String(x.lastName || ""),
    phone: String(x.phone || ""),
    email: String(x.email || ""),
    instagram: String(x.instagram || ""),
    street: String(street || ""),
    city: String(city || ""),
    marketingConsent: !!x.marketingConsent,
    note: String(x.note || ""),
    groupTitle: "",
    contactName: "",
    groupPaymentMode: "single",
    members: [],
  };
}

function shortMeta(c) {
  const phone = c?.phone ? String(c.phone) : "-";
  const ig = c?.instagram ? `@${c.instagram}` : "-";
  const lastStaff = c?.lastServedByStaffName || "-";
  return `${phone} · ${ig} · last staff: ${lastStaff}`;
}

/** ---------- Component ---------- */
export default function CustomerAdminPage() {
  const nav = useNavigate();

  const [all, setAll] = useState([]);
  const [q, setQ] = useState("");

  // View/Edit modal
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [edit, setEdit] = useState(toEditFormFromCustomer(null));

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState("profile"); // profile | group
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
    street: "",
    city: "",
    paymentMode: "single",
    marketingConsent: false,
  });

  const [members, setMembers] = useState([{ displayName: "Braut", phone: "" }]);

  // Quick profile creation from member (missing info dialog)
  const [memberProfileOpen, setMemberProfileOpen] = useState(false);
  const [memberDraft, setMemberDraft] = useState({
    displayName: "",
    phone: "",
    email: "",
    instagram: "",
    street: "",
    city: "",
    marketingConsent: false,
  });
  const [memberOrigin, setMemberOrigin] = useState({ groupCustomerId: "", memberIndex: -1 });

  async function reload() {
    const rowsRaw = await db.customers.toArray();
    const rows = rowsRaw.map(safeCustomer).filter(Boolean);
    rows.sort((a, b) => safeName(a).localeCompare(safeName(b)));
    setAll(rows);
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return all;

    return all.filter((c) => {
      const hay = [
        safeName(c),
        c.displayName,
        c.phone,
        c.email,
        c.instagram,
        c.lastServedByStaffName,
        c.kind,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return hay.includes(s);
    });
  }, [all, q]);

  const customers = useMemo(
    () => filtered.filter((c) => (c.kind || "profile") !== "group"),
    [filtered]
  );

  const groups = useMemo(
    () => filtered.filter((c) => (c.kind || "") === "group"),
    [filtered]
  );

  async function openCustomer(c) {
    const x = safeCustomer(c);
    if (!x) return;

    setSelected(x);
    setEditMode(false);
    setEdit(toEditFormFromCustomer(x));

    const rows = await db.customer_history
      .where("customerId")
      .equals(x.id)
      .toArray()
      .catch(async () => {
        const allH = await db.customer_history.toArray();
        return (allH || []).filter((h) => h && h.customerId === x.id);
      });

    const clean = (rows || []).filter((r) => r && typeof r === "object");
    clean.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    setHistory(clean.slice(0, 120));

    setOpen(true);
  }

  function closeView() {
    setOpen(false);
    setSelected(null);
    setHistory([]);
    setEditMode(false);
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

    if (createMode === "group") {
      const title = group.title.trim();
      const contact = group.contactName.trim();
      const phone = group.phone.trim();
      if (title.length < 2) e.groupTitle = "Bitte mindestens 2 Zeichen.";
      if (contact.length < 2) e.groupContact = "Bitte mindestens 2 Zeichen.";
      if (onlyDigits(phone).length < 6) e.groupPhone = "Bitte gültige Telefonnummer (min. 6 Ziffern).";
      if (!isValidEmail(group.email)) e.groupEmail = "Bitte gültige E-Mail.";

      if (!members.length) e.members = "Mindestens 1 Mitglied erforderlich.";
      members.forEach((m, idx) => {
        if ((m.displayName || "").trim().length < 2) e[`memberName_${idx}`] = "Name: mindestens 2 Zeichen.";
      });
    }

    return e;
  }, [createMode, profile, group, members]);

  const createValid = useMemo(() => Object.keys(createErrors).length === 0, [createErrors]);

  async function saveNewCustomer() {
    if (!createValid) return;
    const now = nowIso();

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
        address: {
          street: String(profile.street || "").trim(),
          city: String(profile.city || "").trim(),
        },
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

    if (createMode === "group") {
      const title = group.title.trim();
      const contact = group.contactName.trim();
      const { firstName, lastName } = splitFullName(contact);

      const row = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        firstName,
        lastName,
        phone: onlyDigits(group.phone),
        email: String(group.email || "").trim(),
        instagram: "",
        marketingConsent: !!group.marketingConsent,
        lastVisitAt: "",
        lastServedByStaffId: "",
        lastServedByStaffName: "",
        displayName: title,
        address: {
          street: String(group.street || "").trim(),
          city: String(group.city || "").trim(),
        },
        note: String(note || "").trim(),
        kind: "group",
        group: {
          title,
          paymentMode: group.paymentMode === "split" ? "split" : "single",
          members: members.map((m) => ({
            displayName: String(m.displayName || "").trim(),
            phone: onlyDigits(m.phone || ""),
            customerId: "", // optional link to a profile
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
          paymentMode: row.group.paymentMode,
          membersCount: members.length,
          note: String(note || "").trim(),
        },
      });
    }

    await reload();
    setCreateOpen(false);
  }

  /** ---------- Edit / Delete ---------- */
  function startEdit() {
    if (!selected) return;
    setEditMode(true);
    setEdit(toEditFormFromCustomer(selected));
  }

  function cancelEdit() {
    setEditMode(false);
    setEdit(toEditFormFromCustomer(selected));
  }

  function editErrors() {
    const e = {};
    if (!editMode) return e;

    if (edit.kind === "profile") {
      const dn = String(edit.displayName || "").trim();
      const phone = String(edit.phone || "").trim();

      if (dn.length < 2) e.displayName = "Name: mindestens 2 Zeichen.";
      if (onlyDigits(phone).length < 6) e.phone = "Telefon: min. 6 Ziffern.";
      if (!isValidEmail(edit.email)) e.email = "Bitte gültige E-Mail.";
      if (!isValidInstagramHandle(edit.instagram)) e.instagram = "Bitte gültiger Handle.";
    } else {
      const title = String(edit.groupTitle || edit.displayName || "").trim();
      const contact = String(edit.contactName || "").trim();
      const phone = String(edit.phone || "").trim();

      if (title.length < 2) e.groupTitle = "Titel: mindestens 2 Zeichen.";
      if (contact.length < 2) e.contactName = "Kontakt: mindestens 2 Zeichen.";
      if (onlyDigits(phone).length < 6) e.phone = "Telefon: min. 6 Ziffern.";
      if (!isValidEmail(edit.email)) e.email = "Bitte gültige E-Mail.";

      const mem = Array.isArray(edit.members) ? edit.members : [];
      if (mem.length === 0) e.members = "Mindestens 1 Mitglied erforderlich.";
      mem.forEach((m, idx) => {
        if (String(m.displayName || "").trim().length < 2) e[`m_${idx}`] = "Name: min. 2 Zeichen.";
      });
    }

    return e;
  }

  const eErr = useMemo(editErrors, [edit, editMode]);

  async function saveEdit() {
    if (!selected) return;
    if (Object.keys(eErr).length > 0) return;

    const now = nowIso();

    if (edit.kind === "profile") {
      const dn = String(edit.displayName || "").trim();
      const { firstName, lastName } = splitFullName(dn);

      await db.customers.update(selected.id, {
        updatedAt: now,
        displayName: dn,
        firstName,
        lastName,
        phone: onlyDigits(edit.phone),
        email: String(edit.email || "").trim(),
        instagram: normalizeInstagram(edit.instagram),
        marketingConsent: !!edit.marketingConsent,
        note: String(edit.note || "").trim(),
        address: { street: String(edit.street || "").trim(), city: String(edit.city || "").trim() },
      });
    } else {
      const title = String(edit.groupTitle || edit.displayName || "").trim();
      const contact = String(edit.contactName || "").trim();
      const { firstName, lastName } = splitFullName(contact);

      await db.customers.update(selected.id, {
        updatedAt: now,
        displayName: title,
        firstName,
        lastName,
        phone: onlyDigits(edit.phone),
        email: String(edit.email || "").trim(),
        marketingConsent: !!edit.marketingConsent,
        note: String(edit.note || "").trim(),
        address: { street: String(edit.street || "").trim(), city: String(edit.city || "").trim() },
        group: {
          title,
          paymentMode: edit.groupPaymentMode === "split" ? "split" : "single",
          members: (edit.members || []).map((m) => ({
            displayName: String(m.displayName || "").trim(),
            phone: onlyDigits(m.phone || ""),
            customerId: String(m.customerId || ""),
          })),
        },
      });
    }

    const refreshed = await db.customers.get(selected.id);
    setSelected(refreshed);
    setEditMode(false);
    setEdit(toEditFormFromCustomer(refreshed));
    await reload();
  }

  async function deleteSelected() {
    if (!selected) return;
    const name = selected.displayName || safeName(selected);
    const ok = window.confirm(`Wirklich löschen?\n\n${name}\n\nDiese Aktion kann nicht rückgängig gemacht werden.`);
    if (!ok) return;

    // Delete customer + history
    await db.customers.delete(selected.id);

    const rows = await db.customer_history.where("customerId").equals(selected.id).toArray().catch(() => []);
    await Promise.all((rows || []).map((r) => db.customer_history.delete(r.id)));

    await reload();
    closeView();
  }

  /** ---------- Member -> create profile (fast) ---------- */
  async function createProfileFromMember(groupCustomerId, memberIndex) {
    const grp = await db.customers.get(groupCustomerId);
    if (!grp || grp.kind !== "group") return;

    const mem = grp.group?.members?.[memberIndex];
    if (!mem) return;

    const displayName = String(mem.displayName || "").trim();
    const phone = String(mem.phone || "").trim();

    // If missing data -> open quick dialog
    const missingPhone = onlyDigits(phone).length < 6;
    const missingName = displayName.length < 2;

    setMemberOrigin({ groupCustomerId, memberIndex });
    setMemberDraft({
      displayName,
      phone: phone,
      email: "",
      instagram: "",
      street: grp.address?.street || "",
      city: grp.address?.city || "",
      marketingConsent: !!grp.marketingConsent,
    });

    if (missingName || missingPhone) {
      setMemberProfileOpen(true);
      return;
    }

    await finalizeMemberProfileCreate({
      displayName,
      phone,
      email: "",
      instagram: "",
      street: grp.address?.street || "",
      city: grp.address?.city || "",
      marketingConsent: !!grp.marketingConsent,
    });
  }

  async function finalizeMemberProfileCreate(draft) {
    const dn = String(draft.displayName || "").trim();
    const ph = onlyDigits(draft.phone);
    if (dn.length < 2) return;
    if (ph.length < 6) return;
    if (!isValidEmail(draft.email)) return;
    if (!isValidInstagramHandle(draft.instagram)) return;

    const now = nowIso();
    const { firstName, lastName } = splitFullName(dn);

    // Create customer profile
    const newId = crypto.randomUUID();
    await db.customers.put({
      id: newId,
      createdAt: now,
      updatedAt: now,
      firstName,
      lastName,
      phone: ph,
      email: String(draft.email || "").trim(),
      instagram: normalizeInstagram(draft.instagram),
      marketingConsent: !!draft.marketingConsent,
      lastVisitAt: "",
      lastServedByStaffId: "",
      lastServedByStaffName: "",
      displayName: dn,
      address: { street: String(draft.street || "").trim(), city: String(draft.city || "").trim() },
      note: "",
      kind: "profile",
    });

    // Link back into group member (customerId)
    const { groupCustomerId, memberIndex } = memberOrigin;
    if (groupCustomerId && memberIndex >= 0) {
      const grp = await db.customers.get(groupCustomerId);
      if (grp && grp.kind === "group" && Array.isArray(grp.group?.members)) {
        const nextMembers = grp.group.members.map((m, idx) =>
          idx === memberIndex
            ? { ...m, customerId: newId, displayName: dn, phone: ph }
            : m
        );

        await db.customers.update(groupCustomerId, {
          updatedAt: now,
          group: {
            ...grp.group,
            members: nextMembers,
          },
        });

        const refreshed = await db.customers.get(groupCustomerId);
        if (selected?.id === groupCustomerId) {
          setSelected(refreshed);
          setEdit(toEditFormFromCustomer(refreshed));
        }
      }
    }

    setMemberProfileOpen(false);
    setMemberOrigin({ groupCustomerId: "", memberIndex: -1 });
    await reload();
  }

  const memberDraftErrors = useMemo(() => {
    if (!memberProfileOpen) return {};
    const e = {};
    const dn = String(memberDraft.displayName || "").trim();
    const ph = onlyDigits(memberDraft.phone);

    if (dn.length < 2) e.displayName = "Name: mindestens 2 Zeichen.";
    if (ph.length < 6) e.phone = "Telefon: min. 6 Ziffern.";
    if (!isValidEmail(memberDraft.email)) e.email = "Bitte gültige E-Mail.";
    if (!isValidInstagramHandle(memberDraft.instagram)) e.instagram = "Bitte gültiger Handle.";

    return e;
  }, [memberDraft, memberProfileOpen]);

  const memberDraftValid = useMemo(() => Object.keys(memberDraftErrors).length === 0, [memberDraftErrors]);

  /** ---------- UI ---------- */
  return (
    <AdminShell
      title="Kunden"
      subtitle="Kunden und Gruppen getrennt. Admin kann bearbeiten/löschen. Gruppen: Mitgliederverwaltung + optional Profile."
      right={
        <div className={styles.rightTools}>
          <button className={styles.backBtn} type="button" onClick={() => nav("/admin")} aria-label="Zurück zum Admin-Menü">
            <span className={styles.backIcon}>←</span>
            <span>Admin</span>
          </button>

          <div className={styles.searchBox}>
            <input
              className={styles.search}
              placeholder="Suche: Name, Telefon, Instagram, E-Mail…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <button className={styles.primaryBtn} type="button" onClick={openCreate}>
            + Neu
          </button>
        </div>
      }
    >
      <div className={styles.wrap}>
        {/* LEFT: Kunden */}
        <div className={styles.card}>
          <div className={styles.headRow}>
            <div>
              <div className={styles.hTitle}>Kunden</div>
              <div className={styles.hSub}>Einzelprofile (Standard).</div>
            </div>
            <div className={styles.chip}>{customers.length}</div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Kontakt</th>
                  <th className={styles.right}>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr>
                    <td colSpan={3} className={styles.muted}>Keine Kunden gefunden.</td>
                  </tr>
                ) : (
                  customers.map((c) => (
                    <tr key={c.id} className={styles.row} onClick={() => openCustomer(c)}>
                      <td className={styles.nameCell}>{safeName(c)}</td>
                      <td className={styles.metaCell}>{shortMeta(c)}</td>
                      <td className={styles.right} onClick={(e) => e.stopPropagation()}>
                        <button className={styles.ghostBtn} type="button" onClick={() => openCustomer(c)}>
                          Öffnen
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className={styles.hint}>Klick auf Zeile → Profil bearbeiten/löschen + Historie.</div>
          </div>
        </div>

        {/* RIGHT: Gruppen */}
        <div className={styles.card}>
          <div className={styles.headRow}>
            <div>
              <div className={styles.hTitle}>Gruppen</div>
              <div className={styles.hSub}>Hochzeiten / Gruppenprofile.</div>
            </div>
            <div className={styles.chip}>{groups.length}</div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Titel</th>
                  <th>Kontakt</th>
                  <th className={styles.right}>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 ? (
                  <tr>
                    <td colSpan={3} className={styles.muted}>Keine Gruppen gefunden.</td>
                  </tr>
                ) : (
                  groups.map((g) => (
                    <tr key={g.id} className={styles.row} onClick={() => openCustomer(g)}>
                      <td className={styles.nameCell}>{String(g.displayName || g.group?.title || "Gruppe")}</td>
                      <td className={styles.metaCell}>
                        {safeName(g)} · {g.phone || "-"} · {g.group?.members?.length ?? 0} Mitglieder
                      </td>
                      <td className={styles.right} onClick={(e) => e.stopPropagation()}>
                        <button className={styles.ghostBtn} type="button" onClick={() => openCustomer(g)}>
                          Öffnen
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className={styles.hint}>Gruppen: Mitglieder verwalten + optional Profile pro Mitglied erstellen.</div>
          </div>
        </div>
      </div>

      {/* VIEW / EDIT MODAL */}
      <Modal
        open={open}
        title={
          selected
            ? (selected.kind === "group" ? "Gruppe: " : "Kunde: ") + (selected.displayName || safeName(selected))
            : ""
        }
        onClose={closeView}
        footer={
          <div className={styles.modalFooter}>
            {!editMode ? (
              <>
                <button className={styles.secondaryBtn} type="button" onClick={closeView}>Schließen</button>
                <button className={styles.dangerBtn} type="button" onClick={deleteSelected}>Löschen</button>
                <button className={styles.primaryBtn} type="button" onClick={startEdit}>Bearbeiten</button>
              </>
            ) : (
              <>
                <button className={styles.secondaryBtn} type="button" onClick={cancelEdit}>Abbrechen</button>
                <button className={styles.primaryBtn} type="button" onClick={saveEdit} disabled={Object.keys(eErr).length > 0}>
                  Speichern
                </button>
              </>
            )}
          </div>
        }
      >
        <div className={styles.modalBody}>
          <div className={styles.modalGrid}>
            {/* Left panel: Profile fields */}
            <div className={styles.panel}>
              <div className={styles.panelTitle}>Stammdaten</div>

              {!editMode ? (
                <div className={styles.kv}>
                  <div className={styles.k}>Typ</div>
                  <div className={styles.v}>{selected?.kind === "group" ? "Gruppe" : "Kunde"}</div>

                  <div className={styles.k}>Name/Titel</div>
                  <div className={styles.v}>{selected?.displayName || safeName(selected)}</div>

                  <div className={styles.k}>Telefon</div>
                  <div className={styles.v}>{selected?.phone || "-"}</div>

                  <div className={styles.k}>E-Mail</div>
                  <div className={styles.v}>{selected?.email || "-"}</div>

                  <div className={styles.k}>Instagram</div>
                  <div className={styles.v}>{selected?.instagram ? `@${selected.instagram}` : "-"}</div>

                  <div className={styles.k}>Marketing</div>
                  <div className={styles.v}>{selected?.marketingConsent ? "ja" : "nein"}</div>

                  <div className={styles.k}>Adresse</div>
                  <div className={styles.v}>
                    {(selected?.address?.street || "-")} · {(selected?.address?.city || "-")}
                  </div>

                  <div className={styles.k}>Notiz</div>
                  <div className={styles.v}>{selected?.note || "-"}</div>

                  <div className={styles.k}>Erstellt</div>
                  <div className={styles.v}>{fmtDateTime(selected?.createdAt)}</div>

                  <div className={styles.k}>Letzter Staff</div>
                  <div className={styles.v}>{selected?.lastServedByStaffName || "-"}</div>
                </div>
              ) : (
                <>
                  {edit.kind === "profile" ? (
                    <div className={styles.formGrid}>
                      <Field styles={styles} label="Name *" error={eErr.displayName}>
                        <input
                          className={styles.input}
                          value={edit.displayName}
                          onChange={(e) => setEdit((p) => ({ ...p, displayName: e.target.value }))}
                        />
                      </Field>

                      <Field styles={styles} label="Telefon *" error={eErr.phone} hint="Nur Zahlen">
                        <input
                          className={styles.input}
                          value={edit.phone}
                          onChange={(e) => setEdit((p) => ({ ...p, phone: onlyDigits(e.target.value) }))}
                          inputMode="numeric"
                          pattern="[0-9]*"
                        />
                      </Field>

                      <Field styles={styles} label="E-Mail" error={eErr.email}>
                        <input
                          className={styles.input}
                          type="email"
                          value={edit.email}
                          onChange={(e) => setEdit((p) => ({ ...p, email: e.target.value }))}
                        />
                      </Field>

                      <Field styles={styles} label="Instagram" error={eErr.instagram}>
                        <input
                          className={styles.input}
                          value={edit.instagram}
                          onChange={(e) => setEdit((p) => ({ ...p, instagram: normalizeInstagram(e.target.value) }))}
                        />
                      </Field>

                      <Field styles={styles} label="Straße">
                        <input
                          className={styles.input}
                          value={edit.street}
                          onChange={(e) => setEdit((p) => ({ ...p, street: e.target.value }))}
                        />
                      </Field>

                      <Field styles={styles} label="Stadt">
                        <input
                          className={styles.input}
                          value={edit.city}
                          onChange={(e) => setEdit((p) => ({ ...p, city: e.target.value }))}
                        />
                      </Field>

                      <Field styles={styles} label="Notiz">
                        <input
                          className={styles.input}
                          value={edit.note}
                          onChange={(e) => setEdit((p) => ({ ...p, note: e.target.value }))}
                        />
                      </Field>

                      <label className={styles.checkRow}>
                        <input
                          type="checkbox"
                          checked={!!edit.marketingConsent}
                          onChange={(e) => setEdit((p) => ({ ...p, marketingConsent: e.target.checked }))}
                        />
                        <span>Marketing-Einverständnis</span>
                      </label>
                    </div>
                  ) : (
                    <div className={styles.formGrid}>
                      <Field styles={styles} label="Titel *" error={eErr.groupTitle}>
                        <input
                          className={styles.input}
                          value={edit.groupTitle}
                          onChange={(e) => setEdit((p) => ({ ...p, groupTitle: e.target.value, displayName: e.target.value }))}
                        />
                      </Field>

                      <Field styles={styles} label="Kontakt Name *" error={eErr.contactName}>
                        <input
                          className={styles.input}
                          value={edit.contactName}
                          onChange={(e) => setEdit((p) => ({ ...p, contactName: e.target.value }))}
                        />
                      </Field>

                      <Field styles={styles} label="Telefon *" error={eErr.phone} hint="Nur Zahlen">
                        <input
                          className={styles.input}
                          value={edit.phone}
                          onChange={(e) => setEdit((p) => ({ ...p, phone: onlyDigits(e.target.value) }))}
                          inputMode="numeric"
                          pattern="[0-9]*"
                        />
                      </Field>

                      <Field styles={styles} label="E-Mail" error={eErr.email}>
                        <input
                          className={styles.input}
                          type="email"
                          value={edit.email}
                          onChange={(e) => setEdit((p) => ({ ...p, email: e.target.value }))}
                        />
                      </Field>

                      <Field styles={styles} label="Straße">
                        <input
                          className={styles.input}
                          value={edit.street}
                          onChange={(e) => setEdit((p) => ({ ...p, street: e.target.value }))}
                        />
                      </Field>

                      <Field styles={styles} label="Stadt">
                        <input
                          className={styles.input}
                          value={edit.city}
                          onChange={(e) => setEdit((p) => ({ ...p, city: e.target.value }))}
                        />
                      </Field>

                      <Field styles={styles} label="Notiz">
                        <input
                          className={styles.input}
                          value={edit.note}
                          onChange={(e) => setEdit((p) => ({ ...p, note: e.target.value }))}
                        />
                      </Field>

                      <div className={styles.payRow}>
                        <span className={styles.payLabel}>Zahlung</span>
                        <button
                          type="button"
                          className={`${styles.pillSm} ${edit.groupPaymentMode === "single" ? styles.pillSmActive : ""}`}
                          onClick={() => setEdit((p) => ({ ...p, groupPaymentMode: "single" }))}
                        >
                          zusammen
                        </button>
                        <button
                          type="button"
                          className={`${styles.pillSm} ${edit.groupPaymentMode === "split" ? styles.pillSmActive : ""}`}
                          onClick={() => setEdit((p) => ({ ...p, groupPaymentMode: "split" }))}
                        >
                          separat
                        </button>
                      </div>

                      <label className={styles.checkRow}>
                        <input
                          type="checkbox"
                          checked={!!edit.marketingConsent}
                          onChange={(e) => setEdit((p) => ({ ...p, marketingConsent: e.target.checked }))}
                        />
                        <span>Marketing-Einverständnis (Kontakt)</span>
                      </label>

                      <div className={styles.members}>
                        <div className={styles.membersHead}>
                          <b>Mitglieder *</b>
                          <button className={styles.btnSmall} type="button" onClick={() => setEdit((p) => ({
                            ...p,
                            members: [...(p.members || []), { displayName: "", phone: "", customerId: "" }]
                          }))}>
                            + Mitglied
                          </button>
                        </div>

                        {eErr.members ? <div className={styles.error}>{eErr.members}</div> : null}

                        {(edit.members || []).map((m, i) => (
                          <div key={i} className={styles.memberRow}>
                            <div className={styles.memberCol}>
                              <input
                                className={styles.input}
                                value={m.displayName}
                                placeholder={i === 0 ? "Hauptperson" : "Name"}
                                onChange={(e) => setEdit((p) => ({
                                  ...p,
                                  members: p.members.map((x, idx) => idx === i ? { ...x, displayName: e.target.value } : x)
                                }))}
                              />
                              {eErr[`m_${i}`] ? <div className={styles.error}>{eErr[`m_${i}`]}</div> : null}
                            </div>

                            <input
                              className={styles.input}
                              value={m.phone}
                              placeholder="Telefon (optional)"
                              onChange={(e) => setEdit((p) => ({
                                ...p,
                                members: p.members.map((x, idx) => idx === i ? { ...x, phone: onlyDigits(e.target.value) } : x)
                              }))}
                              inputMode="numeric"
                              pattern="[0-9]*"
                            />

                            <div className={styles.memberActions}>
                              {String(m.customerId || "") ? (
                                <span className={styles.linkChip}>Profil verknüpft</span>
                              ) : (
                                <button
                                  className={styles.ghostBtn}
                                  type="button"
                                  onClick={() => createProfileFromMember(selected.id, i)}
                                  title="Optional ein eigenes Kundenprofil aus diesem Mitglied erstellen"
                                >
                                  Profil erstellen
                                </button>
                              )}

                              {i > 0 ? (
                                <button
                                  className={styles.dangerBtn}
                                  type="button"
                                  onClick={() => setEdit((p) => ({
                                    ...p,
                                    members: p.members.filter((_, idx) => idx !== i)
                                  }))}
                                >
                                  Entfernen
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {!editMode && selected?.kind === "group" ? (
                <div className={styles.groupInfo}>
                  <div className={styles.groupInfoTitle}>Mitglieder</div>
                  <div className={styles.groupInfoSub}>
                    Zum Bearbeiten: „Bearbeiten“ → Mitglieder anpassen / löschen / Profil erstellen.
                  </div>
                </div>
              ) : null}
            </div>

            {/* Right panel: History */}
            <div className={styles.panel}>
              <div className={styles.panelTitle}>Historie</div>
              <div className={styles.panelSub}>Bis zu 120 letzte Einträge.</div>

              <div className={styles.hist}>
                {history.length === 0 ? (
                  <div className={styles.muted}>Keine Historie vorhanden.</div>
                ) : (
                  history.map((h) => (
                    <div key={h.id} className={styles.histRow}>
                      <div className={styles.histTop}>
                        <div className={styles.histType}>{h.type || "event"}</div>
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
        </div>
      </Modal>

      {/* CREATE MODAL */}
      <Modal
        open={createOpen}
        title="Neu anlegen"
        onClose={closeCreate}
        footer={
          <div className={styles.modalFooter}>
            <button className={styles.secondaryBtn} type="button" onClick={closeCreate}>
              Abbrechen
            </button>
            <button className={styles.primaryBtn} type="button" onClick={saveNewCustomer} disabled={!createValid}>
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
            <Field styles={styles} label="Name *" error={createErrors.profileFullName}>
              <input
                className={styles.input}
                value={profile.fullName}
                onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))}
                placeholder="Vor- und Nachname"
              />
            </Field>

            <Field styles={styles} label="Telefon *" hint="Nur Zahlen." error={createErrors.profilePhone}>
              <input
                className={styles.input}
                value={profile.phone}
                onChange={(e) => setProfile((p) => ({ ...p, phone: onlyDigits(e.target.value) }))}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="z. B. 015112345678"
              />
            </Field>

            <Field styles={styles} label="E-Mail (optional)" error={createErrors.profileEmail}>
              <input
                className={styles.input}
                type="email"
                value={profile.email}
                onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
              />
            </Field>

            <Field styles={styles} label="Instagram (optional)" hint="Handle" error={createErrors.profileInstagram}>
              <input
                className={styles.input}
                value={profile.instagram}
                onChange={(e) => setProfile((p) => ({ ...p, instagram: normalizeInstagram(e.target.value) }))}
              />
            </Field>

            <Field styles={styles} label="Straße (optional)">
              <input className={styles.input} value={profile.street} onChange={(e) => setProfile((p) => ({ ...p, street: e.target.value }))} />
            </Field>

            <Field styles={styles} label="Stadt (optional)">
              <input className={styles.input} value={profile.city} onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))} />
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
            <Field styles={styles} label="Titel *" error={createErrors.groupTitle}>
              <input className={styles.input} value={group.title} onChange={(e) => setGroup((w) => ({ ...w, title: e.target.value }))} />
            </Field>

            <Field styles={styles} label="Kontakt Name *" error={createErrors.groupContact}>
              <input className={styles.input} value={group.contactName} onChange={(e) => setGroup((w) => ({ ...w, contactName: e.target.value }))} />
            </Field>

            <Field styles={styles} label="Telefon *" hint="Nur Zahlen." error={createErrors.groupPhone}>
              <input className={styles.input} value={group.phone} onChange={(e) => setGroup((w) => ({ ...w, phone: onlyDigits(e.target.value) }))} inputMode="numeric" pattern="[0-9]*" />
            </Field>

            <Field styles={styles} label="E-Mail (optional)" error={createErrors.groupEmail}>
              <input className={styles.input} type="email" value={group.email} onChange={(e) => setGroup((w) => ({ ...w, email: e.target.value }))} />
            </Field>

            <Field styles={styles} label="Straße (optional)">
              <input className={styles.input} value={group.street} onChange={(e) => setGroup((w) => ({ ...w, street: e.target.value }))} />
            </Field>

            <Field styles={styles} label="Stadt (optional)">
              <input className={styles.input} value={group.city} onChange={(e) => setGroup((w) => ({ ...w, city: e.target.value }))} />
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
                    <button className={styles.dangerBtn} onClick={() => removeMember(i)} type="button">
                      Entfernen
                    </button>
                  ) : null}
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
          <Field styles={styles} label="Notiz / Kommentar (optional)">
            <input className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Allergie, Wunsch, Hinweis…" />
          </Field>
        </div>
      </Modal>

      {/* QUICK MEMBER PROFILE MODAL */}
      <Modal
        open={memberProfileOpen}
        title="Profil aus Mitglied erstellen"
        onClose={() => setMemberProfileOpen(false)}
        footer={
          <div className={styles.modalFooter}>
            <button className={styles.secondaryBtn} type="button" onClick={() => setMemberProfileOpen(false)}>
              Abbrechen
            </button>
            <button
              className={styles.primaryBtn}
              type="button"
              onClick={() => finalizeMemberProfileCreate(memberDraft)}
              disabled={!memberDraftValid}
            >
              Profil erstellen
            </button>
          </div>
        }
      >
        <div className={styles.quickNote}>
          Fehlende Daten ergänzen – danach wird das Profil sofort erstellt und automatisch in der Gruppe verknüpft.
        </div>

        <div className={styles.formGrid}>
          <Field styles={styles} label="Name *" error={memberDraftErrors.displayName}>
            <input
              className={styles.input}
              value={memberDraft.displayName}
              onChange={(e) => setMemberDraft((p) => ({ ...p, displayName: e.target.value }))}
            />
          </Field>

          <Field styles={styles} label="Telefon *" error={memberDraftErrors.phone} hint="Nur Zahlen">
            <input
              className={styles.input}
              value={memberDraft.phone}
              onChange={(e) => setMemberDraft((p) => ({ ...p, phone: onlyDigits(e.target.value) }))}
              inputMode="numeric"
              pattern="[0-9]*"
            />
          </Field>

          <Field styles={styles} label="E-Mail (optional)" error={memberDraftErrors.email}>
            <input
              className={styles.input}
              type="email"
              value={memberDraft.email}
              onChange={(e) => setMemberDraft((p) => ({ ...p, email: e.target.value }))}
            />
          </Field>

          <Field styles={styles} label="Instagram (optional)" error={memberDraftErrors.instagram}>
            <input
              className={styles.input}
              value={memberDraft.instagram}
              onChange={(e) => setMemberDraft((p) => ({ ...p, instagram: normalizeInstagram(e.target.value) }))}
            />
          </Field>

          <Field styles={styles} label="Straße (optional)">
            <input
              className={styles.input}
              value={memberDraft.street}
              onChange={(e) => setMemberDraft((p) => ({ ...p, street: e.target.value }))}
            />
          </Field>

          <Field styles={styles} label="Stadt (optional)">
            <input
              className={styles.input}
              value={memberDraft.city}
              onChange={(e) => setMemberDraft((p) => ({ ...p, city: e.target.value }))}
            />
          </Field>

          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={!!memberDraft.marketingConsent}
              onChange={(e) => setMemberDraft((p) => ({ ...p, marketingConsent: e.target.checked }))}
            />
            <span>Marketing-Einverständnis</span>
          </label>
        </div>
      </Modal>
    </AdminShell>
  );
}

/** ---------- Reusable Field ---------- */
function Field({ styles, label, hint, error, children }) {
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
