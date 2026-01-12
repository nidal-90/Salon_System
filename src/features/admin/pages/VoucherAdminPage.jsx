// src/features/admin/pages/VoucherAdminPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AdminShell from "../components/AdminShell.jsx";
import Modal from "../components/Modal.jsx";
import { db } from "../../../db/index.js";
import styles from "./VoucherAdminPage.module.css";

function money(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? x.toFixed(2) : "0.00";
}

function fmtDateTime(iso) {
  const s = String(iso || "");
  if (!s) return "-";
  return s.replace("T", " ").slice(0, 16);
}

// Code: salon-friendly, no confusing chars
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I, L, O, 0, 1
function randomCodePart(len = 6) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

function normalizeCode(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

async function generateUniqueVoucherCode(prefix = "SIBEL") {
  // try a few times (collision chance is tiny)
  for (let i = 0; i < 12; i++) {
    const code = `${prefix}-${randomCodePart(6)}`;
    const exists = await db.vouchers.where("code").equals(code).first();
    if (!exists) return code;
  }
  // fallback: add timestamp-ish suffix
  const code = `${prefix}-${randomCodePart(6)}-${String(Date.now()).slice(-4)}`;
  return code;
}

function StatusPill({ status }) {
  const s = status || "active";
  const cls =
    s === "redeemed"
      ? styles.pillRedeemed
      : s === "void"
      ? styles.pillVoid
      : styles.pillActive;
  const label = s === "redeemed" ? "Eingelöst" : s === "void" ? "Storniert" : "Aktiv";
  return <span className={`${styles.pill} ${cls}`}>{label}</span>;
}

export default function VoucherAdminPage() {
  const nav = useNavigate();

  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all|active|redeemed|void

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [note, setNote] = useState("");

  // View modal
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  async function reload() {
    const list = await db.vouchers.toArray();
    list.sort((a, b) => (String(a.createdAt || "") < String(b.createdAt || "") ? 1 : -1));
    setRows(list);
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((v) => {
      if (statusFilter !== "all" && String(v.status || "active") !== statusFilter) return false;
      if (!s) return true;

      const hay = [
        v.code,
        v.status,
        v.currency,
        v.amount,
        v.createdByStaffName,
        v.createdByStaffId,
        v.note,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return hay.includes(s);
    });
  }, [rows, q, statusFilter]);

  const stats = useMemo(() => {
    const a = rows.filter((x) => x.status === "active").length;
    const r = rows.filter((x) => x.status === "redeemed").length;
    const v = rows.filter((x) => x.status === "void").length;

    const activeSum = rows
      .filter((x) => x.status === "active")
      .reduce((s, x) => s + Number(x.amount || 0), 0);

    const redeemedSum = rows
      .filter((x) => x.status === "redeemed")
      .reduce((s, x) => s + Number(x.amount || 0), 0);

    return { a, r, v, activeSum, redeemedSum };
  }, [rows]);

  function openCreate() {
    setAmount("");
    setCurrency("EUR");
    setNote("");
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
  }

  async function createVoucher() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return;

    const now = new Date().toISOString();
    const code = await generateUniqueVoucherCode("SIBEL");

    // Created-by: keep it flexible
    // If your app has a "current user" store later, you can wire it here.
    const createdByStaffId = "cashier";
    const createdByStaffName = "Kasse";

    await db.vouchers.put({
      id: crypto.randomUUID(),
      code,
      status: "active",
      amount: Number(amt.toFixed(2)),
      currency: String(currency || "EUR").toUpperCase(),
      customerId: "",

      createdAt: now,
      createdByStaffId,
      createdByStaffName,

      redeemedAt: "",
      redeemedByStaffId: "",
      redeemedByStaffName: "",
      redeemedVisitId: "",

      note: (note || "").trim(),
    });

    setCreateOpen(false);
    await reload();
  }

  function openVoucher(v) {
    setSelected(v);
    setOpen(true);
  }

  function closeVoucher() {
    setOpen(false);
    setSelected(null);
  }

  async function setStatus(v, nextStatus) {
    if (!v) return;
    const now = new Date().toISOString();

    if (nextStatus === "redeemed") {
      // mark as redeemed
      await db.vouchers.update(v.id, {
        status: "redeemed",
        redeemedAt: now,
        redeemedByStaffId: "cashier",
        redeemedByStaffName: "Kasse",
      });
    } else if (nextStatus === "void") {
      await db.vouchers.update(v.id, {
        status: "void",
      });
    } else if (nextStatus === "active") {
      // reactivate and clear redeem fields
      await db.vouchers.update(v.id, {
        status: "active",
        redeemedAt: "",
        redeemedByStaffId: "",
        redeemedByStaffName: "",
        redeemedVisitId: "",
      });
    }

    await reload();
    const refreshed = await db.vouchers.get(v.id);
    setSelected(refreshed);
  }

  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(String(code || ""));
    } catch {
      // ignore (some browsers / http)
    }
  }

  return (
    <AdminShell
      title="Gutscheine"
      subtitle="Gutscheine erstellen, Status prüfen, Einlösen/Storno. Codes werden automatisch generiert."
      right={
        <div className={styles.rightTools}>
          <button
            className={styles.backBtn}
            type="button"
            onClick={() => nav("/admin")}
            aria-label="Zurück zum Admin-Menü"
          >
            <span className={styles.backIcon}>←</span>
            <span>Admin</span>
          </button>

          <div className={styles.searchBox}>
            <input
              className={styles.search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Suche: Code, Status, Ersteller, Betrag…"
            />
          </div>

          <select
            className={styles.select}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Status Filter"
          >
            <option value="all">Alle</option>
            <option value="active">Aktiv</option>
            <option value="redeemed">Eingelöst</option>
            <option value="void">Storniert</option>
          </select>

          <button className={styles.primaryBtn} type="button" onClick={openCreate}>
            + Gutschein
          </button>
        </div>
      }
    >
      <div className={styles.grid}>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Aktiv</div>
          <div className={styles.kpiVal}>{stats.a}</div>
          <div className={styles.kpiMeta}>Summe: {money(stats.activeSum)} €</div>
        </div>

        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Eingelöst</div>
          <div className={styles.kpiVal}>{stats.r}</div>
          <div className={styles.kpiMeta}>Summe: {money(stats.redeemedSum)} €</div>
        </div>

        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Storniert</div>
          <div className={styles.kpiVal}>{stats.v}</div>
          <div className={styles.kpiMeta}>—</div>
        </div>

        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Gesamt</div>
          <div className={styles.kpiVal}>{rows.length}</div>
          <div className={styles.kpiMeta}>Alle Gutscheine</div>
        </div>

        <div className={styles.panelWide}>
          <div className={styles.panelHead}>
            <div>
              <div className={styles.panelTitle}>Liste</div>
              <div className={styles.panelSub}>
                Klick auf eine Zeile öffnet Details. Codes sind eindeutig und automatisch generiert.
              </div>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Status</th>
                  <th className={styles.right}>Betrag</th>
                  <th>Währung</th>
                  <th>Erstellt</th>
                  <th>Durch</th>
                  <th className={styles.right}>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className={styles.muted}>
                      Keine Gutscheine gefunden.
                    </td>
                  </tr>
                ) : (
                  filtered.map((v) => (
                    <tr key={v.id} className={styles.row} onClick={() => openVoucher(v)}>
                      <td className={styles.codeCell}>
                        <span className={styles.code}>{v.code}</span>
                        <button
                          type="button"
                          className={styles.copyBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            copyCode(v.code);
                          }}
                        >
                          Kopieren
                        </button>
                      </td>
                      <td>
                        <StatusPill status={v.status} />
                      </td>
                      <td className={styles.right}>
                        <b>{money(v.amount)} </b>
                      </td>
                      <td>{v.currency || "EUR"}</td>
                      <td>{fmtDateTime(v.createdAt)}</td>
                      <td className={styles.muted2}>{v.createdByStaffName || "-"}</td>
                      <td className={styles.right} onClick={(e) => e.stopPropagation()}>
                        {v.status === "active" ? (
                          <>
                            <button className={styles.ghostBtn} type="button" onClick={() => setStatus(v, "redeemed")}>
                              Einlösen
                            </button>
                            <button className={styles.dangerBtn} type="button" onClick={() => setStatus(v, "void")}>
                              Storno
                            </button>
                          </>
                        ) : v.status === "redeemed" ? (
                          <button className={styles.ghostBtn} type="button" onClick={() => setStatus(v, "active")}>
                            Reaktivieren
                          </button>
                        ) : (
                          <button className={styles.ghostBtn} type="button" onClick={() => setStatus(v, "active")}>
                            Reaktivieren
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className={styles.hint}>
              Hinweis: „Einlösen“ setzt Status auf <b>redeemed</b> inkl. Zeitstempel. „Storno“ setzt Status auf <b>void</b>.
            </div>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      <Modal
        open={createOpen}
        title="Neuen Gutschein erstellen"
        onClose={closeCreate}
        footer={
          <div className={styles.modalFooter}>
            <button className={styles.secondaryBtn} type="button" onClick={closeCreate}>
              Abbrechen
            </button>
            <button className={styles.primaryBtn} type="button" onClick={createVoucher}>
              Erstellen
            </button>
          </div>
        }
      >
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.label}>Betrag (€) *</span>
            <input
              className={styles.input}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="z. B. 50"
              inputMode="decimal"
            />
            <span className={styles.help}>Der Code wird automatisch generiert.</span>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Währung</span>
            <select className={styles.input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
            </select>
            <span className={styles.help}>Standard: EUR</span>
          </label>

          <label className={styles.fieldWide}>
            <span className={styles.label}>Notiz (optional)</span>
            <input
              className={styles.input}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="z. B. für Kunde, Anlass, interne Info…"
            />
          </label>
        </div>
      </Modal>

      {/* View Modal */}
      <Modal
        open={open}
        title={selected ? `Gutschein: ${selected.code}` : "Gutschein"}
        onClose={closeVoucher}
        footer={
          <div className={styles.modalFooter}>
            <button className={styles.secondaryBtn} type="button" onClick={closeVoucher}>
              Schließen
            </button>

            {selected?.status === "active" ? (
              <>
                <button className={styles.ghostBtn} type="button" onClick={() => copyCode(selected.code)}>
                  Code kopieren
                </button>
                <button className={styles.primaryBtn} type="button" onClick={() => setStatus(selected, "redeemed")}>
                  Einlösen
                </button>
                <button className={styles.dangerBtn} type="button" onClick={() => setStatus(selected, "void")}>
                  Storno
                </button>
              </>
            ) : (
              <button className={styles.ghostBtn} type="button" onClick={() => setStatus(selected, "active")}>
                Reaktivieren
              </button>
            )}
          </div>
        }
      >
        {selected ? (
          <div className={styles.detailGrid}>
            <div className={styles.detailBox}>
              <div className={styles.detailTitle}>Status</div>
              <div className={styles.detailValue}>
                <StatusPill status={selected.status} />
              </div>

              <div className={styles.detailTitle}>Betrag</div>
              <div className={styles.detailValue}>
                {money(selected.amount)} {selected.currency || "EUR"}
              </div>

              <div className={styles.detailTitle}>Erstellt</div>
              <div className={styles.detailValue}>{fmtDateTime(selected.createdAt)}</div>

              <div className={styles.detailTitle}>Erstellt durch</div>
              <div className={styles.detailValue}>{selected.createdByStaffName || "-"}</div>

              <div className={styles.detailTitle}>Notiz</div>
              <div className={styles.detailValueMuted}>{selected.note || "-"}</div>
            </div>

            <div className={styles.detailBox}>
              <div className={styles.detailTitle}>Einlösung</div>

              <div className={styles.detailTitle2}>Eingelöst am</div>
              <div className={styles.detailValue}>{selected.redeemedAt ? fmtDateTime(selected.redeemedAt) : "-"}</div>

              <div className={styles.detailTitle2}>Eingelöst durch</div>
              <div className={styles.detailValue}>{selected.redeemedByStaffName || "-"}</div>

              <div className={styles.detailTitle2}>Visit-Referenz</div>
              <div className={styles.detailValueMuted}>{selected.redeemedVisitId || "-"}</div>
            </div>
          </div>
        ) : null}
      </Modal>
    </AdminShell>
  );
}
