import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { useFeed } from "./hooks";
import { directory, fmt, search, short } from "./data";
import { completedDailyBars } from "./tradeMath";

// One question, one answer: type a ticker, get the projected price in
// 10 trading sessions (~2 weeks). No charts, no tables, no fine print.
const HORIZON = 10;

function resolveSymbol(input, suggestions) {
  const q = (input || "").trim().toUpperCase();
  if (!q) return null;
  const exact = suggestions.find(
    (s) => s.symbol === q || short(s.symbol) === q,
  );
  return exact ? exact.symbol : (suggestions[0]?.symbol ?? q);
}

export default function Forecast({ symbol, refresh, onRefresh, onSymbol }) {
  const [query, setQuery] = useState(() => short(symbol));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [retryTick, setRetryTick] = useState(0);
  const boxRef = useRef(null);
  const suggestions = useMemo(() => search(query).slice(0, 6), [query]);

  const feed = useFeed(
    "/api/market?op=chart&symbol=" +
      encodeURIComponent(symbol) +
      "&range=5y&adjusted=1&daily=1",
    refresh,
  );
  // A symbol change renders before useFeed's effect runs. Never show another
  // instrument's cached projection during that render.
  const data = feed.data?.symbol === symbol ? feed.data : null;
  const bars = useMemo(
    () => completedDailyBars(data?.bars, data?.timezone || "Asia/Kolkata"),
    [data],
  );
  const [forecast, setForecast] = useState(null);
  useEffect(() => {
    if (!data) return;
    setForecast(null);
    const worker = new Worker(
      new URL("./forecast.worker.js", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = ({ data: answer }) =>
      setForecast(
        answer.error ? { error: answer.error } : { result: answer.result },
      );
    worker.onerror = () =>
      setForecast({ error: "Forecast calculation failed." });
    worker.postMessage({ bars, horizon: HORIZON, symbol });
    return () => worker.terminate();
  }, [data, bars, symbol, retryTick]);

  useEffect(() => {
    const close = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const pick = (next) => {
    setOpen(false);
    if (next && next !== symbol) onSymbol(next);
  };
  const submit = (event) => {
    event?.preventDefault();
    pick(resolveSymbol(query, suggestions));
  };

  const name = directory.get(symbol)?.name || data?.name || short(symbol);
  const result = forecast?.result ?? null;
  const point = result?.points.at(-1);
  const lastClose = result?.lastClose ?? bars.at(-1)?.close ?? data?.price ?? null;
  const change = point && lastClose ? (point.close / lastClose - 1) * 100 : null;
  const direction = change == null ? "" : change > 0.05 ? " ▲" : change < -0.05 ? " ▼" : " ·";
  const loadError = !data ? feed.error : null;

  return (
    <section className="panel fore-one" aria-label="Price forecast">
      <form className="fore-ask" onSubmit={submit} role="search">
        <label htmlFor="fore-ticker">Ticker</label>
        <div className="fore-box" ref={boxRef}>
          <Search size={18} aria-hidden="true" />
          <input
            id="fore-ticker"
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-controls="fore-suggest"
            aria-activedescendant={`fore-opt-${active}`}
            autoComplete="off"
            spellCheck={false}
            placeholder="RELIANCE, NVDA, BTC-USD…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActive((i) => Math.min(i + 1, suggestions.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && open && suggestions[active]) {
                e.preventDefault();
                pick(suggestions[active].symbol);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          <button
            className="button primary fore-go"
            type="submit"
            aria-label="Get forecast"
          >
            <ArrowRight size={18} />
          </button>
          {open && suggestions.length > 0 && (
            <ul id="fore-suggest" role="listbox" aria-label="Matching tickers">
              {suggestions.map((s, i) => (
                <li
                  key={s.symbol}
                  id={`fore-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? "active" : ""}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseMove={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(s.symbol);
                    }}
                  >
                    <strong>{short(s.symbol)}</strong>
                    <span>{s.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </form>
      <div className="fore-out">
        {point ? (
          <div aria-live="polite">
            <p className="fore-kicker">
              {name} · {point.date} · in {HORIZON} sessions{direction}
            </p>
            <strong className="fore-number">
              {fmt(point.close)} <small>{data.currency}</small>
            </strong>
            <p className="fore-sub">
              Last {fmt(lastClose)} ·{" "}
              <span className={change >= 0 ? "positive" : "negative"}>
                {change == null ? "—" : `${change >= 0 ? "+" : ""}${fmt(change, 2)}%`}
              </span>{" "}
              trend projection · experimental
            </p>
          </div>
        ) : forecast?.error || loadError ? (
          <div>
            <p className="fore-error" role="alert">
              {forecast?.error || `Couldn't load ${short(symbol)}. Check the ticker.`}
            </p>
            <button
              className="button"
              onClick={() =>
                forecast?.error ? setRetryTick((n) => n + 1) : onRefresh()
              }
            >
              Try again
            </button>
          </div>
        ) : (
          <div role="status" aria-busy="true" aria-label="Forecast is loading">
            <div className="fore-skel" aria-hidden="true" />
            <p className="fore-kicker">Forecasting {name}…</p>
          </div>
        )}
      </div>
    </section>
  );
}
