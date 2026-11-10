// Transparent research heuristics, independent of the selected chart range.
const scale = (value, low, high) => Number.isFinite(value)
  ? Math.max(0, Math.min(100, (value - low) / (high - low) * 100))
  : null;

export function chartScores(signal, fund) {
  const technical = signal?.rules?.length === 5 && Number.isFinite(signal.score)
    ? Math.round(scale(signal.score, -5, 5)) : null;
  const inputs = [
    scale(fund?.revenueGrowth, -0.1, 0.2),
    scale(fund?.earningsGrowth, -0.1, 0.2),
    scale(fund?.roe, 0, 0.25),
  ].filter(Number.isFinite);
  const fundamental = inputs.length >= 2
    ? Math.round(inputs.reduce((sum, value) => sum + value, 0) / inputs.length) : null;
  const alphaNova = technical !== null && fundamental !== null
    ? Math.round((technical + fundamental) / 2) : null;
  return { alphaNova, technical, fundamental, fundamentalInputs: inputs.length };
}
