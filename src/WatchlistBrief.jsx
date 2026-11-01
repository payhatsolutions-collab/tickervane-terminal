import { ArrowUpRight, Bell, Star } from "lucide-react";
import { fmt, pct, short } from "./data.js";
import { watchlistBrief } from "./watchlistTools.js";
import { growthEvent } from "./growth.js";
import "./watchlist-tools.css";

export default function WatchlistBrief({ watch, quotes, onOpen, onPage, alerts = [], compact = false, overview = false }) {
  if (!watch.length) return null;
  const brief = watchlistBrief(watch, quotes);
  const triggered = alerts.filter(alert => watch.includes(alert.symbol) && alert.triggered).length;
  const stamp = brief.oldest ? new Date(brief.oldest * 1000).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }) : null;
  if (overview) return <section className="panel overview-watch">
    <div className="panel-title"><h2>Your watchlist</h2><button className="link" onClick={() => { growthEvent("personal_brief_opened"); onPage("Watchlist"); }}>View all ({watch.length})</button></div>
    <div className="overview-watch-counts"><span className="positive">{brief.up} rising</span><span className="negative">{brief.down} falling</span><span>{brief.flat} flat</span></div>
    <div className="overview-watch-list">{watch.slice(0, 6).map(symbol => <button key={symbol} onClick={() => onOpen(symbol)}><span className="watch-monogram" aria-hidden="true">{short(symbol).slice(0, 2)}</span><strong>{short(symbol)}</strong><span className="overview-watch-price">{fmt(quotes[symbol]?.price)} <small>{quotes[symbol]?.currency}</small></span><span className={`number ${Number.isFinite(quotes[symbol]?.change) ? quotes[symbol].change >= 0 ? "positive" : "negative" : "muted"}`}>{pct(quotes[symbol]?.change)}</span><ArrowUpRight size={13} /></button>)}</div>
    <div className="panel-foot">{brief.known}/{watch.length} quotes · may be delayed<br />{stamp ? `Oldest quote: ${stamp} (local)` : "Quote freshness unavailable"}</div>
  </section>;
  return <section className={`watch-brief ${compact ? "compact" : "panel"}`} aria-label="Your watchlist at a glance">
    <div className="watch-brief-heading"><div><span className="desk-kicker">YOUR MARKET AT A GLANCE</span><h2>Your watchlist pulse</h2></div>
      {!compact && <button className="button" onClick={() => { growthEvent("personal_brief_opened"); onPage("Watchlist"); }}><Star size={14} /> Open watchlist</button>}
    </div>
    <div className="watch-brief-counts"><span><b className="positive">{brief.up}</b> rising</span><span><b className="negative">{brief.down}</b> falling</span><span><b>{brief.flat}</b> unchanged</span><span>{brief.known} / {watch.length} quotes available</span></div>
    {brief.movers.length ? <div className="watch-brief-movers">{brief.movers.map(quote => <button key={quote.symbol} onClick={() => onOpen(quote.symbol)}>
      <span>{short(quote.symbol)}</span><strong className={quote.change >= 0 ? "positive" : "negative"}>{pct(quote.change)}</strong><ArrowUpRight size={15} />
    </button>)}</div> : <p>Waiting for quotes. Your saved stocks are ready to open below.</p>}
    <div className="watch-brief-foot"><span>Largest absolute session moves · Yahoo Finance · may be delayed.<br />{stamp ? `Oldest available quote: ${stamp} (local time).` : "Quote freshness unavailable."}{brief.missing > 0 && ` ${brief.missing} without a session change.`}</span>
      {triggered > 0 && <button className="link" onClick={() => onPage("Alerts")}><Bell size={14} /> {triggered} triggered {triggered === 1 ? "alert" : "alerts"}</button>}
    </div>
  </section>;
}
