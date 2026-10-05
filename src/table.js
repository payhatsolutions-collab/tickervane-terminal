export function sortRows(rows, [key, dir]) {
  return [...rows].sort((a, b) => {
    const av = a[key],
      bv = b[key];
    const absent = (value) =>
      value == null || (typeof value === "number" && !Number.isFinite(value));
    if (absent(av) && absent(bv)) return 0;
    if (absent(av)) return 1;
    if (absent(bv)) return -1;
    if (typeof av === "number" && typeof bv === "number")
      return dir * (av - bv);
    if (typeof av === "boolean" && typeof bv === "boolean")
      return dir * (Number(av) - Number(bv));
    return dir * String(av).localeCompare(String(bv));
  });
}
