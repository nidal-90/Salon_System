const DATE_KEY = "guest_counter_date";
const COUNT_KEY = "guest_counter_value";

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function getNextGuestDisplayName() {
  const today = todayKey();
  const savedDate = localStorage.getItem(DATE_KEY);

  if (savedDate !== today) {
    localStorage.setItem(DATE_KEY, today);
    localStorage.setItem(COUNT_KEY, "0");
  }

  const cur = Number(localStorage.getItem(COUNT_KEY) || "0");
  const next = cur + 1;
  localStorage.setItem(COUNT_KEY, String(next));

  return `Gast #${next}`;
}
