import { useMemo, useState } from "react";
import {
  ArrowRight,
  Globe2,
  Target,
  ShieldCheck,
  BookOpen,
  Star,
  RefreshCw,
} from "lucide-react";
import { useFeed } from "./hooks";
import { PRESETS, runScreen } from "./screens";
import { journalStats } from "./tradeMath";
import { fmt, pct, short } from "./data";

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
  onPage,
  watch,
  toggleWatch,
  journal,
  quotes,
}) {
  const { data, loading, error } = useFeed("/api/market?op=screen", refresh);
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
      <section className="overview-intro">
        <div>
          <span className="desk-kicker">YOUR MARKET WORKSPACE</span>
          <h2>A clearer view of the market.</h2>
          <p>Discover setups. Plan your risk. Track your trades.</p>
        </div>
        <button className="button primary" onClick={() => onPage("Markets")}>
          Explore markets
          <ArrowRight size={16} />
        </button>
      </section>
      <div className="overview-shortcuts" aria-label="Quick actions">
        {[
          [Globe2, "Market pulse", "Markets"],
          [Target, "Find stocks", "Screener"],
          [BookOpen, "Trade journal", "Journal"],
        ].map(([Icon, title, page]) => (
          <button key={page} onClick={() => onPage(page)}>
            <span className="shortcut-icon">
              <Icon size={19} />
            </span>
            <strong>{title}</strong>
            <ArrowRight size={15} />
          </button>
        ))}
      </div>
      <div className="desk-columns">
        <section className="panel desk-opportunities" id="desk-opportunities">
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
                onClick={() => setSelected(item.id)}
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
              {error}{" "}
              <button className="link" onClick={onRefresh}>
                Retry
              </button>
            </div>
          )}
          {loading && !data ? (
            <div className="empty">
              <RefreshCw className="spin" size={24} />
              <h3>Finding setups…</h3>
              <p>Checking the latest available daily data.</p>
            </div>
          ) : !data ? (
            <div className="empty">
              <h3>Setups unavailable</h3>
              <p>Try refreshing or open a stock from your watchlist.</p>
              <button className="button" onClick={onRefresh}>
                Retry
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
                      <span>
                        Last close<b>₹{fmt(row.price)}</b>
                      </span>
                      <button className="button" onClick={() => onOpen(symbol)}>
                        View chart
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
              Research candidates · up to 6 by turnover
            </span>
            <button className="link" onClick={() => onPage("Screener")}>
              All screens
              <ArrowRight size={13} />
            </button>
          </div>
        </section>
        <aside className="desk-sidebar">
          <section className="panel overview-watch">
            <div className="panel-title">
              <div>
                <Star size={16} />
                <h2>Your watchlist</h2>
              </div>
              <span className="muted">{watch.length} stocks</span>
            </div>
            {watch.length ? (
              <div className="overview-watch-list">
                {watch.slice(0, 5).map((symbol) => (
                  <button key={symbol} onClick={() => onOpen(symbol)}>
                    <strong>{short(symbol)}</strong>
                    <span
                      className={`number ${Number.isFinite(quotes[symbol]?.change) ? (quotes[symbol].change >= 0 ? "positive" : "negative") : "muted"}`}
                    >
                      {pct(quotes[symbol]?.change)}
                    </span>
                    <ArrowRight size={13} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="watch-empty">Star stocks to follow them here.</p>
            )}
            <div className="panel-foot">
              <button className="link" onClick={() => onPage("Watchlist")}>
                Open full watchlist
                <ArrowRight size={13} />
              </button>
            </div>
          </section>
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
        </aside>
      </div>
      <div className="overview-note">
        <ShieldCheck size={14} />
        <span>
          Delayed market data · Research only · Your records stay on this device
        </span>
      </div>
    </div>
  );
}
