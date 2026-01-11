import { useEffect, useMemo, useState } from "react";
import { db } from "../../../db/index.js";
import styles from "./StaffAdminPage.module.css";

function money(n) {
  const x = Number(n || 0);
  return x.toFixed(2);
}

function toMonthKey(dateKey) {
  return String(dateKey || "").slice(0, 7);
}

function monthKeysBack(count = 6) {
  const d = new Date();
  const out = [];
  for (let i = 0; i < count; i++) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const mk = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
    out.push(mk);
  }
  return out.reverse();
}

async function sumStaffRevenueForMonth(staffId, monthKey) {
  const fromKey = `${monthKey}-01`;
  const toKey = `${monthKey}-31`;

  // Services
  const services = await db.visit_services
    .where("[staffId+dateKey]")
    .between([staffId, fromKey], [staffId, toKey], true, true)
    .toArray();

  const products = await db.visit_products
    .where("[staffId+dateKey]")
    .between([staffId, fromKey], [staffId, toKey], true, true)
    .toArray();

  const manual = await db.manual_sales
    .where("[monthKey+staffId]")
    .equals([monthKey, staffId])
    .toArray()
    .catch(() => []);

  const serviceSum = services.reduce((s, r) => s + Number(r.price || 0), 0);
  const productSum = products.reduce((s, r) => s + Number(r.price || 0) * Number(r.qty || 1), 0);
  const manualSum = manual.reduce((s, r) => s + Number(r.amount || 0), 0);

  return {
    serviceSum,
    productSum,
    manualSum,
    total: serviceSum + productSum + manualSum,
    serviceCount: services.length,
    productCount: products.length,
  };
}

async function sumAdvancesForMonth(staffId, monthKey) {
  const fromKey = `${monthKey}-01`;
  const toKey = `${monthKey}-31`;

  const rows = await db.advances
    .where("[staffId+dateKey]")
    .between([staffId, fromKey], [staffId, toKey], true, true)
    .toArray()
    .catch(() => []);

  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  return { total, rows };
}

