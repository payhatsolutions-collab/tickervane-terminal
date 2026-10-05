// Prevent spreadsheet software from executing text cells as formulas.
// Numeric losses remain numbers; only string values receive the prefix.
export function serializeCSV(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const safe =
            typeof value === "string" && /^\s*[=+@\-\t\r]/.test(value)
              ? "'" + value
              : (value ?? "");
          return '"' + String(safe).replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\n");
}
