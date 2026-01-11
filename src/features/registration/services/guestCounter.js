// src/features/registration/services/guestCounter.js
import { db } from "../../../db/dexie.js";
import { initDb } from "../../../db/index.js";

function dateKeyToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Returns e.g. "Gast #12"
 * - increments per day
 * - resets automatically because daily_counters uses dateKey
 */
export async function getNextGuestDisplayName() {
  await initDb();

  const dateKey = dateKeyToday();

  // transaction to be safe against double clicks
  return await db.transaction("rw", db.daily_counters, async () => {
    const row = await db.daily_counters.get(dateKey);

    if (!row) {
      await db.daily_counters.put({ dateKey, guestNextNumber: 2 });
      return "Gast #1";
    }

    const next = Number(row.guestNextNumber || 1);
    await db.daily_counters.put({ dateKey, guestNextNumber: next + 1 });
    return `Gast #${next}`;
  });
}
