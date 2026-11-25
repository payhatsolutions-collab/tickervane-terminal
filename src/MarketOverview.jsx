import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { fmt, pct } from "./data.js";

const indices = [
  { symbol: "^NSEI", name: "Nifty 50", label: "Indian equities" },
  { symbol: "^NSEBANK", name: "Nifty Bank", label: "Banking sector" },
  { symbol: "^INDIAVIX", name: "India VIX", label: "Market volatility" },
  { symbol: "^GSPC", name: "S&P 500", label: "US equities" },
];

function MiniTrend({ values }) {
  const points = (values || []).filter(Number.isFinite);
  if (points.length < 2) return null;
  const low = Math.min(...points), spread = Math.max(...points) - low || 1;
  return <svg className="market-mini-trend" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
    <polyline points={points.map((value, i) => `${i / (points.length - 1) * 100},${32 - (value - low) / spread * 28}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
  </svg>;
}

export default function MarketOverview({ quotes, loading, onOpen }) {
  return <div className="market-overview">
    <div className="snapshot-caption"><span>MARKET SNAPSHOT</span><span>Quotes may be delayed</span></div>
    <div className="market-snapshot" aria-label="Market snapshot">
      {indices.map(({ symbol, name, label }) => {
        const quote = quotes[symbol];
        const known = Number.isFinite(quote?.price);
        const changeKnown = Number.isFinite(quote?.change);
        const direction = changeKnown ? quote.change >= 0 ? "positive" : "negative" : "muted";
        const Direction = quote?.change >= 0 ? ArrowUpRight : ArrowDownRight;
        const stamp = quote?.marketTime ? new Date(quote.marketTime * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
        return <button className="market-snapshot-card" key={symbol} onClick={() => onOpen(symbol)} aria-label={`Open ${name} chart`} title={stamp ? `Quote as of ${stamp} IST · may be delayed` : "Quote time unavailable"}>
          <span className="market-card-name">{name}<ArrowUpRight size={14} /></span>
          <span className="market-card-value">{known ? fmt(quote.price) : <span className={loading ? "snapshot-placeholder" : ""}>—</span>}</span>
          <span className="market-card-bottom"><span className={`market-card-change ${direction}`}>{changeKnown && <Direction size={13} />}{changeKnown ? pct(quote.change) : loading ? "Updating…" : "Quote unavailable"}</span><span className="market-card-label">{label}</span></span>
          <span className={`market-card-trend ${direction}`}><MiniTrend values={quote?.spark} /></span>
        </button>;
      })}
    </div>
  </div>;
}
