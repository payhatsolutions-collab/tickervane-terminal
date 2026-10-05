// Cash-equity planning only: one share per unit, no leverage or contract multipliers.
export function sizeTrade({capital, riskPct, entry, stop, target, side = 'long', costs = 0}) {
  const values = [capital, riskPct, entry, stop, target, costs].map(Number);
  const [account, risk, e, s, t, c] = values;
  if (!values.every(Number.isFinite) || account <= 0 || risk <= 0 || risk > 100 || e <= 0 || s <= 0 || t <= 0 || c < 0) return {error:'Enter positive capital, risk %, entry, stop and target. Costs cannot be negative.'};
  if (!['long','short'].includes(side)) return {error:'Choose long or short.'};
  const direction = side === 'long' ? 1 : -1;
  const distance = (e - s) * direction, reward = (t - e) * direction;
  if (distance <= 0 || reward <= 0) return {error:side === 'long' ? 'Long setup: stop < entry < target.' : 'Short setup: target < entry < stop.'};
  const budget = account * risk / 100;
  const riskUnits = Math.floor((budget - c) / distance);
  const cashUnits = Math.floor((account - c) / e);
  const quantity = Math.max(0, Math.min(riskUnits, cashUnits));
  if (!Number.isSafeInteger(quantity) || quantity < 1) return {error:'Budget is too small for one share after estimated costs.'};
  const plannedRisk = quantity * distance + c, plannedReward = quantity * reward - c;
  if (plannedReward <= 0) return {error:'Estimated costs exceed the target profit.'};
  return {quantity, budget, plannedRisk, plannedReward, notional:quantity * e, rr:plannedReward / plannedRisk, riskPct:plannedRisk / account * 100, cashLimited:cashUnits < riskUnits};
}

export function tradeOutcome(trade, exit, fees = 0) {
  exit = Number(exit); fees = Number(fees);
  if (!Number.isFinite(exit) || exit <= 0 || !Number.isFinite(fees) || fees < 0 || !Number.isFinite(trade.quantity) || trade.quantity <= 0 || !Number.isFinite(trade.entry) || trade.entry <= 0 || !['long','short'].includes(trade.side)) return null;
  const gross = (exit - trade.entry) * (trade.side === 'short' ? -1 : 1) * trade.quantity;
  const net = gross - fees;
  return {gross, net, r:trade.plannedRisk > 0 ? net / trade.plannedRisk : null};
}

export function completedDailyBars(bars, timezone = 'Asia/Kolkata', now = new Date()) {
  let today;
  try { today = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now); } catch { return []; }
  return (bars || []).filter(b => typeof b.time === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.time) && b.time < today);
}

export function dailyLevels(bars) {
  const valid = (bars || []).filter(b => [b.high,b.low,b.close].every(Number.isFinite) && b.high >= b.low && b.low > 0);
  if (valid.length !== (bars || []).length || valid.length < 21) return null;
  const last = valid.at(-1), window = valid.slice(-20);
  const trs = valid.slice(1).map((b,i) => Math.max(b.high-b.low,Math.abs(b.high-valid[i].close),Math.abs(b.low-valid[i].close)));
  let atr = trs.slice(0,14).reduce((a,b)=>a+b,0)/14;
  for (const tr of trs.slice(14)) atr = (atr * 13 + tr) / 14;
  return {date:last.time, high:last.high, low:last.low, close:last.close, high20:Math.max(...window.map(b=>b.high)), low20:Math.min(...window.map(b=>b.low)), atr, ...pivots(last)};
}

// Classic floor pivots and Central Pivot Range from the last completed session.
export function pivots({high, low, close}) {
  if (![high,low,close].every(Number.isFinite) || high < low || low <= 0) return {};
  const p = (high + low + close) / 3, mid = (high + low) / 2, other = 2 * p - mid, range = high - low;
  const tc = Math.max(mid, other), bc = Math.min(mid, other), cprWidth = (tc - bc) / p * 100;
  return {pivot:p, r1:2*p-low, s1:2*p-high, r2:p+range, s2:p-range, tc, bc, cprWidth, cprLabel:cprWidth < 0.25 ? 'Narrow' : cprWidth > 0.75 ? 'Wide' : 'Normal'};
}

