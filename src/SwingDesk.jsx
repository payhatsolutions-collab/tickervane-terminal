import { Fragment, useMemo, useState } from "react";
import {
  ArrowRight,
  ShieldCheck,
  BookOpen,
  Star,
  RefreshCw,
  CloudOff,
} from "lucide-react";
import { useFeed, useQuotes } from "./hooks";
import { AppTrialStrip, BreakoutOffer } from "./SetupOffer.jsx";
import LatestQuote from "./LatestQuote.jsx";
import { PRESETS } from "./screens";
import { journalStats } from "./tradeMath";
import { fmt } from "./data";
import { growthEvent } from "./growth.js";
import { useMobileLayout } from "./viewport.js";

import ResearchBrief, { WorkspaceSummary } from "./ResearchBrief.jsx";

const playbooks = [
  {
    id: "breakout20",
    title: "Top breakout buys",
    evidence: (row) => `20-day high · ${fmt(row.volRatio, 1)}× volume`,
    check:
      "Confirm the breakout on the daily chart and define your invalidation.",
  },
  {
    id: "pullback",
    title: "Top pullback buys",
    evidence: (row) => `Above 200 DMA · RSI ${fmt(row.rsi, 0)}`,
    check: "Check for price stabilization and define your invalidation.",
  },
  {
    id: "accumulation",
    title: "Top delivery buys",
    evidence: (row) =>
      `${fmt(row.delivRatio, 1)}× delivery · ${fmt(row.delivPct, 0)}% delivered`,
    check:
      "Check the price structure and company news. Delivery does not identify buyers.",
  },
];

function SetupLevels({ levels }) {
  const price = value => Number.isFinite(value) ? `₹${fmt(value)}` : "—";
  return (
    <dl className="setup-levels" aria-label="Daily setup levels in rupees">
      <div><dt title="Pivot (buy point)">Pivot</dt><dd>{price(levels?.pivot)}</dd></div>
      <div><dt>Target</dt><dd>{price(levels?.target)}</dd></div>
      <div><dt><abbr title="Stop-loss">SL</abbr></dt><dd>{price(levels?.stop)}</dd></div>
    </dl>
  );
}

function CompanyLogo({ symbol }) {
  const [unavailable, setUnavailable] = useState(false);
  return (
    <span className="setup-company-logo" aria-hidden="true">
      {unavailable ? symbol.slice(0, 2) : (
        <img
          src={`https://assets-netstorage.groww.in/stock-assets/logos2/${encodeURIComponent(symbol)}.png`}
          alt="" width="28" height="28" decoding="async" referrerPolicy="no-referrer"
          onError={() => setUnavailable(true)}
        />
      )}
    </span>
  );
}

function setupDistance(price, levels) {
  const { target, stop } = levels || {};
  if (![price, target, stop].every(value => Number.isFinite(value) && value > 0) || target <= stop) return null;

  // Compare at the same paise precision as the prices displayed on the card.
  const quoted = Math.round(price * 100);
  const toTarget = Math.round(target * 100) - quoted;
  const toStop = quoted - Math.round(stop * 100);
  const rupees = paise => `₹${fmt(Math.abs(paise) / 100, paise % 100 === 0 ? 0 : 2)}`;
  if (toTarget <= 0) {
    const position = toTarget === 0 ? "at the target" : `${rupees(toTarget)} above the target`;
    return `At ${rupees(quoted)}, the price is ${position} and the stop is ${rupees(toStop)} away.`;
  }
  if (toStop <= 0) {
    const position = toStop === 0 ? "at the stop" : `${rupees(toStop)} below the stop`;
    return `At ${rupees(quoted)}, the price is ${position} and the target is ${rupees(toTarget)} away.`;
  }
  return `At ${rupees(quoted)}, the target is ${rupees(toTarget)} away and the stop is ${rupees(toStop)} away.`;
}

export default function SwingDesk({
  refresh,
  onRefresh,
  onOpen,
  onPage,
  onSearch,
  watch,
  toggleWatch,
  journal,
  quotes,
  alerts,
  recent = [],
  access,
  onPro,
  onBreakoutExample,
  pulse,
  below,
  pushOffer,
}) {
  const { data, loading, error } = useFeed("/api/market?op=overview", refresh);
  const mobile = useMobileLayout();
  const [selected, setSelected] = useState("breakout20");
  const playbook = playbooks.find((item) => item.id === selected);
  const lists = useMemo(() => Object.fromEntries(playbooks.map(item =>
    [item.id, data?.setups?.[item.id]?.rows || []])), [data]);
  const rows = lists[selected];
  // Setups use daily metrics; prices use the refreshing quote feed, including
  // candidates outside the user's watchlist.
  const setupSymbols = rows.slice(0, 6).map(row => row.symbol + ".NS");
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
  const showPerformance = trades.length > 0 && !mobile;
  return (
    <div className="swing-desk">
      {/* The setups lead the home page and carry the Pro offer. Watchlist and alerts live on their own pages. */}
      <AppTrialStrip access={access} onStart={() => onPro?.(lists.breakout20[0] ? lists.breakout20[0].symbol + ".NS" : undefined)} />
      <div className={`desk-columns${showPerformance ? "" : " desk-columns-solo"}`}>
        <section className="panel desk-opportunities setup-hero" id="desk-opportunities">
          <header className="setup-hero-head">
            <div>
              <span className="setup-hero-kicker"><span /> NIFTY 500 · DAILY SETUPS</span>
              <h1>Setup watch</h1>
              <p>Find your next stock to research.</p>
            </div>
            <div className="setup-hero-side">
              {pulse}
              <button className="icon-button" aria-label="Refresh setups" onClick={onRefresh}>
                <RefreshCw size={16} className={loading ? "spin" : ""} />
              </button>
            </div>
          </header>
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
                  <span>{data ? data.setups[item.id].count : "—"}</span>
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
            <p>
              {selected === "breakout20" ? "The pivot (buy point) is the prior 20-session high." : "The pivot (buy point) is the setup session’s high."}{" "}
              The stop-loss is one average daily true range (14 sessions) below the pivot. The target is twice that distance above it.
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
                <SetupLevels />
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
              {rows.slice(0, 6).map((row, index) => {
                const symbol = row.symbol + ".NS";
                const quote = setupQuotes.quotes[symbol] || quotes[symbol];
                const distance = setupDistance(quote?.price, row.levels);
                return (
                  <Fragment key={symbol}>
                  <article>
                    <div className="desk-candidate-top">
                      <CompanyLogo symbol={row.symbol} />
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
                    <SetupLevels levels={row.levels} />
                    {distance && <p className="setup-distance">{distance}</p>}
                    <div className="desk-candidate-bottom">
                      <span className="desk-ltp">
                        <small>LTP · INR</small><LatestQuote quote={quote} />
                      </span>
                      <button className="button" onClick={() => onOpen(symbol)}>
                        View chart
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  </article>
                  {index === 0 && selected === "breakout20" && <BreakoutOffer access={access}
                    stock={row} count={data.setups.breakout20.count} onExample={onBreakoutExample} />}
                  </Fragment>
                );
              })}
            </div>
          )}
          <div className="panel-foot desk-source">
            <span>
              {data
                ? `Session ${data.date || "unavailable"} · ${data.metrics?.total ?? "—"} stocks`
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
        {showPerformance && <aside className="desk-sidebar">
          <section className="panel desk-performance">
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
          </section>
        </aside>}
      </div>
      {pushOffer}
      {below}
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
