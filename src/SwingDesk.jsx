import { useMemo, useState } from "react";
import {
  ArrowRight,
  Bell,
  ShieldCheck,
  BookOpen,
  Star,
  RefreshCw,
  CloudOff,
} from "lucide-react";
import { useFeed, useQuotes } from "./hooks";
import LatestQuote from "./LatestQuote.jsx";
import { PRESETS, runScreen } from "./screens";
import { journalStats } from "./tradeMath";
import { fmt, short } from "./data";
import { growthEvent } from "./growth.js";
import { useMobileLayout } from "./viewport.js";

import WatchlistBrief from "./WatchlistBrief.jsx";
import ResearchBrief, { WorkspaceSummary } from "./ResearchBrief.jsx";

const playbooks = [
  {
    id: "breakout20",
    title: "Breakouts",
    evidence: (row) => `20-day high · ${fmt(row.volRatio, 1)}× volume`,
    check:
      "Confirm the breakout on the daily chart and define your invalidation.",
  },
  {
    id: "pullback",
    title: "Pullbacks",
    evidence: (row) => `Above 200 DMA · RSI ${fmt(row.rsi, 0)}`,
    check: "Check for price stabilization and define your invalidation.",
  },
  {
    id: "accumulation",
    title: "Delivery",
    evidence: (row) =>
      `${fmt(row.delivRatio, 1)}× delivery · ${fmt(row.delivPct, 0)}% delivered`,
    check:
      "Check the price structure and company news. Delivery does not identify buyers.",
  },
];