// NSE cash-equity statutory charges (FY26 schedule). Brokerage is per executed order;
// intraday brokerage is capped at 0.03% of the order value, discount-broker style.
export const CHARGE_RATES = {stt:{delivery:[0.001,0.001], intraday:[0,0.00025]}, stamp:{delivery:0.00015, intraday:0.00003}, txn:0.0000297, sebi:0.000001, gst:0.18, dp:15.93, brokeragePct:0.0003};
export function indianCharges({product = 'delivery', quantity, buy, sell, brokerage = 20}) {
  const R = CHARGE_RATES, q = Number(quantity), fee = Number(brokerage), b = Number(buy) * q, s = Number(sell) * q;
  if (!(q > 0) || !(b > 0) || !(s > 0) || !(fee >= 0) || !R.stt[product]) return null;
  const order = v => product === 'intraday' ? Math.min(fee, v * R.brokeragePct) : fee;
  const brokerageTotal = order(b) + order(s), stt = b * R.stt[product][0] + s * R.stt[product][1];
  const txn = (b + s) * R.txn, sebi = (b + s) * R.sebi, stamp = b * R.stamp[product];
  const gst = (brokerageTotal + txn + sebi) * R.gst, dp = product === 'delivery' ? R.dp : 0;
  return {brokerage:brokerageTotal, stt, txn, sebi, stamp, gst, dp, total:brokerageTotal + stt + txn + sebi + stamp + gst + dp};
}

// Size with charges that scale with quantity: the largest whole-share size whose loss at the
// stop (including charges and slippage) fits the risk budget and whose outlay fits capital.
export function planTrade(p) {
  if (!p.product || p.product === 'manual') return {...sizeTrade(p), auto:false};
  const extra = Number(p.slippage || 0), side = p.side || 'long';
  const base = sizeTrade({...p, costs:extra});
  if (base.error) return base;
  const [account, risk, e, s, t] = [p.capital, p.riskPct, p.entry, p.stop, p.target].map(Number);
  const dir = side === 'long' ? 1 : -1, distance = (e - s) * dir, reward = (t - e) * dir, budget = account * risk / 100;
  const charge = (q, exit) => indianCharges({product:p.product, quantity:q, brokerage:p.brokerage ?? 20, ...(side === 'long' ? {buy:e, sell:exit} : {buy:exit, sell:e})});
  const cost = (q, exit) => (charge(q, exit)?.total ?? Infinity) + extra;
  const fitsRisk = q => q * distance + cost(q, s) <= budget, fitsCash = q => q * e + cost(q, s) <= account;
  let lo = 0, hi = base.quantity;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fitsRisk(mid) && fitsCash(mid)) lo = mid; else hi = mid - 1; }
  if (lo < 1) return {error:'Budget is too small for one share after charges.'};
  const stopCosts = cost(lo, s), targetCosts = cost(lo, t), plannedRisk = lo * distance + stopCosts, plannedReward = lo * reward - targetCosts;
  if (plannedReward <= 0) return {error:'Charges exceed the target profit.'};
  return {quantity:lo, budget, plannedRisk, plannedReward, notional:lo * e, rr:plannedReward / plannedRisk, riskPct:plannedRisk / account * 100,
    cashLimited:fitsRisk(lo + 1) && !fitsCash(lo + 1), costs:stopCosts, targetCosts, breakdown:charge(lo, t), auto:true};
}

// Currency-neutral performance in R multiples across closed trades.
export function journalStats(entries) {
  const closed = (entries || []).filter(t => t.status === 'closed').sort((a, b) => (Date.parse(a.closedAt) || 0) - (Date.parse(b.closedAt) || 0));
  const rs = closed.map(t => tradeOutcome(t, t.exit, t.fees)?.r).filter(Number.isFinite);
  if (!rs.length) return null;
  const wins = rs.filter(r => r > 0), losses = rs.filter(r => r <= 0), sum = xs => xs.reduce((a, b) => a + b, 0);
  let streak = 0, maxLossStreak = 0, peak = 0, equity = 0, maxDrawdown = 0;
  for (const r of rs) { streak = r <= 0 ? streak + 1 : 0; maxLossStreak = Math.max(maxLossStreak, streak); equity += r; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity); }
  return {trades:rs.length, winRate:wins.length / rs.length * 100, expectancy:sum(rs) / rs.length, totalR:sum(rs), avgWin:wins.length ? sum(wins) / wins.length : null, avgLoss:losses.length ? sum(losses) / losses.length : null,
    profitFactor:sum(losses) < 0 ? sum(wins) / -sum(losses) : null, maxLossStreak, maxDrawdown};
}

export function validJournalEntry(t) {
  if (!t || typeof t.id !== 'string' || typeof t.symbol !== 'string' || typeof t.currency !== 'string' || !['planned','open','closed','cancelled'].includes(t.status)) return false;
  if (![t.entry,t.stop,t.target,t.quantity,t.plannedRisk].every(n=>Number.isFinite(n)&&n>0) || !Number.isSafeInteger(t.quantity) || !['long','short'].includes(t.side)) return false;
  if (t.side==='long' ? !(t.stop<t.entry&&t.entry<t.target) : !(t.target<t.entry&&t.entry<t.stop)) return false;
  return t.status !== 'closed' || tradeOutcome(t,t.exit,t.fees) !== null;
}
