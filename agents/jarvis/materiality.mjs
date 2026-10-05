// The materiality gate (blueprint §6.3, condition 2 of the macro pipeline).
//
// This is the guard against the classic failure mode: a language model reads a
// dramatic headline, invents a market narrative, and emits an `elevated` signal
// for a 0.2% drift. Nothing here calls a model. A headline becomes material only
// when the tape agrees, on all three of:
//
//   1. MOVE       the lead instrument moved >= MIN_SIGMA standard deviations of
//                 its own trailing 20-session daily return
//   2. PUBLISHERS at least MIN_PUBLISHERS distinct outlets carried the theme
//                 inside the recency window
//   3. COHERENCE  a strict majority of the theme's linked instruments moved in
//                 the direction the theme's correlation structure predicts
//
// Failing any one of them is not an error — it is a `routine` signal. Most hours
// of most days are routine, and a system that cannot say so is not measuring
// anything.

export const MIN_SIGMA = 1.5;
export const MIN_PUBLISHERS = 2;
export const RECENCY_HOURS = 6;
export const BASELINE_SESSIONS = 20;

/**
 * Sample standard deviation of daily percentage returns.
 * Sample (n-1), not population: this is a sample of an ongoing process, and with
 * n=20 the difference is ~2.6% on sigma — enough to matter at a 1.5σ threshold.
 */
export function returnSigma(closes) {
  const series = (closes || []).filter(Number.isFinite);
  if (series.length < 3) return null;
  const returns = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] > 0) returns.push((series[i] / series[i - 1] - 1) * 100);
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  const sigma = Math.sqrt(variance);
  return sigma > 0 ? sigma : null;
}

/** How many sigma the current move represents. Null when sigma is unknowable. */
export function sigmaOf(changePct, closes) {
  const sigma = returnSigma(closes);
  if (sigma === null || !Number.isFinite(changePct)) return null;
  return changePct / sigma;
}

/** Publishers that carried the theme within the recency window. */
export function recentPublishers(items, { now = new Date(), hours = RECENCY_HOURS } = {}) {
  const cutoff = now.getTime() - hours * 3600_000;
  const seen = new Set();
  for (const item of items || []) {
    const at = Date.parse(item?.date);
    // An item with an unparseable date is kept: Google News occasionally omits
    // pubDate, and silently dropping those would bias the count downward.
    if (Number.isFinite(at) && at < cutoff) continue;
    const source = String(item?.source || '').trim();
    if (source) seen.add(source);
  }
  return [...seen];
}

/**
 * Did the linked instruments move the way this theme predicts?
 * `expected` for each is sign(lead move) * link.sign.
 */
export function coherence(leadChange, linked, quotes) {
  if (!Number.isFinite(leadChange) || leadChange === 0) {
    return { checked: 0, agreed: 0, fraction: null, detail: [] };
  }
  const leadSign = Math.sign(leadChange);
  const detail = [];
  for (const link of linked || []) {
    const change = quotes?.[link.symbol]?.change;
    if (!Number.isFinite(change) || change === 0) continue; // no data, no vote
    const expected = leadSign * Math.sign(link.sign);
    detail.push({ symbol: link.symbol, change, expected, agreed: Math.sign(change) === expected });
  }
  const agreed = detail.filter(d => d.agreed).length;
  return {
    checked: detail.length,
    agreed,
    fraction: detail.length ? agreed / detail.length : null,
    // A STRICT majority. A 1-of-2 split is a coin flip, not confirmation, and a
    // gate whose job is suppressing false positives should not accept it.
    majority: detail.length > 0 && agreed * 2 > detail.length,
    detail
  };
}

/**
 * Run the gate.
 *
 * @param {object} input
 * @param {string} input.theme
 * @param {number} input.leadChange   lead instrument's % change
 * @param {number[]} input.leadCloses trailing completed daily closes (oldest first)
 * @param {object[]} input.items      news items ({source, date, title, url})
 * @param {object[]} input.linked     [{symbol, sign}]
 * @param {object} input.quotes       symbol -> {change}
 * @returns {{material:boolean, severity:string, confidence:number, sigma:number|null,
 *            publishers:string[], coherence:object, reasons:string[], failed:string[]}}
 */
export function assess({
  theme, leadChange, leadCloses, items = [], linked = [], quotes = {}, now = new Date()
} = {}) {
  const sigma = sigmaOf(leadChange, leadCloses);
  const publishers = recentPublishers(items, { now });
  const agreement = coherence(leadChange, linked, quotes);

  const moveOk = sigma !== null && Math.abs(sigma) >= MIN_SIGMA;
  const pressOk = publishers.length >= MIN_PUBLISHERS;
  // A theme with no linked instruments carrying data cannot be confirmed or
  // refuted, so it fails closed rather than passing by default.
  const coherentOk = agreement.majority;

  const reasons = [];
  const failed = [];
  (moveOk ? reasons : failed).push(
    sigma === null
      ? 'move: sigma unavailable (insufficient history)'
      : `move: ${sigma >= 0 ? '+' : ''}${sigma.toFixed(2)}σ vs ${MIN_SIGMA}σ threshold`
  );
  (pressOk ? reasons : failed).push(
    `publishers: ${publishers.length} distinct in ${RECENCY_HOURS}h vs ${MIN_PUBLISHERS} required`
  );
  (coherentOk ? reasons : failed).push(
    agreement.fraction === null
      ? 'coherence: no linked instrument data'
      : `coherence: ${agreement.agreed}/${agreement.checked} linked instruments aligned` +
        (coherentOk ? '' : ' (needs a strict majority)')
  );

  const material = moveOk && pressOk && coherentOk;

  // Macro observations top out at `elevated`. `urgent` is reserved for things
  // that threaten a position (§4.4) and is capped at 3/day — spending that
  // budget on a commodity move would defeat the cap.
  const magnitude = Math.abs(sigma ?? 0);
  const severity = !material ? 'routine' : magnitude >= 2.5 ? 'elevated' : 'notable';

  // Confidence is a stated formula, not a model's self-report: press breadth,
  // cross-instrument agreement and move size, capped at 0.9. Nothing here
  // justifies claiming near-certainty about why a market moved.
  const confidence = material
    ? Math.min(0.9, Number((
        0.30
        + 0.10 * Math.min(publishers.length, 4)
        + 0.15 * (agreement.fraction ?? 0)
        + 0.10 * Math.min(magnitude / 3, 1)
      ).toFixed(2)))
    : Math.min(0.4, Number((0.15 + 0.05 * publishers.length).toFixed(2)));

  return {
    theme, material, severity, confidence, sigma,
    publishers, coherence: agreement, reasons, failed,
    checks: { move: moveOk, publishers: pressOk, coherence: coherentOk }
  };
}