export default function SwingDesk({
  refresh,
  onRefresh,
  onOpen,
  onInsight,
  onPage,
  onSearch,
  watch,
  toggleWatch,
  journal,
  quotes,
  alerts,
  recent = [],
}) {
  const { data, loading, error } = useFeed("/api/market?op=screen", refresh);
  const mobile = useMobileLayout();
  const [section, setSection] = useState("setups");
  const [selected, setSelected] = useState("breakout20");
  const playbook = playbooks.find((item) => item.id === selected);
  const lists = useMemo(
    () =>
      Object.fromEntries(
        playbooks.map((item) => [
          item.id,
          runScreen(
            data?.rows || [],
            PRESETS.find((preset) => preset.id === item.id),
          ).sort((a, b) => (b.turnoverCr || 0) - (a.turnoverCr || 0)),
        ]),
      ),
    [data],
  );
  const rows = lists[selected];
  // Setups use daily metrics; prices use the refreshing quote feed, including
  // candidates outside the user's watchlist.
  const setupSymbols = mobile && section !== "setups" ? [] : rows.slice(0, 6).map(row => row.symbol + ".NS");
  const setupQuotes = useQuotes(setupSymbols, refresh);
  const trades = journal.filter(
    (trade) =>
      trade.currency === "INR" &&
      trade.symbol.endsWith(".NS") &&
      trade.side === "long" &&
      trade.product === "delivery",
  );
  const stats = journalStats(trades),
    open = trades.filter((trade) => trade.status === "open"),
    planned = trades.filter((trade) => trade.status === "planned");
  const risk = open.reduce(
    (sum, trade) => sum + (Number(trade.plannedRisk) || 0),
    0,
  );
  return (
    <div className="swing-desk">
      {!watch.length && <div className="overview-welcome"><Star size={14} /> Build your personal watchlist. <button className="link" onClick={onSearch}>Add a stock</button></div>}
      <div className="overview-tabs" role="group" aria-label="Overview sections">{["setups", "watchlist", "alerts"].map(name => <button key={name} aria-pressed={section === name} onClick={() => setSection(name)}>{name === "setups" ? "Setups" : name === "watchlist" ? "Watchlist" : `Alerts${alerts.some(a => a.triggered) ? " •" : ""}`}</button>)}</div>
      <div className="desk-columns">
        <section className="panel desk-opportunities" id="desk-opportunities" hidden={mobile && section !== "setups"}>
          <div className="panel-title">
            <div>
              <span className="panel-tag">NIFTY 500</span>
              <h2>Setup watch</h2>
            </div>
            <button
              className="icon-button"
              aria-label="Refresh setups"
              onClick={onRefresh}
            >
              <RefreshCw size={16} className={loading ? "spin" : ""} />
            </button>
          </div>
          <div className="desk-playbooks" aria-label="Setup filters">
            {playbooks.map((item) => (
              <button
                key={item.id}
                className={selected === item.id ? "active" : ""}
                aria-pressed={selected === item.id}
                onClick={() => { setSelected(item.id); growthEvent("setup_filter_used", { preset: item.id }); }}
              >
                <strong>
                  {item.title}
                  <span>{data ? lists[item.id].length : "—"}</span>
                </strong>
              </button>
            ))}
          </div>
          <details className="setup-rules inline-details">
            <summary>Screen rules</summary>
            <p>
              {PRESETS.find((preset) => preset.id === selected).note}{" "}
              {playbook.check}
            </p>
          </details>
          {error && (
            <div className="notice" role="status">
              {data ? "Showing cached results. " : ""}
              Market feed temporarily unavailable.{" "}
              <button className="link" onClick={onRefresh}>
                Retry
              </button>
            </div>
          )}
          {loading && !data ? (
            <div className="desk-candidates" role="status" aria-label="Finding setups" aria-busy="true">
              {Array.from({ length: 6 }, (_, i) => <article key={i} aria-hidden="true">
                <div className="desk-candidate-top"><div>
                  <span className="skeleton-line" /><p><span className="skeleton-line skeleton-short" /></p>
                </div></div>
                <span className="desk-evidence"><span className="skeleton-line" /></span>
                <div className="desk-candidate-bottom"><span>LTP<b>—</b></span>
                  <span className="button skeleton-button">View chart</span>
                </div>
              </article>)}
            </div>
          ) : !data ? (
            <div className="empty">
              <CloudOff size={28} />
              <h3>A pause in the market feed</h3>
              <p>Setups will return when data is available. In the meantime, explore a company or review your watchlist.</p>
              <button className="button" onClick={onSearch}>
                Research a stock <ArrowRight size={14} />
              </button>
            </div>
          ) : !rows.length ? (
            <div className="empty">
              <ShieldCheck size={26} />
              <h3>No {playbook.title.toLowerCase()} today</h3>
              <p>Try another setup filter or explore all stocks.</p>
              <button className="button" onClick={() => onPage("Screener")}>
                Open screener
                <ArrowRight size={14} />
              </button>
            </div>
          ) : (
            <div className="desk-candidates">
              {rows.slice(0, 6).map((row) => {
                const symbol = row.symbol + ".NS";
                return (
                  <article key={symbol}>
                    <div className="desk-candidate-top">
                      <span className="stock-monogram" aria-hidden="true">{row.symbol.slice(0, 2)}</span>
                      <div>
                        <button className="link" onClick={() => onOpen(symbol)}>
                          {row.symbol}
                          <ArrowRight size={13} />
                        </button>
                        <p>{row.name}</p>
                      </div>
                      <button
                        className={`icon-button ${watch.includes(symbol) ? "starred" : ""}`}
                        aria-label={`${watch.includes(symbol) ? "Remove" : "Add"} ${row.symbol} ${watch.includes(symbol) ? "from" : "to"} watchlist`}
                        onClick={() => toggleWatch(symbol)}
                      >
                        <Star
                          size={16}
                          fill={
                            watch.includes(symbol) ? "currentColor" : "none"
                          }
                        />
                      </button>
                    </div>
                    <span className="desk-evidence">
                      {playbook.evidence(row)}
                    </span>
                    <div className="desk-candidate-bottom">
                      <span className="desk-ltp">
                        <small>LTP · INR</small><LatestQuote quote={setupQuotes.quotes[symbol] || quotes[symbol]} />
                      </span>
                      <button className="button" onClick={() => selected === "breakout20" && onInsight ? onInsight(symbol) : onOpen(symbol)}>
                        {selected === "breakout20" && onInsight ? "Read insight" : "View chart"}
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <div className="panel-foot desk-source">
            <span>
              {data
                ? `Session ${data.date || "unavailable"} · ${data.rows?.length || 0} stocks`
                : "Daily market data"}
              <br />
              Setups: daily data · LTP: 30 sec refresh, may be delayed
            </span>
            <button className="link" onClick={() => onPage(selected === "breakout20" ? "Breakouts" : "Screener")}>
              {selected === "breakout20" ? "All breakout insights" : "All screens"}
              <ArrowRight size={13} />
            </button>
          </div>
        </section>
        <aside className="desk-sidebar" hidden={mobile && section === "setups"}>
          <div hidden={mobile && section !== "watchlist"}>
            {watch.length ? <WatchlistBrief overview watch={watch} quotes={quotes} alerts={alerts} onOpen={onOpen} onPage={onPage} /> : <section className="panel overview-empty"><h2>Your watchlist</h2><p>Star stocks to follow them here.</p><button className="button" onClick={onSearch}>Find a stock</button></section>}
          </div>
          <section className="panel overview-alerts" hidden={mobile && section !== "alerts"}>
            <div className="panel-title"><h2><Bell size={15} /> Price alerts</h2><button className="link" onClick={() => onPage("Alerts")}>Manage</button></div>
            {alerts.some(a => a.triggered) ? <div className="overview-alert-list">{alerts.filter(a => a.triggered).slice(0, 4).map(a => <button key={a.id} onClick={() => onOpen(a.symbol)}><strong>{short(a.symbol)}</strong><span>{a.condition} {fmt(a.price)}</span><ArrowRight size={14} /></button>)}</div> : <p className="watch-empty">{alerts.length ? `${alerts.length} active alerts · none triggered` : "No alerts yet. Set a price to follow."}</p>}
          </section>
          {trades.length > 0 && <section className="panel desk-performance" hidden={mobile}>
            <div className="panel-title">
              <div>
                <BookOpen size={16} />
                <h2>Trading snapshot</h2>
              </div>
            </div>
            <div className="desk-performance-body">
              {stats && (
                <div>
                  <span className="desk-kicker">AVERAGE NET RESULT</span>
                  <strong
                    className={`desk-expectancy ${stats.expectancy >= 0 ? "positive" : "negative"}`}
                  >
                    {fmt(stats.expectancy)}R
                  </strong>
                </div>
              )}
              <div className="desk-metrics">
                <div>
                  <span>Open trades</span>
                  <b>{open.length}</b>
                </div>
                <div>
                  <span>Saved plans</span>
                  <b>{planned.length}</b>
                </div>
                <div>
                  <span>Original risk</span>
                  <b>₹{fmt(risk)}</b>
                </div>
                <div>
                  <span>Closed trades</span>
                  <b>{stats?.trades || 0}</b>
                </div>
              </div>
              <button className="button" onClick={() => onPage("Journal")}>
                Open journal
                <ArrowRight size={14} />
              </button>
              <details className="inline-details">
                <summary>About these numbers</summary>
                <p>
                  NSE long delivery trades recorded on this device. R is the
                  original amount risked. Results include recorded costs; gaps
                  can exceed planned risk.
                </p>
              </details>
            </div>
          </section>}
        </aside>
      </div>
      <WorkspaceSummary watch={watch} alerts={alerts} journal={journal} onPage={onPage} />
      <ResearchBrief data={data} loading={loading} error={error} onPage={onPage} onRefresh={onRefresh} recent={recent} onOpen={onOpen} onSearch={onSearch} />
      <div className="overview-note">
        <ShieldCheck size={14} />
        <span>
          Delayed market data · Research only · Your records stay on this device
        </span>
      </div>
    </div>
  );
}
