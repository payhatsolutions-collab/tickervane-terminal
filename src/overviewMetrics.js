// Missing observations never count as unchanged or below a moving average.
export function overviewMetrics(rows = []) {
  const changes = rows.filter(row => Number.isFinite(row.change));
  const rising = changes.filter(row => row.change > 0).length;
  const falling = changes.filter(row => row.change < 0).length;
  const trend = key => {
    const known = rows.filter(row => typeof row[key] === 'boolean');
    const above = known.filter(row => row[key]).length;
    return { known: known.length, above, percent: known.length ? above / known.length * 100 : null };
  };
  return { total: rows.length, known: changes.length, rising, falling, flat: changes.length - rising - falling,
    risingPercent: changes.length ? rising / changes.length * 100 : null,
    medium: trend('above50'), long: trend('above200') };
}
