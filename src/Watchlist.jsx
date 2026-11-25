import { lazy, Suspense, useMemo, useState } from "react";
import { useSaved } from "./hooks.js";
import { Bell, ChevronDown, Plus, Search, Star, Trash2, TrendingDown, TrendingUp, Minus } from "lucide-react";
import WatchlistShare from "./WatchlistShare.jsx";
import WatchlistBrief from "./WatchlistBrief.jsx";
import { filterWatchlist } from "./watchlistTools.js";
import { directory, fmt, pct, short } from "./data.js";
import { tone } from "./ui.jsx";
import { ViewLink } from "./Onboarding.jsx";
const CandlestickPreview = lazy(() => import("./ScreenChart.jsx").then(module => ({ default: module.CandlestickPreview })));
import { useChartPreview } from "./useChartPreview.js";
import { signalSnapshot } from "./marketMath.js";
import { completedDailyBars } from "./tradeMath.js";
import { SCREEN_CHART_RANGES } from "./screenerChartMath.js";

function WatchlistRow({ symbol, quote, range, refresh, onNavigate, onToggle, onAlert, showCharts }) {
  const { host, feed, onRetry } = useChartPreview(symbol, refresh);
  const dailyBars = useMemo(() => completedDailyBars(feed.data?.bars, feed.data?.timezone || "Asia/Kolkata"), [feed.data]);
  const signal = useMemo(() => signalSnapshot(dailyBars), [dailyBars]);
  const available = signal.rules.length > 0;
  const signalTone = signal.verdict === "Bullish" ? "positive" : signal.verdict === "Bearish" ? "negative" : "muted";
  const SignalIcon = signal.verdict === "Bullish" ? TrendingUp : signal.verdict === "Bearish" ? TrendingDown : Minus;
  return <article ref={host}>
    <div className="saved-watchlist-stock"><ViewLink page="Terminal" symbol={symbol} onNavigate={onNavigate}>{short(symbol)}</ViewLink><span>{directory.get(symbol)?.name || symbol}</span><ViewLink page="Fundamentals" symbol={symbol} onNavigate={onNavigate}>Fundamentals ↗</ViewLink></div>
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
    {showCharts && <Suspense fallback={<span className="muted">Loading chart…</span>}><CandlestickPreview symbol={short(symbol)} range={range} feed={feed} onRetry={onRetry} /></Suspense>}
    <div className="saved-watchlist-actions"><button className="button" onClick={() => onAlert(symbol)}><Bell size={14} /> Set alert</button><button className="icon-button" aria-label={`Remove ${short(symbol)} from watchlist`} onClick={() => onToggle(symbol)}><Trash2 size={15} /></button></div>
  </article>;
}

export default function Watchlist({ watch, quotes, refresh = 0, onNavigate, onToggle, onSearch, onAlert, onGuide, onCopy, onAccount, alerts }) {
  const [range, setRange] = useState("1M");
  const [showCharts, setShowCharts] = useSaved("an2-watchlist-charts", false);
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState("saved");
  const visible = filterWatchlist(watch, quotes, directory, query, order);
  return <section className={`panel saved-watchlist ${showCharts ? "with-watch-charts" : "compact-watchlist"}`}>
    <div className="saved-watchlist-head"><div><h2><Star size={18} /> Your saved stocks</h2><p>{watch.length} / 40 instruments · Saved on this device.</p></div>
      <div>{onAccount && <button className="button" onClick={onAccount}>Watchlist backup</button>}<WatchlistShare watch={watch} /><button className="button primary" onClick={onSearch}><Plus size={15} /> Add stock</button></div></div>
    {watch.length ? <>
      <details className="watchlist-pulse-details"><summary>Session summary <ChevronDown size={14} /></summary><WatchlistBrief compact watch={watch} quotes={quotes} alerts={alerts} onOpen={symbol => onNavigate({ page: "Terminal", symbol })} onPage={page => onNavigate({ page })} /></details>
      <div className="watchlist-controls"><label className="watchlist-filter"><Search size={16} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find in your watchlist" aria-label="Find in your watchlist" /></label><label className="watchlist-sort">Sort<select value={order} onChange={event => setOrder(event.target.value)}><option value="saved">Saved order</option><option value="movers">Biggest moves</option><option value="gainers">Top gainers</option><option value="decliners">Top decliners</option><option value="name">Name A–Z</option></select></label><span className="watchlist-results" role="status">{visible.length} of {watch.length}</span></div>
      <div className="watchlist-chart-toolbar"><p>Daily technical signals</p><button className="button" aria-pressed={showCharts} onClick={() => setShowCharts(value => !value)}>{showCharts ? "Hide charts" : "Show charts"}</button>{showCharts && <div className="segments" role="group" aria-label="Watchlist candlestick period">{Object.keys(SCREEN_CHART_RANGES).map(period => <button key={period} className={range === period ? "active" : ""} aria-pressed={range === period} onClick={() => setRange(period)}>{period}</button>)}</div>}</div>
      <div className="saved-watchlist-columns" aria-hidden="true"><span>Stock</span><span>Price / change</span><span>Technical signal</span><span>Candlesticks</span><span>Actions</span></div>
      <div className="saved-watchlist-rows">{visible.map(symbol => <WatchlistRow key={symbol} symbol={symbol} quote={quotes[symbol]} range={range} refresh={refresh} onNavigate={onNavigate} onToggle={onToggle} onAlert={onAlert} showCharts={showCharts} />)}</div>
      {!visible.length && <div className="watch-empty"><h3>No saved stocks match this search.</h3><button className="button" onClick={() => setQuery("")}>Clear search</button></div>}
      <p className="watchlist-signal-note">Signals use completed daily sessions and stay the same across chart periods. Candles may include today’s session. Yahoo Finance · prices may be delayed.</p>
    </> : <div className="watch-empty"><Star size={28} /><h3>One stock is enough to get started.</h3><p>Save a company you follow. Your watchlist brings its moves, chart and alerts together.</p><button className="button primary" onClick={onSearch}>Find my first stock</button><button className="button" onClick={onGuide}>Help me get started</button></div>}
    <div className="saved-watchlist-foot"><ViewLink page="Alerts" onNavigate={onNavigate}>Manage price alerts</ViewLink><button className="link" onClick={onCopy}>Copy personal return link</button><button className="link" onClick={onGuide}>Reopen interactive guide</button><span>A personal return link opens the list saved in this browser. Share stocks creates a list others can preview and save. Use Portfolio → Backup & restore for your full records.</span></div>
  </section>;
}
