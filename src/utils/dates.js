export function toDateKeyISO(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

export function toMonthKey(date = new Date()) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function monthKeyToDateRangeKeys(monthKey) {
  return { fromKey: `${monthKey}-01`, toKey: `${monthKey}-31` };
}

export function buildRecentMonthKeys(count = 6) {
  const out = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setMonth(now.getMonth() - i);
    out.push(toMonthKey(d));
  }
  return out;
}

export function yearRangeKeys(year) {
  const y = Number(year);
  return { fromKey: `${y}-01-01`, toKey: `${y}-12-31` };
}

export function currentYear() {
  return new Date().getFullYear();
}
