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

async function findDuplicates({ phoneDigits, emailLower, excludeId }) {
  const phone = onlyDigits(phoneDigits);
  const email = String(emailLower || "").trim().toLowerCase();

  const all = await db.customers.toArray().catch(() => []);
  return (all || []).filter((c) => {
    if (!c) return false;
    if (excludeId && c.id === excludeId) return false;

    const p = onlyDigits(c.phone || "");
    const e = String(c.email || "").trim().toLowerCase();

    const phoneMatch = phone && p && p === phone;
    const emailMatch = email && e && e === email;

    return phoneMatch || emailMatch;
  });
}

function isGroupLikeCustomer(x) {
  const kind = String(x?.kind || "");
  return kind === "group" || !!x?.group;
}

export default function CustomerAdminPage() {
  const nav = useNavigate();

  const [customers, setCustomers] = useState([]);
  const [groups, setGroups] = useState([]);

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("customers"); // customers | groups

  // View/Edit modal
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("view"); // view | edit
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [editRow, setEditRow] = useState(null);

  async function reloadAll() {
    const [c, grp, grpMembers] = await Promise.all([
      db.customers.toArray().catch(() => []),
      db.groups.toArray().catch(() => []),
      db.group_members.toArray().catch(() => []),
    ]);

    const cleanCustomers = (c || []).filter(Boolean);

    // 1) echte Kunden
    const realCustomers = cleanCustomers.filter((x) => !isGroupLikeCustomer(x));
    realCustomers.sort((x, y) => safeName(x).localeCompare(safeName(y)));
    setCustomers(realCustomers);

    // 2) Gruppen aus customers als fallback
    const customerGroups = cleanCustomers
      .filter((x) => isGroupLikeCustomer(x))
      .map((x) => ({
        id: String(x.id),
        title: String(x.group?.title || x.displayName || x.title || "").trim(),
        phone: String(x.phone || ""),
        email: String(x.email || ""),
        instagram: String(x.instagram || ""),
        paymentMode: String(x.group?.paymentMode || "single"),
        contactFirstName: String(x.firstName || ""),
        contactLastName: String(x.lastName || ""),
        address: {
          street: String(x.address?.street || ""),
          city: String(x.address?.city || ""),
        },
        _src: "customers",
        _membersInline: Array.isArray(x.group?.members) ? x.group.members : [],
      }));

    // 3) Gruppen aus db.groups
    const groupsFromTable = (grp || [])
      .filter(Boolean)
      .map((g) => ({
        id: String(g.id),
        title: String(g.title || g.displayName || "").trim(),
        phone: String(g.phone || ""),
        email: String(g.email || ""),
        instagram: String(g.instagram || ""),
        paymentMode: String(g.paymentMode || "single"),
        contactFirstName: String(g.contactFirstName || ""),
        contactLastName: String(g.contactLastName || ""),
        address: {
          street: String(g.address?.street || ""),
          city: String(g.address?.city || ""),
        },
        _src: "groups",
      }));

    // 4) Merge by id (db.groups wins)
    const byId = new Map();
    for (const g of customerGroups) byId.set(String(g.id), g);
    for (const g of groupsFromTable) byId.set(String(g.id), g);

    const merged = Array.from(byId.values());

    // 5) members
    const finalGroups = merged.map((g) => {
      const gid = String(g.id);

      const membersFromTable = (grpMembers || [])
        .filter((m) => String(m.groupId) === gid)
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
        .map((m) => ({
          id: String(m.id),
          groupId: gid,
          sortOrder: Number(m.sortOrder || 0),
          displayName: String(m.displayName || ""),
          phone: String(m.phone || ""),
          customerId: String(m.customerId || ""),
        }));

      const membersFallback = Array.isArray(g._membersInline)
        ? g._membersInline.map((m, idx) => ({
            id: String(m.id || ""),
            groupId: gid,
            sortOrder: idx,
            displayName: String(m.displayName || ""),
            phone: String(m.phone || ""),
            customerId: String(m.customerId || ""),
          }))
        : [];

      const members = membersFromTable.length ? membersFromTable : membersFallback;

      return {
        ...g,
        kind: "group",
        group: { title: g.title, paymentMode: g.paymentMode, members },
        displayName: g.title,
        firstName: g.contactFirstName,
        lastName: g.contactLastName,
        membersCount: members.length,
      };
    });

    finalGroups.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
    setGroups(finalGroups);
  }

  useEffect(() => {
    reloadAll();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = tab === "groups" ? groups : customers;
    if (!q) return base;

    return base.filter((c) => {
      const isGroup = tab === "groups";
      const hay = [
        isGroup ? groupTitle(c) : safeName(c),
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
  }, [customers, groups, query, tab]);

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
      address: { street: c.address?.street || "", city: c.address?.city || "" },
      note: c.note || "",
      group: c.group
        ? {
            title: c.group?.title || c.displayName || "",
            paymentMode: c.group?.paymentMode || "single",
            members: Array.isArray(c.group?.members) ? c.group.members.map((m) => ({ ...m })) : [],
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

  async function deleteCustomer(id) {
    if (!id) return;

    await db.customers.delete(id).catch(() => {});
    await db.groups.delete(id).catch(() => {});

    const mem = await db.group_members.where("groupId").equals(String(id)).toArray().catch(() => []);
    await Promise.all(mem.map((m) => db.group_members.delete(m.id)));

    const hist = await db.customer_history.where("customerId").equals(id).toArray().catch(() => []);
    await Promise.all(hist.map((h) => db.customer_history.delete(h.id)));

    await reloadAll();
    closeView();
  }

  async function deleteSelected() {
    if (!selected?.id) return;
    const ok = confirm("Wirklich löschen?");
    if (!ok) return;
    await deleteCustomer(selected.id);
  }

  async function ensureNoDuplicatesBeforeSave(row) {
    const phoneDigits = onlyDigits(row.phone || "");
    const emailLower = String(row.email || "").trim().toLowerCase();

    if (phoneDigits.length < 6) {
      alert("Bitte eine gültige Telefonnummer eingeben (min. 6 Ziffern).");
      return false;
    }

    const dup = await findDuplicates({ phoneDigits, emailLower, excludeId: row.id });
    if (dup.length > 0) {
      alert("Telefonnummer oder E-Mail existiert bereits bei einem anderen Kunden/Gruppe.");
      return false;
    }
    return true;
  }

  async function saveEdit() {
    if (!editRow?.id) return;

    if (!isValidEmail(editRow.email)) {
      alert("Bitte gültige E-Mail eingeben.");
      return;
    }
    if (!isValidInstagramHandle(editRow.instagram)) {
      alert("Bitte gültigen Instagram-Handle eingeben.");
      return;
    }

    const ok = await ensureNoDuplicatesBeforeSave(editRow);
    if (!ok) return;

    const now = new Date().toISOString();

    const patch = {
      updatedAt: now,
      displayName: String(editRow.displayName || "").trim(),
      firstName: String(editRow.firstName || "").trim(),
      lastName: String(editRow.lastName || "").trim(),
      phone: onlyDigits(editRow.phone || ""),
      email: String(editRow.email || "").trim(),
      instagram: normalizeInstagram(editRow.instagram || ""),
      marketingConsent: !!editRow.marketingConsent,
      address: {
        street: String(editRow.address?.street || "").trim(),
        city: String(editRow.address?.city || "").trim(),
      },
      note: String(editRow.note || "").trim(),
    };

    if (editRow.kind === "group" && editRow.group) {
      patch.kind = "group";
      patch.group = {
        title: String(editRow.group.title || "").trim(),
        paymentMode: editRow.group.paymentMode || "single",
        members: Array.isArray(editRow.group.members)
          ? editRow.group.members.map((m) => ({
              displayName: String(m.displayName || "").trim(),
              phone: onlyDigits(m.phone || ""),
              customerId: String(m.customerId || ""),
            }))
          : [],
      };
      patch.displayName = patch.group.title || patch.displayName;

      await db.groups.put({
        id: editRow.id,
        updatedAt: now,
        title: patch.group.title,
        phone: patch.phone,
        email: patch.email,
        instagram: patch.instagram,
        paymentMode: patch.group.paymentMode,
        contactFirstName: patch.firstName,
        contactLastName: patch.lastName,
        marketingConsent: !!patch.marketingConsent,
        address: patch.address,
        note: patch.note,
      });

      const existing = await db.group_members.where("groupId").equals(String(editRow.id)).toArray().catch(() => []);
      await Promise.all(existing.map((x) => db.group_members.delete(x.id)));

      await Promise.all(
        patch.group.members.map((m, idx) =>
          db.group_members.add({
            groupId: String(editRow.id),
            sortOrder: idx,
            displayName: String(m.displayName || "").trim(),
            phone: onlyDigits(m.phone || ""),
            customerId: String(m.customerId || ""),
            createdAt: now,
            updatedAt: now,
          })
        )
      );
    } else {
      patch.kind = "profile";
    }

    await db.customers.update(editRow.id, patch);
    await reloadAll();

    setSelected((s) => (s && s.id === editRow.id ? { ...s, ...patch } : s));
    setHistory(await loadHistory(editRow.id, 120));
    setMode("view");
  }

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
        </div>
      }
    >
      <div className={styles.card}>
        <div className={styles.head}>
          <div className={styles.headLeft}>
            <div className={styles.title}>{title}</div>
            <div className={styles.sub}>Klick auf eine Zeile öffnet Details. In Details kannst du bearbeiten und löschen.</div>
          </div>
        </div>

        {tab === "groups" ? (
          <div className={styles.panelTopRow}>
            <div />
            <button
              className={styles.btnPrimary}
              type="button"
              onClick={() => nav("/register")}
              title="Neue Gruppe/Kunde anlegen"
            >
              + Neu
            </button>
          </div>
        ) : null}

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
                        <button className={styles.dangerBtn} type="button" onClick={() => openCustomer(c)}>
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

                      <div className={styles.membersCard}>
                        <div className={styles.membersHead}>
                          <div>
                            <div className={styles.membersTitle}>Mitglieder</div>
                            <div className={styles.membersSub}>Buttons sind immer sichtbar (Profil erstellen / Entfernen).</div>
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
                                      <button type="button" className={styles.btnPrimarySm} disabled>
                                        Profil erstellen
                                      </button>
                                    ) : (
                                      <button type="button" className={styles.btnNeutralSm} disabled>
                                        Profil vorhanden
                                      </button>
                                    )}

                                    {hasProfile ? (
                                      <button type="button" className={styles.btnDangerSm} disabled>
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
                        onChange={(ev) => setEditRow((p) => ({ ...p, instagram: normalizeInstagram(ev.target.value) }))}
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
                      <div className={styles.histMeta}>area: {h.areaId || "-"} · staff: {h.staffName || "-"}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
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
