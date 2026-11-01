// Describe observed session performance, never a forecast or trade instruction.
export function marketMood(quote) {
  const validTime = Number.isFinite(quote?.marketTime) && quote.marketTime > 0 &&
    Number.isFinite(new Date(quote.marketTime * 1000).getTime());
  if (!Number.isFinite(quote?.price) || quote.price <= 0 || !Number.isFinite(quote?.change) || !validTime)
    return { direction: "unknown", change: null, date: null, stamp: null, key: null };
  const change = Math.round(quote.change * 100) / 100;
  const date = new Date(quote.marketTime * 1000);
  const day = date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const direction = change < 0 ? "bear" : "bull";
  return {
    direction, change, key: `${day}-${direction}`,
    date: date.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }),
    stamp: date.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
  };
}
