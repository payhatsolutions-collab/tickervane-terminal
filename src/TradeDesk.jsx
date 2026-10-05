import { useState } from "react";
import { ArrowUpRight, BookOpen, Download, Target } from "lucide-react";
import { fmt, short } from "./data";
import {
  planTrade,
  tradeOutcome,
  journalStats,
  indianCharges,
} from "./tradeMath";
import BrokerTrade from "./BrokerTrade";

export const SETUPS = [
  "Breakout",
  "Pullback",
  "Reversal",
  "Momentum",
  "Range",
  "Event",
  "Other",
];
const tone = (n) =>
  Number.isFinite(n) ? (n >= 0 ? "positive" : "negative") : "";
const tick = (x, currency) =>
  currency === "INR"
    ? (Math.round(x / 0.05) * 0.05).toFixed(2)
    : String(Number(x.toPrecision(8)));

export function TradePlanner({
  symbol,
  currency,
  quote,
  levels,
  draft,
  setDraft,
  onSave,
  onJournal,
  supported,
}) {
  const india = currency === "INR",
    product = india ? draft.product || "delivery" : "manual";
  const plan = {
    ...draft,
    product,
    brokerage: draft.brokerage ?? "20",
    slippage: draft.slippage ?? "0",
  };
  const result = planTrade(plan);
  const set = (patch) => setDraft({ ...draft, ...patch });
  const field = (key, label, props = {}) => (
    <label>
      {label}
      <input
        type="number"
        step="any"
        min="0"
        {...props}
        value={plan[key] ?? ""}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </label>
  );
  const long = draft.side !== "short",
    e = Number(draft.entry),
    st = Number(draft.stop),
    dist = Math.abs(e - st),
    atr = levels?.atr;
  const valid = (x, want) =>
    Number.isFinite(x) && x > 0 && e > 0 && (want === "below" ? x < e : x > e);
  const stops =
    e > 0
      ? [
          ["1× ATR", long ? e - atr : e + atr],
          ["1.5× ATR", long ? e - 1.5 * atr : e + 1.5 * atr],
          [long ? "Prior L" : "Prior H", long ? levels?.low : levels?.high],
          [long ? "20D L" : "20D H", long ? levels?.low20 : levels?.high20],
          [long ? "S1" : "R1", long ? levels?.s1 : levels?.r1],
        ].filter(([, x]) => valid(x, long ? "below" : "above"))
      : [];
  const stopOk = e > 0 && st > 0 && (long ? st < e : st > e);
  const targets = stopOk
    ? [
        ["1.5R", long ? e + 1.5 * dist : e - 1.5 * dist],
        ["2R", long ? e + 2 * dist : e - 2 * dist],
        ["3R", long ? e + 3 * dist : e - 3 * dist],
        [long ? "20D H" : "20D L", long ? levels?.high20 : levels?.low20],
        [long ? "R1" : "S1", long ? levels?.r1 : levels?.s1],
      ].filter(([, x]) => valid(x, long ? "above" : "below"))
    : [];
  const chips = (items, key) =>
    items.length ? (
      <div className="quick-fill">
        {items.map(([label, x]) => (
          <button
            key={label}
            type="button"
            onClick={() => set({ [key]: tick(x, currency) })}
          >
            {label} <b>{fmt(x)}</b>
          </button>
        ))}
      </div>
    ) : null;
  const b = result.breakdown;
  return (
    <section className="panel trade-planner">
      <div className="panel-title">
        <div>
          <span className="panel-tag">RISK</span>
          <h2>Risk planner</h2>
        </div>
        <button className="button" onClick={onJournal}>
          <BookOpen size={14} /> Journal
        </button>
      </div>
      <div className="planner-body">
        <p className="muted small">
          {short(symbol)} · {currency || "Currency unavailable"} · whole shares
          · no leverage
        </p>
        {!supported ? (
          <p className="notice">
            The planner supports cash equities. Indices, futures, FX and crypto
            need contract-specific sizing.
          </p>
        ) : (
          <>
            <div className="planner-fields">
              <label>
                Direction
                <select
                  value={draft.side}
                  onChange={(e) => set({ side: e.target.value })}
                >
                  <option value="long">Long</option>
                  <option value="short">Short (intraday)</option>
                </select>
              </label>
              {india ? (
                <label>
                  Product
                  <select
                    value={product}
                    onChange={(e) => set({ product: e.target.value })}
                  >
                    <option value="delivery">Delivery (CNC)</option>
                    <option value="intraday">Intraday (MIS)</option>
                    <option value="manual">Manual costs</option>
                  </select>
                </label>
              ) : (
                <span />
              )}
              {field("capital", `Capital (${currency || "quote currency"})`)}
              {field("riskPct", "Risk per trade (%)", { max: 100 })}
            </div>
            <details className="inline-details planner-costs">
              <summary>Fees & slippage</summary>
              <div className="planner-fields">
                {product === "manual" ? (
                  field("costs", "Round-trip costs")
                ) : (
                  <>
                    {field("brokerage", "Brokerage / order (₹)")}
                    {field("slippage", "Slippage allowance (₹)")}
                  </>
                )}
              </div>
            </details>
            <div className="planner-fields three">
              {field("entry", "Entry")}
              {field("stop", "Stop")}
              {field("target", "Target")}
            </div>
            <button
              className="link planner-quote"
              disabled={!Number.isFinite(quote?.price)}
              onClick={() => set({ entry: tick(quote.price, currency) })}
            >
              Use last quote as entry · {fmt(quote?.price)}
            </button>
            {chips(stops, "stop")}
            {chips(targets, "target")}
            <div className="plan-result" aria-live="polite">
              {result.error ? (
                <p className="muted">{result.error}</p>
              ) : (
                <>
                  <div>
                    <span>Shares</span>
                    <strong>{fmt(result.quantity, 0)}</strong>
                  </div>
                  <div>
                    <span>Reward / risk (net)</span>
                    <strong
                      className={
                        result.rr >= 2
                          ? "positive"
                          : result.rr < 1
                            ? "negative"
                            : ""
                      }
                    >
                      {fmt(result.rr)}R
                    </strong>
                  </div>
                  <div>
                    <span>Loss at stop</span>
                    <strong>{fmt(result.plannedRisk)}</strong>
                  </div>
                  <div>
                    <span>Profit at target</span>
                    <strong>{fmt(result.plannedReward)}</strong>
                  </div>
                  <div>
                    <span>Capital used</span>
                    <strong>{fmt(result.notional)}</strong>
                  </div>
                  <div>
                    <span>Account risk</span>
                    <strong>{fmt(result.riskPct)}%</strong>
                  </div>
                  {b && (
                    <p className="charge-line">
                      Charges at target {fmt(result.targetCosts)} · STT{" "}
                      {fmt(b.stt)} · stamp {fmt(b.stamp)} · exch+SEBI{" "}
                      {fmt(b.txn + b.sebi)} · GST {fmt(b.gst)} · brokerage{" "}
                      {fmt(b.brokerage)}
                      {b.dp ? ` · DP ${fmt(b.dp)}` : ""}
                    </p>
                  )}
                  {result.cashLimited && (
                    <p>Size capped by available capital.</p>
                  )}
                </>
              )}
            </div>
            <div className="planner-fields">
              <label>
                Setup
                <select
                  value={draft.setup || ""}
                  onChange={(e) => set({ setup: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {SETUPS.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <span />
            </div>
            <label className="plan-thesis">
              Thesis & invalidation
              <textarea
                maxLength={1200}
                placeholder="Why this trade? What would invalidate the setup?"
                value={draft.notes || ""}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </label>
            <button
              className="button primary"
              disabled={!!result.error || !currency || !draft.notes?.trim()}
              onClick={() =>
                onSave({
                  ...draft,
                  ...result,
                  breakdown: undefined,
                  product,
                  symbol,
                  currency,
                  entry: Number(draft.entry),
                  stop: Number(draft.stop),
                  target: Number(draft.target),
                  costs: result.auto
                    ? Math.round(result.costs * 100) / 100
                    : Number(draft.costs || 0),
                  status: "planned",
                })
              }
            >
              <Target size={14} /> Save plan to journal
            </button>
            <details className="inline-details">
              <summary>Costs & risk assumptions</summary>
              <p className="muted small">
                {product === "manual"
                  ? "Costs are your round-trip fee and slippage allowance."
                  : "Statutory charges use the FY26 NSE schedule; brokerage is per order (intraday capped at 0.03%). Loss at stop includes charges."}{" "}
                Saving a plan places no order; gaps can exceed the stop.
              </p>
            </details>
            <details className="broker-disclosure">
              <summary>
                Continue with your broker <ArrowUpRight size={14} />
              </summary>
              <BrokerTrade
                key={JSON.stringify([symbol, currency, plan, result.quantity])}
                symbol={symbol}
                currency={currency}
                plan={plan}
                result={result}
              />
            </details>
          </>
        )}
      </div>
      <div className="panel-foot">
        Daily ATR (14): {fmt(levels?.atr)}
        {Number.isFinite(levels?.atr) && e > 0
          ? ` · ${fmt((levels.atr / e) * 100)}% of entry`
          : ""}
      </div>
    </section>
  );
}

export function KeyLevels({ levels, loading, error }) {
  const rows = levels
    ? [
        ["Prior high", levels.high],
        ["Prior low", levels.low],
        ["Prior close", levels.close],
        ["20-session high", levels.high20],
        ["20-session low", levels.low20],
        ["ATR (14)", levels.atr],
      ]
    : [];
  const piv =
    levels && Number.isFinite(levels.pivot)
      ? [
          ["S2", levels.s2],
          ["S1", levels.s1],
          ["BC", levels.bc],
          ["Pivot", levels.pivot],
          ["TC", levels.tc],
          ["R1", levels.r1],
          ["R2", levels.r2],
        ]
      : [];
  return (
    <div className="key-levels">
      <div className="level-caption">
        <strong>Daily reference levels</strong>
        <span>
          {levels
            ? `Through ${levels.date} · excludes exchange today`
            : loading
              ? "Loading daily bars…"
              : error
                ? "Daily feed unavailable"
                : "Needs 21 completed daily bars"}
        </span>
      </div>
      {levels && (
        <div className="level-grid">
          {rows.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{fmt(value)}</strong>
            </div>
          ))}
        </div>
      )}
      {piv.length > 0 && (
        <>
          <div className="level-caption pivot-caption">
            <strong>Pivots & CPR for next session</strong>
            <span className={levels.cprLabel === "Narrow" ? "accent" : ""}>
              CPR {fmt(levels.cprWidth)}% · {levels.cprLabel}
            </span>
          </div>
          <div className="pivot-row">
            {piv.map(([label, value]) => (
              <div
                key={label}
                className={
                  label === "Pivot"
                    ? "pivot-main"
                    : label[0] === "R"
                      ? "res"
                      : label[0] === "S"
                        ? "sup"
                        : "cpr"
                }
              >
                <span>{label}</span>
                <strong>{fmt(value)}</strong>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function TradeJournal({
  entries,
  setEntries,
  onOpen,
  onPlan,
  exportCSV,
  notify,
}) {
  const [filter, setFilter] = useState("all"),
    [closing, setClosing] = useState(null),
    [exit, setExit] = useState(""),
    [fees, setFees] = useState("0"),
    [review, setReview] = useState("");
  const displayed = entries.filter(
    (t) => filter === "all" || t.status === filter,
  );
  const currencies = [...new Set(entries.map((t) => t.currency))];
  const stats = journalStats(entries),
    bySetup = [
      ...new Set(
        entries
          .filter((t) => t.status === "closed")
          .map((t) => t.setup || "Untagged"),
      ),
    ]
      .map((k) => [
        k,
        journalStats(entries.filter((t) => (t.setup || "Untagged") === k)),
      ])
      .filter(([, x]) => x)
      .sort((a, b) => b[1].expectancy - a[1].expectancy);
  const closeTrade = (e) => {
    e.preventDefault();
    const t = entries.find((t) => t.id === closing),
      outcome = t && tradeOutcome(t, exit, fees);
    if (!outcome) {
      notify("Enter a valid exit price and non-negative total costs.");
      return;
    }
    setEntries(
      entries.map((t) =>
        t.id === closing
          ? {
              ...t,
              status: "closed",
              exit: Number(exit),
              fees: Number(fees),
              review,
              closedAt: new Date().toISOString(),
            }
          : t,
      ),
    );
    setClosing(null);
    notify("Outcome recorded.");
  };
  const status = (t, status) => {
    setEntries(
      entries.map((x) =>
        x.id === t.id
          ? {
              ...x,
              status,
              ...(status === "open"
                ? { openedAt: new Date().toISOString() }
                : {}),
            }
          : x,
      ),
    );
    notify(
      status === "open"
        ? "Marked open at planned entry and size. No order was sent."
        : "Plan cancelled.",
    );
  };
  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="panel-tag">LOG</span>
            <h2>Trade journal</h2>
          </div>
          <button
            className="button"
            onClick={() =>
              exportCSV(
                [
                  [
                    "Symbol",
                    "Currency",
                    "Status",
                    "Side",
                    "Entry",
                    "Stop",
                    "Target",
                    "Shares",
                    "Planned risk",
                    "Exit",
                    "Actual costs",
                    "Net P&L",
                    "R",
                    "Setup",
                    "Notes",
                    "Review",
                  ],
                  ...displayed.map((t) => {
                    const o =
                      t.status === "closed"
                        ? tradeOutcome(t, t.exit, t.fees)
                        : null;
                    return [
                      t.symbol,
                      t.currency,
                      t.status,
                      t.side,
                      t.entry,
                      t.stop,
                      t.target,
                      t.quantity,
                      t.plannedRisk,
                      t.exit,
                      t.fees,
                      o?.net,
                      o?.r,
                      t.setup,
                      t.notes,
                      t.review,
                    ];
                  }),
                ],
                "alphanova-journal.csv",
              )
            }
            disabled={!displayed.length}
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
        <div className="journal-summary">
          {currencies.map((currency) => {
            const ts = entries.filter((t) => t.currency === currency),
              closed = ts.filter((t) => t.status === "closed"),
              outcomes = closed
                .map((t) => tradeOutcome(t, t.exit, t.fees))
                .filter(Boolean),
              open = ts.filter((t) => t.status === "open"),
              net = outcomes.reduce((a, o) => a + o.net, 0),
              risk = open.reduce((a, t) => a + t.plannedRisk, 0);
            return (
              <div key={currency}>
                <span>
                  {currency} · {closed.length} closed / {open.length} open
                </span>
                <strong className={net < 0 ? "negative" : "positive"}>
                  {fmt(net)} net realized
                </strong>
                <p>
                  Open planned risk {fmt(risk)} ·{" "}
                  {outcomes.length
                    ? `${fmt((outcomes.filter((o) => o.net > 0).length / outcomes.length) * 100, 0)}% wins · ${fmt(outcomes.reduce((a, o) => a + (o.r || 0), 0) / outcomes.length)}R avg`
                    : "No closed outcomes yet"}
                </p>
              </div>
            );
          })}
        </div>
        {stats && (
          <div className="edge-stats" aria-label="Performance in R multiples">
            {[
              [
                "Expectancy",
                `${fmt(stats.expectancy)}R`,
                tone(stats.expectancy),
              ],
              ["Win rate", `${fmt(stats.winRate, 0)}%`],
              [
                "Profit factor",
                stats.profitFactor == null ? "—" : fmt(stats.profitFactor),
                stats.profitFactor == null
                  ? ""
                  : stats.profitFactor >= 1
                    ? "positive"
                    : "negative",
              ],
              [
                "Avg win",
                stats.avgWin == null ? "—" : `${fmt(stats.avgWin)}R`,
                "positive",
              ],
              [
                "Avg loss",
                stats.avgLoss == null ? "—" : `${fmt(stats.avgLoss)}R`,
                "negative",
              ],
              ["Total", `${fmt(stats.totalR)}R`, tone(stats.totalR)],
              ["Max drawdown", `${fmt(stats.maxDrawdown)}R`],
              ["Worst loss streak", fmt(stats.maxLossStreak, 0)],
            ].map(([k, v, c]) => (
              <div key={k}>
                <span>{k}</span>
                <strong className={c || ""}>{v}</strong>
              </div>
            ))}
          </div>
        )}
        {bySetup.length > 1 && (
          <div className="table-wrap setup-table">
            <table>
              <thead>
                <tr>
                  <th>Setup</th>
                  <th>Trades</th>
                  <th>Win rate</th>
                  <th>Expectancy</th>
                  <th>Total R</th>
                </tr>
              </thead>
              <tbody>
                {bySetup.map(([name, st]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td className="number">{st.trades}</td>
                    <td className="number">{fmt(st.winRate, 0)}%</td>
                    <td className={`number ${tone(st.expectancy)}`}>
                      {fmt(st.expectancy)}R
                    </td>
                    <td className={`number ${tone(st.totalR)}`}>
                      {fmt(st.totalR)}R
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="journal-filters segments">
          {["all", "planned", "open", "closed", "cancelled"].map((s) => (
            <button
              key={s}
              className={filter === s ? "active" : ""}
              aria-pressed={filter === s}
              onClick={() => setFilter(s)}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        {!displayed.length ? (
          <div className="empty">
            <BookOpen size={28} />
            <h3>
              {entries.length
                ? "No trades in this view"
                : "Turn research into a repeatable process"}
            </h3>
            <p>
              Plan an entry, stop and target. Record the outcome and what you
              learned.
            </p>
            <button className="button primary" onClick={onPlan}>
              Plan a trade <ArrowUpRight size={14} />
            </button>
          </div>
        ) : (
          <div className="journal-list">
            {displayed.map((t) => {
              const outcome =
                t.status === "closed" ? tradeOutcome(t, t.exit, t.fees) : null;
              return (
                <article key={t.id} className="journal-entry">
                  <div className="journal-entry-head">
                    <button className="link" onClick={() => onOpen(t.symbol)}>
                      {short(t.symbol)} <ArrowUpRight size={13} />
                    </button>
                    <span>
                      {t.side.toUpperCase()}
                      {t.product && t.product !== "manual"
                        ? ` · ${t.product}`
                        : ""}
                      {t.setup ? ` · ${t.setup}` : ""} · {t.currency} ·{" "}
                      {t.status}
                    </span>
                    <time>{new Date(t.createdAt).toLocaleDateString()}</time>
                  </div>
                  <div className="journal-numbers">
                    <span>
                      Entry <b>{fmt(t.entry)}</b>
                    </span>
                    <span>
                      Stop <b>{fmt(t.stop)}</b>
                    </span>
                    <span>
                      Target <b>{fmt(t.target)}</b>
                    </span>
                    <span>
                      Shares <b>{fmt(t.quantity, 0)}</b>
                    </span>
                    <span>
                      Risk <b>{fmt(t.plannedRisk)}</b>
                    </span>
                    {outcome && (
                      <span
                        className={outcome.net < 0 ? "negative" : "positive"}
                      >
                        Net{" "}
                        <b>
                          {fmt(outcome.net)} · {fmt(outcome.r)}R
                        </b>
                      </span>
                    )}
                  </div>
                  <p className="journal-notes">{t.notes}</p>
                  {t.review && (
                    <p className="journal-notes muted">Review: {t.review}</p>
                  )}
                  <div className="journal-actions">
                    {t.status === "planned" && (
                      <>
                        <button
                          className="button"
                          onClick={() => status(t, "open")}
                        >
                          Mark open at planned entry
                        </button>
                        <button
                          className="button"
                          onClick={() => status(t, "cancelled")}
                        >
                          Cancel plan
                        </button>
                      </>
                    )}
                    {t.status === "open" && (
                      <button
                        className="button"
                        onClick={() => {
                          setClosing(t.id);
                          setExit("");
                          setFees(String(t.costs || 0));
                          setReview("");
                        }}
                      >
                        Record exit
                      </button>
                    )}
                  </div>
                  {closing === t.id && (
                    <form className="journal-close" onSubmit={closeTrade}>
                      <label>
                        Exit price
                        <input
                          type="number"
                          step="any"
                          min="0.000001"
                          required
                          value={exit}
                          onChange={(e) => {
                            setExit(e.target.value);
                            const x = Number(e.target.value),
                              c =
                                ["delivery", "intraday"].includes(t.product) &&
                                x > 0 &&
                                indianCharges({
                                  product: t.product,
                                  quantity: t.quantity,
                                  brokerage: t.brokerage ?? 20,
                                  ...(t.side === "short"
                                    ? { buy: x, sell: t.entry }
                                    : { buy: t.entry, sell: x }),
                                });
                            if (c)
                              setFees(
                                (c.total + Number(t.slippage || 0)).toFixed(2),
                              );
                          }}
                        />
                      </label>
                      <label>
                        Actual total costs
                        {["delivery", "intraday"].includes(t.product)
                          ? " (auto from exit)"
                          : ""}
                        <input
                          type="number"
                          step="any"
                          min="0"
                          required
                          value={fees}
                          onChange={(e) => setFees(e.target.value)}
                        />
                      </label>
                      <label>
                        Review
                        <textarea
                          maxLength={1200}
                          value={review}
                          onChange={(e) => setReview(e.target.value)}
                          placeholder="What worked? What would you change?"
                        />
                      </label>
                      <button className="button primary">Save outcome</button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => setClosing(null)}
                      >
                        Cancel
                      </button>
                    </form>
                  )}
                </article>
              );
            })}
          </div>
        )}
        <div className="panel-foot">
          Manual records, whole-position exits · no brokerage sync · R = net P&L
          / original planned risk · currencies kept separate · included in
          Portfolio backups
        </div>
      </section>
    </>
  );
}