export default function StaffAdminPage() {
  const [staff, setStaff] = useState([]);
  const [q, setQ] = useState("");

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  const [absences, setAbsences] = useState([]);
  const [advances, setAdvances] = useState([]);

  // Edit fields
  const [editName, setEditName] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editCommissionPct, setEditCommissionPct] = useState(100);
  const [editBaseSalary, setEditBaseSalary] = useState(0);
  const [editYearlyVacationDays, setEditYearlyVacationDays] = useState(20);

  // Add absence
  const [absenceType, setAbsenceType] = useState("vacation");
  const [absenceDate, setAbsenceDate] = useState(new Date().toISOString().slice(0, 10));

  // Add advance
  const [advAmount, setAdvAmount] = useState("");
  const [advNote, setAdvNote] = useState("");

  const [months] = useState(() => monthKeysBack(6));
  const [monthRows, setMonthRows] = useState([]);

  async function reloadStaff() {
    const rows = await db.staff.toArray();
    rows.sort((a, b) => {
      const ao = Number(a.sortOrder ?? 9999);
      const bo = Number(b.sortOrder ?? 9999);
      if (ao !== bo) return ao - bo;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    setStaff(rows);
  }

  useEffect(() => {
    reloadStaff();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return staff;
    return staff.filter((x) => String(x.name || "").toLowerCase().includes(s));
  }, [q, staff]);

  async function openDialog(emp) {
    setSelected(emp);
    setEditName(emp.name || "");
    setEditActive(Number(emp.active) === 1);
    setEditCommissionPct(Number(emp.commissionPct ?? 100));
    setEditBaseSalary(Number(emp.baseSalary ?? 0));
    setEditYearlyVacationDays(Number(emp.yearlyVacationDays ?? 20));

    const [abs, adv] = await Promise.all([
      db.absences.where("staffId").equals(emp.id).toArray(),
      db.advances.where("staffId").equals(emp.id).toArray(),
    ]);

    abs.sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
    adv.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    setAbsences(abs);
    setAdvances(adv);

    // Monats-Report vorbereiten
    const rows = [];
    for (const mk of months) {
      const rev = await sumStaffRevenueForMonth(emp.id, mk);
      const advM = await sumAdvancesForMonth(emp.id, mk);

      const pct = Math.max(0, Math.min(100, Number(emp.commissionPct ?? 100)));
      const commission = (rev.total * pct) / 100;

      const baseSalary = Number(emp.baseSalary || 0);
      const net = commission + baseSalary - advM.total;

      rows.push({
        monthKey: mk,
        revenue: rev.total,
        commission,
        baseSalary,
        advances: advM.total,
        net,
        details: rev,
      });
    }
    setMonthRows(rows);

    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
    setSelected(null);
    setAdvAmount("");
    setAdvNote("");
  }

  async function save() {
    if (!selected) return;
    const name = editName.trim();
    if (!name) return;

    const commissionPct = Math.max(0, Math.min(100, Number(editCommissionPct)));
    const baseSalary = Number(editBaseSalary || 0);
    const yearlyVacationDays = Math.max(0, Math.floor(Number(editYearlyVacationDays || 20)));

    await db.staff.update(selected.id, {
      name,
      active: editActive ? 1 : 0,
      commissionPct,
      baseSalary: Number(Number.isFinite(baseSalary) ? baseSalary.toFixed(2) : 0),
      yearlyVacationDays,
    });

    await reloadStaff();
    const refreshed = await db.staff.get(selected.id);
    setSelected(refreshed);
    setOpen(false);
  }

  async function toggleActive(emp) {
    const next = Number(emp.active) === 1 ? 0 : 1;
    await db.staff.update(emp.id, { active: next });
    await reloadStaff();
  }

  async function deleteEmp(emp) {
    await db.staff.delete(emp.id);

    // abhängige Daten (wie im alten Projekt)
    const [abs, adv] = await Promise.all([
      db.absences.where("staffId").equals(emp.id).toArray(),
      db.advances.where("staffId").equals(emp.id).toArray(),
    ]);
    await Promise.all(abs.map((r) => db.absences.delete(r.id)));
    await Promise.all(adv.map((r) => db.advances.delete(r.id)));

    await reloadStaff();
  }

  async function addAbsence() {
    if (!selected) return;
    const dateKey = String(absenceDate || "").slice(0, 10);
    if (!dateKey) return;

    // Duplicate verhindern (staffId+dateKey)
    const existing = await db.absences.where("[staffId+dateKey]").equals([selected.id, dateKey]).first();

    if (existing) {
      await db.absences.update(existing.id, { type: absenceType });
    } else {
      await db.absences.add({
        id: crypto.randomUUID(),
        staffId: selected.id,
        dateKey,
        type: absenceType,
        createdAt: new Date().toISOString(),
      });
    }

    const abs = await db.absences.where("staffId").equals(selected.id).toArray();
    abs.sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
    setAbsences(abs);
  }

  async function deleteAbsence(id) {
    await db.absences.delete(id);
    if (!selected) return;
    const abs = await db.absences.where("staffId").equals(selected.id).toArray();
    abs.sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
    setAbsences(abs);
  }

  async function addAdvance() {
    if (!selected) return;
    const amount = Number(advAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const now = new Date().toISOString();
    const dateKey = now.slice(0, 10);

    await db.advances.add({
      id: crypto.randomUUID(),
      staffId: selected.id,
      dateKey,
      timestamp: now,
      amount: Number(amount.toFixed(2)),
      note: advNote.trim() || "",
    });

    setAdvAmount("");
    setAdvNote("");

    const adv = await db.advances.where("staffId").equals(selected.id).toArray();
    adv.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    setAdvances(adv);
  }

  async function deleteAdvance(id) {
    await db.advances.delete(id);
    if (!selected) return;
    const adv = await db.advances.where("staffId").equals(selected.id).toArray();
    adv.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    setAdvances(adv);
  }

  const currentYear = new Date().getFullYear();
  const absenceSummary = useMemo(() => {
    const fromKey = `${currentYear}-01-01`;
    const toKey = `${currentYear}-12-31`;
    const inYear = absences.filter((a) => a.dateKey >= fromKey && a.dateKey <= toKey);
    const vacationUsed = inYear.filter((a) => a.type === "vacation").length;
    const sickUsed = inYear.filter((a) => a.type === "sick").length;

    const allowed = Math.max(0, Number(editYearlyVacationDays || 20));
    const remaining = Math.max(0, allowed - vacationUsed);

    return { year: currentYear, vacationUsed, sickUsed, allowed, remaining };
  }, [absences, editYearlyVacationDays, currentYear]);

  const advancesTotal = useMemo(() => {
    return advances.reduce((s, a) => s + Number(a.amount || 0), 0);
  }, [advances]);

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.headerRow}>
          <div>
            <h2 className={styles.title}>Mitarbeiter</h2>
            <p className={styles.sub}>
              Provision, Grundlohn, Urlaub/Krank, Vorschüsse und Monats-Auswertung pro Mitarbeiter.
            </p>
          </div>

          <div className={styles.searchBox}>
            <input
              className={styles.input}
              placeholder="Suche Mitarbeiter…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Aktiv</th>
                <th className={styles.right}>Provision</th>
                <th className={styles.right}>Grundlohn</th>
                <th className={styles.right}>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.muted}>Keine Mitarbeiter gefunden.</td>
                </tr>
              ) : (
                filtered.map((emp) => (
                  <tr key={emp.id} className={styles.row} onClick={() => openDialog(emp)}>
                    <td className={styles.nameCell}>{emp.name}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <label className={styles.switch}>
                        <input
                          type="checkbox"
                          checked={Number(emp.active) === 1}
                          onChange={() => toggleActive(emp)}
                        />
                        <span />
                      </label>
                    </td>
                    <td className={styles.right}>{Number(emp.commissionPct ?? 100).toFixed(0)}%</td>
                    <td className={styles.right}>{money(emp.baseSalary)} €</td>
                    <td className={styles.right} onClick={(e) => e.stopPropagation()}>
                      <button className={styles.dangerBtn} onClick={() => deleteEmp(emp)}>Löschen</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className={styles.hint}>
            Tipp: Klick auf eine Zeile öffnet Details (Urlaub/Krank, Vorschüsse, Monats-Umsatz inkl. Provision).
          </div>
        </div>
      </div>

      {/* Dialog */}
      {open && selected ? (
        <div className={styles.modalOverlay} onMouseDown={closeDialog}>
          <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalTitle}>Mitarbeiter: {selected.name}</div>
                <div className={styles.modalSub}>Monate: {months.join(" • ")}</div>
              </div>
              <button className={styles.closeBtn} onClick={closeDialog}>✕</button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.grid2}>
                <div className={styles.panel}>
                  <div className={styles.panelTitle}>Stammdaten</div>

                  <label className={styles.label}>Name</label>
                  <input className={styles.input} value={editName} onChange={(e) => setEditName(e.target.value)} />

                  <div className={styles.rowBetween}>
                    <div className={styles.label}>Aktiv</div>
                    <label className={styles.switch}>
                      <input type="checkbox" checked={!!editActive} onChange={() => setEditActive((v) => !v)} />
                      <span />
                    </label>
                  </div>

                  <label className={styles.label}>Provision (%)</label>
                  <input
                    className={styles.input}
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={editCommissionPct}
                    onChange={(e) => setEditCommissionPct(e.target.value)}
                  />

                  <label className={styles.label}>Grundlohn (Monat, €)</label>
                  <input
                    className={styles.input}
                    type="number"
                    step="0.01"
                    value={editBaseSalary}
                    onChange={(e) => setEditBaseSalary(e.target.value)}
                  />

                  <label className={styles.label}>Urlaubstage/Jahr</label>
                  <input
                    className={styles.input}
                    type="number"
                    min="0"
                    step="1"
                    value={editYearlyVacationDays}
                    onChange={(e) => setEditYearlyVacationDays(e.target.value)}
                  />
                </div>

                <div className={styles.panel}>
                  <div className={styles.panelTitle}>Abwesenheiten ({absenceSummary.year})</div>

                  <div className={styles.statsRow}>
                    <div className={styles.statBox}>
                      <div className={styles.statLabel}>Urlaub genommen</div>
                      <div className={styles.statValue}>{absenceSummary.vacationUsed}</div>
                    </div>
                    <div className={styles.statBox}>
                      <div className={styles.statLabel}>Urlaub verfügbar</div>
                      <div className={styles.statValue}>{absenceSummary.remaining}</div>
                    </div>
                    <div className={styles.statBox}>
                      <div className={styles.statLabel}>Kranktage</div>
                      <div className={styles.statValue}>{absenceSummary.sickUsed}</div>
                    </div>
                  </div>

                  <div className={styles.inlineForm}>
                    <select className={styles.input} value={absenceType} onChange={(e) => setAbsenceType(e.target.value)}>
                      <option value="vacation">Urlaub</option>
                      <option value="sick">Krank</option>
                    </select>

                    <input
                      className={styles.input}
                      type="date"
                      value={absenceDate}
                      onChange={(e) => setAbsenceDate(e.target.value)}
                    />

                    <button className={styles.btn} onClick={addAbsence}>Hinzufügen</button>
                  </div>

                  <div className={styles.chips}>
                    {absences.slice(0, 18).map((a) => (
                      <button key={a.id} className={styles.chip} onClick={() => deleteAbsence(a.id)}>
                        {a.dateKey} • {a.type === "vacation" ? "Urlaub" : "Krank"} (x)
                      </button>
                    ))}
                    {absences.length > 18 ? <div className={styles.muted}>+{absences.length - 18} weitere</div> : null}
                  </div>
                </div>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelTitle}>Monatsübersicht (Umsatz / Provision / Auszahlung)</div>

                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Monat</th>
                        <th className={styles.right}>Umsatz</th>
                        <th className={styles.right}>Provision</th>
                        <th className={styles.right}>Grundlohn</th>
                        <th className={styles.right}>Vorschüsse</th>
                        <th className={styles.right}>Netto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthRows.map((r) => (
                        <tr key={r.monthKey}>
                          <td>{r.monthKey}</td>
                          <td className={styles.right}>{money(r.revenue)} €</td>
                          <td className={styles.right}>{money(r.commission)} €</td>
                          <td className={styles.right}>{money(r.baseSalary)} €</td>
                          <td className={styles.right}>{money(r.advances)} €</td>
                          <td className={styles.right}><b>{money(r.net)} €</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className={styles.hint}>
                    Umsatz = Services + Produkte (+ optional manuelle Umsätze). Provision = Umsatz * Provision(%).
                    Netto = Provision + Grundlohn − Vorschüsse (Monat).
                  </div>
                </div>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelTitle}>Vorschüsse</div>

                <div className={styles.inlineForm}>
                  <input
                    className={styles.input}
                    type="number"
                    step="0.01"
                    placeholder="Betrag (€)"
                    value={advAmount}
                    onChange={(e) => setAdvAmount(e.target.value)}
                  />
                  <input
                    className={styles.input}
                    placeholder="Notiz"
                    value={advNote}
                    onChange={(e) => setAdvNote(e.target.value)}
                  />
                  <button className={styles.btn} onClick={addAdvance}>Vorschuss buchen</button>

                  <div className={styles.totalChip}>Summe: {money(advancesTotal)} €</div>
                </div>

                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Datum</th>
                        <th>Notiz</th>
                        <th className={styles.right}>Betrag</th>
                        <th className={styles.right}>Aktion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {advances.length === 0 ? (
                        <tr>
                          <td colSpan={4} className={styles.muted}>Keine Vorschüsse erfasst.</td>
                        </tr>
                      ) : (
                        advances.slice(0, 30).map((a) => (
                          <tr key={a.id}>
                            <td>{String(a.dateKey || "").slice(0, 10)}</td>
                            <td className={styles.muted}>{a.note || ""}</td>
                            <td className={styles.right}>{money(a.amount)} €</td>
                            <td className={styles.right}>
                              <button className={styles.dangerBtn} onClick={() => deleteAdvance(a.id)}>Löschen</button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>

                  {advances.length > 30 ? (
                    <div className={styles.hint}>Anzeige begrenzt auf 30 Einträge (Performance).</div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.secondaryBtn} onClick={closeDialog}>Schließen</button>
              <button className={styles.primaryBtn} onClick={save}>Speichern</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
