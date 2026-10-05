import { useMemo, useState } from "react";
import { Bell, ChevronDown, Plus, Star, Trash2, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { directory, fmt, pct, short } from "./data.js";
import { tone } from "./ui.jsx";
import { ViewLink } from "./Onboarding.jsx";
import { CandlestickPreview } from "./ScreenChart.jsx";
import { useChartPreview } from "./useChartPreview.js";
import { signalSnapshot } from "./marketMath.js";
import { completedDailyBars } from "./tradeMath.js";
import { SCREEN_CHART_RANGES } from "./screenerChartMath.js";

function WatchlistRow({ symbol, quote, range, refresh, onNavigate, onToggle, onAlert }) {
  const { host, feed, onRetry } = useChartPreview(symbol, refresh);
  const dailyBars = useMemo(() => completedDailyBars(feed.data?.bars, feed.data?.timezone || "Asia/Kolkata"), [feed.data]);
  const signal = useMemo(() => signalSnapshot(dailyBars), [dailyBars]);
  const available = signal.rules.length > 0;
  const signalTone = signal.verdict === "Bullish" ? "positive" : signal.verdict === "Bearish" ? "negative" : "muted";
  const SignalIcon = signal.verdict === "Bullish" ? TrendingUp : signal.verdict === "Bearish" ? TrendingDown : Minus;
  return <article ref={host}>
    <div className="saved-watchlist-stock"><ViewLink page="Terminal" symbol={symbol} onNavigate={onNavigate}>{short(symbol)}</ViewLink><span>{directory.get(symbol)?.name || symbol}</span></div>
    <div className="saved-watchlist-price"><strong>{fmt(quote?.price)} <small>{quote?.currency || ""}</small></strong><span className={tone(quote?.change)}>{pct(quote?.change)} <small>today</small></span></div>
    <div className="saved-watchlist-signal" aria-busy={feed.loading}>
      {available ? <details>
        <summary><span className={`watch-signal-badge ${signalTone}`}><SignalIcon size={14} />{signal.verdict}<span className="number">{signal.score > 0 ? "+" : ""}{signal.score}</span></span><ChevronDown size={13} /></summary>
        <div className="watch-signal-rules">{signal.rules.map(rule => <div key={rule.label}><span>{rule.label}</span><strong className={tone(rule.bias)}>{rule.reading}</strong></div>)}<p>Score −5 to +5 · Bullish ≥ +2 · Bearish ≤ −2.</p></div>
      </details> : <span className="watch-signal-placeholder">{feed.loading ? "Loading signal…" : feed.error ? "Signal unavailable" : "Not enough data"}</span>}
      <span className="watch-signal-date">{available ? `Daily · ${dailyBars.at(-1).time}` : !feed.loading && !feed.error ? "Needs 70 completed sessions" : "Daily trend bias"}</span>
      {feed.error && <span className="watch-signal-status" title={feed.error}>{feed.data ? "Cached data · " : ""}<button className="link" onClick={onRetry}>Retry</button></span>}
      {feed.loading && available && <span className="watch-signal-status">Refreshing…</span>}
    </div>
    <CandlestickPreview symbol={short(symbol)} range={range} feed={feed} onRetry={onRetry} />
    <div className="saved-watchlist-actions"><button className="button" onClick={() => onAlert(symbol)}><Bell size={14} /> Set alert</button><button className="icon-button" aria-label={`Remove ${short(symbol)} from watchlist`} onClick={() => onToggle(symbol)}><Trash2 size={15} /></button></div>
  </article>;
}

export default function Watchlist({ watch, quotes, refresh = 0, onNavigate, onToggle, onSearch, onAlert, onGuide, onCopy }) {
  const [range, setRange] = useState("1M");
  return <section className="panel saved-watchlist">
    <div className="saved-watchlist-head"><div><h2><Star size={18} /> Your saved stocks</h2><p>Come back here to see what changed. Saved in this browser · {watch.length} / 40 instruments.</p></div>
      <div><button className="button" onClick={onCopy}>Copy return link</button><button className="button primary" onClick={onSearch}><Plus size={15} /> Add stock</button></div></div>
    {watch.length ? <>
      <div className="watchlist-chart-toolbar"><p>Daily technical signals · click a chart to enlarge</p><div className="segments" role="group" aria-label="Watchlist candlestick period">{Object.keys(SCREEN_CHART_RANGES).map(period => <button key={period} className={range === period ? "active" : ""} aria-pressed={range === period} onClick={() => setRange(period)}>{period}</button>)}</div></div>
      <div className="saved-watchlist-columns" aria-hidden="true"><span>Stock</span><span>Price / change</span><span>Technical signal</span><span>Candlesticks</span><span>Actions</span></div>
      <div className="saved-watchlist-rows">{watch.map(symbol => <WatchlistRow key={symbol} symbol={symbol} quote={quotes[symbol]} range={range} refresh={refresh} onNavigate={onNavigate} onToggle={onToggle} onAlert={onAlert} />)}</div>
      <p className="watchlist-signal-note">Signals use completed daily sessions and stay the same across chart periods. Candles may include today’s session. Yahoo Finance · prices may be delayed.</p>
    </> : <div className="watch-empty"><Star size={28} /><h3>Start with three stocks you want to follow.</h3><p>Save them here, then return to their charts and set relevant price alerts.</p><button className="button primary" onClick={onGuide}>Start interactive guide</button><button className="button" onClick={onSearch}>Find my own stocks</button></div>}
    <div className="saved-watchlist-foot"><ViewLink page="Alerts" onNavigate={onNavigate}>Manage price alerts</ViewLink><button className="link" onClick={onGuide}>Reopen interactive guide</button><span>Return links open your local list. Use Portfolio → Backup & restore to move it to another browser.</span></div>
  </section>;
}
