const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function updateJournal(previous, snap) {
  const rows = structuredClone(previous);
  const r = snap.rec, shadow = r.action === 'NO TRADE', call = shadow ? r.shadow : r;
  if (snap.quotes_fresh && call?.legs?.length && call?.metrics && !rows.some(x => x.date === snap.data_time.slice(0, 10))) {
    rows.push({ date: snap.data_time.slice(0, 10), expiry: r.expiry, shadow,
      structure: call.structure, legs: call.legs, credit: call.metrics.credit,
      max_loss: call.metrics.max_loss, iv_rv: r.iv_rv, status: 'open' });
  }
  const prices = Object.fromEntries(snap.levels.spark.dates.map((d,i) => [d, snap.levels.spark.close[i]]));
  for (const row of rows) {
    if (row.status !== 'open') continue;
    const [day, mon, year] = row.expiry.split('-');
    const expiry = `${year}-${String(months.indexOf(mon)+1).padStart(2,'0')}-${day.padStart(2,'0')}`;
    if (expiry >= snap.generated.slice(0,10) || !Number.isFinite(prices[expiry])) continue;
    const settle = prices[expiry]; let pnl = 0;
    for (const leg of row.legs) {
      const payoff = Math.max(leg.right === 'CE' ? settle-leg.strike : leg.strike-settle, 0);
      pnl += leg.qty*(payoff-leg.price) - 0.75 - 0.002*leg.price - (leg.qty > 0 ? 0.00125*payoff : 0);
    }
    Object.assign(row, {status:'settled', settle, pnl_pts:pnl, R:row.max_loss > 0 ? pnl/row.max_loss : null});
  }
  return rows;
}
