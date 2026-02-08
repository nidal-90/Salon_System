const DATE_KEY = "guest_counter_date";
const COUNT_KEY = "guest_counter_value";

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function nextGuestDisplayName() {
  const dateKey = toDateKeyISO(new Date());

  // Count guest visits today (robust, deletion-safe)
  const today = await db.visits.where("dateKey").equals(dateKey).toArray().catch(() => []);
  const guestCount = (today || []).filter((v) => String(v?.type || "").toLowerCase() === "guest").length;

  return `Gast ${guestCount + 1}`;
}
