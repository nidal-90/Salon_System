// src/db/seeds.js
import { db } from "./index.js";

const TEST_STAFF = [
  { name: "SIBEL", commissionPct: 100, baseSalary: 0 },
  { name: "MUGDET", commissionPct: 100, baseSalary: 0 },
  { name: "BERKAN", commissionPct: 50, baseSalary: 629.8 },
  { name: "SINAN", commissionPct: 50, baseSalary: 0 },
  { name: "LIDA", commissionPct: 70, baseSalary: 528.7 },
  { name: "LETI", commissionPct: 30, baseSalary: 906.12 },
  { name: "CEREN", commissionPct: 35, baseSalary: 0 },
  { name: "EMIR", commissionPct: 25, baseSalary: 680 },
  { name: "MERT", commissionPct: 35, baseSalary: 0 },
  { name: "HÜSO", commissionPct: 50, baseSalary: 2909 },
  { name: "GÜRKAN", commissionPct: 100, baseSalary: 2288.45 },
  { name: "MEHMET", commissionPct: 35, baseSalary: 2500 },
  { name: "SAAD", commissionPct: 40, baseSalary: 326.92 },
  { name: "UMAR", commissionPct: 100, baseSalary: 850 },
  { name: "GYLHAN", commissionPct: 100, baseSalary: 775 },
  { name: "ONUR", commissionPct: 100, baseSalary: 0 },
  { name: "SEMRA", commissionPct: 40, baseSalary: 584 },
  { name: "HOSSAIN", commissionPct: 35, baseSalary: 584 },
  { name: "MERCAN", commissionPct: 35, baseSalary: 0 },
];

function asMoney(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

export async function seedIfEmpty() {
  const [areasCount, staffCount, catCount] = await Promise.all([
    db.areas.count(),
    db.staff.count(),
    db.product_categories.count(),
  ]);

  // Areas
  if (areasCount === 0) {
    await db.areas.bulkPut([
      { id: crypto.randomUUID(), displayNo: 1, name: "Haarschnitt Damen", active: 1, code: "", sortOrder: 0 },
      { id: crypto.randomUUID(), displayNo: 2, name: "Haarschnitt Herren", active: 1, code: "", sortOrder: 0 },
      { id: crypto.randomUUID(), displayNo: 3, name: "Farbe", active: 1, code: "", sortOrder: 0 },
      { id: crypto.randomUUID(), displayNo: 4, name: "Make-up", active: 1, code: "", sortOrder: 0 },
      { id: crypto.randomUUID(), displayNo: 5, name: "Augenbrauen", active: 1, code: "", sortOrder: 0 },
      { id: crypto.randomUUID(), displayNo: 6, name: "SPA", active: 1, code: "", sortOrder: 0 },
    ]);
  }

  // Product categories
  if (catCount === 0) {
    await db.product_categories.bulkPut([
      { id: crypto.randomUUID(), displayNo: 1, title: "HairCare", active: 1, sortOrder: 0 },
      { id: crypto.randomUUID(), displayNo: 2, title: "Beauty", active: 1, sortOrder: 0 },
    ]);
  }

  // Staff
  if (staffCount === 0) {
    const rows = TEST_STAFF.map((s, idx) => ({
      id: crypto.randomUUID(),
      name: s.name,
      active: 1,
      role: "staff",
      usbKeyId: "",
      areaIds: [],
      sortOrder: idx + 1,
      commissionPct: Number(s.commissionPct ?? 100),
      baseSalary: asMoney(s.baseSalary ?? 0),
      yearlyVacationDays: 20,
    }));

    rows.unshift({
      id: crypto.randomUUID(),
      name: "Admin",
      active: 1,
      role: "admin",
      usbKeyId: "admin_key_1",
      areaIds: [],
      sortOrder: 0,
      commissionPct: 0,
      baseSalary: 0,
      yearlyVacationDays: 0,
    });

    rows.unshift({
      id: crypto.randomUUID(),
      name: "Kasse",
      active: 1,
      role: "cashier",
      usbKeyId: "cash_key_1",
      areaIds: [],
      sortOrder: -1,
      commissionPct: 0,
      baseSalary: 0,
      yearlyVacationDays: 0,
    });

    await db.staff.bulkPut(rows);
  }
}
