// Reuse formatters across quote refreshes; keep the existing locale and precision.
const decimals = new Map();
const compactFormatter = new Intl.NumberFormat('en', {
  notation: 'compact', maximumFractionDigits: 1,
});

export function fmt(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  let formatter = decimals.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    });
    decimals.set(digits, formatter);
  }
  return formatter.format(value);
}

export const compact = value => Number.isFinite(value) ? compactFormatter.format(value) : '—';
