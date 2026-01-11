export function asMoney(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

export function money(n) {
  return Number(n || 0).toFixed(2);
}
