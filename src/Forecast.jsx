import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Download, RefreshCw, Search } from "lucide-react";
import { useFeed } from "./hooks";
import { directory, fmt, pct, short } from "./data";
import { projectPrices } from "./marketMath";
import { completedDailyBars } from "./tradeMath";
import { Empty, PanelTitle, exportCSV, tone } from "./ui";

const horizons = [5, 10, 20, 30];
const path = (points, x, y) =>
  points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.close)}`).join(" ");

function ForecastChart({ bars, result, symbol, currency }) {
  const [hover, setHover] = useState(null);
  const history = bars.slice(-45);
  const future = result.points;
  const points = [...history.map((b) => ({ ...b, date: b.time })), ...future];
  const values = [
    ...history.flatMap((b) => [b.low, b.high]),
    ...future.flatMap((p) => [p.lower, p.upper]),
  ];
  const min = Math.min(...values),
    max = Math.max(...values);
  const padding = Math.max((max - min) * 0.08, max * 0.002);
  const bottom = min - padding,
    top = max + padding;
  const width = 960,
    left = 85,
    right = 932;
  const x = (i) => left + (i / (points.length - 1)) * (right - left);
  const y = (value) => 330 - ((value - bottom) / (top - bottom)) * 285;
  const lastIndex = history.length - 1;
  const bridge = [
    {
      date: history.at(-1).time,
      close: history.at(-1).close,
      lower: history.at(-1).close,
      upper: history.at(-1).close,
    },
    ...future,
  ];
  const band = [
    ...bridge.map((p, i) => `${x(lastIndex + i)},${y(p.upper)}`),
    ...[...bridge]
      .reverse()
      .map((p, i) => `${x(points.length - 1 - i)},${y(p.lower)}`),
  ].join(" ");
  const index = Math.min(hover ?? lastIndex, points.length - 1);
  const active = points[index];
  const projected = index > lastIndex;
  return (
    <>
      <div className="forecast-readout">
        <strong>{active.date}</strong>
        <span>
          {projected ? "Projected median" : "Historical close"}{" "}
          <b>
            {fmt(active.close)} {currency}
          </b>
        </span>
        {projected && (
          <span>
            95% interval {fmt(active.lower)} – {fmt(active.upper)}
          </span>
        )}
      </div>
      <div className="forecast-plot">
        <svg
          viewBox={`0 0 ${width} 385`}
          role="img"
          aria-label={`${symbol}: historical daily candles, projected median and 95% model interval for ${future.length} weekdays`}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const px = ((event.clientX - rect.left) / rect.width) * width;
            setHover(
              Math.max(
                0,
                Math.min(
                  points.length - 1,
                  Math.round(
                    ((px - left) / (right - left)) * (points.length - 1),
                  ),
                ),
              ),
            );
          }}
          onPointerLeave={() => setHover(null)}
        >
          <rect
            x={x(lastIndex)}
            y="28"
            width={right - x(lastIndex)}
            height="310"
            fill="var(--accent)"
            opacity=".04"
          />
          {[0, 1, 2, 3, 4].map((i) => {
            const v = bottom + ((top - bottom) * i) / 4;
            return (
              <g key={i}>
                <line
                  x1={left}
                  x2={right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="var(--line)"
                />
                <text x={left - 12} y={y(v) + 4} textAnchor="end">
                  {fmt(v, 1)}
                </text>
              </g>
            );
          })}
          {history.map((b, i) => {
            const color = b.close >= b.open ? "var(--green)" : "var(--red)";
            return (
              <g key={b.time}>
                <line
                  x1={x(i)}
                  x2={x(i)}
                  y1={y(b.high)}
                  y2={y(b.low)}
                  stroke={color}
                />
                <rect
                  x={x(i) - 3.5}
                  width="7"
                  y={Math.min(y(b.open), y(b.close))}
                  height={Math.max(1, Math.abs(y(b.close) - y(b.open)))}
                  fill={color}
                />
              </g>
            );
          })}
          <polygon points={band} fill="var(--accent)" opacity=".18" />
          <path
            d={path(bridge, (i) => x(lastIndex + i), y)}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeDasharray="6 4"
          />
          <line
            x1={x(lastIndex)}
            x2={x(lastIndex)}
            y1="28"
            y2="340"
            stroke="var(--muted)"
            strokeDasharray="4 5"
          />
          <text x={x(lastIndex) + 8} y="20">
            Projection →
          </text>
          <circle
            cx={right}
            cy={y(future.at(-1).close)}
            r="4"
            fill="var(--accent)"
          />
          {hover != null && (
            <>
              <line
                x1={x(index)}
                x2={x(index)}
                y1="28"
                y2="340"
                stroke="var(--muted)"
                strokeDasharray="3 4"
              />
              <circle
                cx={x(index)}
                cy={y(active.close)}
                r="3.5"
                fill="var(--text)"
              />
            </>
          )}
          <text x={left} y="367">
            {history[0].time}
          </text>
          <text x={right} y="367" textAnchor="end">
            {future.at(-1).date}
          </text>
        </svg>
      </div>
      <div className="forecast-legend">
        <span>
          <i className="history" />
          Daily candles
        </span>
        <span>
          <i className="median" />
          Projected median
        </span>
        <span>
          <i className="interval" />
          95% model interval
        </span>
      </div>
    </>
  );
}

export default function Forecast({
  symbol,
  refresh,
  onRefresh,
  onSearch,
  onOpenChart,
}) {
  const [horizon, setHorizon] = useState(() => {
    const value = Number(new URLSearchParams(location.search).get("horizon"));
    return horizons.includes(value) ? value : 10;
  });
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("horizon", horizon);
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search,
    );
  }, [horizon]);
  useEffect(() => {
    const restore = () => {
      const value = Number(new URLSearchParams(location.search).get("horizon"));
      setHorizon(horizons.includes(value) ? value : 10);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const feed = useFeed(
    "/api/market?op=chart&symbol=" +
      encodeURIComponent(symbol) +
      "&range=1y&adjusted=1",
    refresh,
  );
  // A symbol change renders before useFeed's effect runs. Never show another
  // instrument's cached projection during that render.
  const data = feed.data?.symbol === symbol ? feed.data : null;
  const bars = useMemo(
    () => completedDailyBars(data?.bars, data?.timezone || "Asia/Kolkata"),
    [data],
  );
  const forecast = useMemo(() => {
    if (!data) return {};
    try {
      return { result: projectPrices(bars, horizon) };
    } catch (e) {
      return { error: e.message };
    }
  }, [data, bars, horizon]);
  const result = forecast.result,
    end = result?.points.at(-1),
    last = bars.at(-1);
  const stale =
    last && Date.now() - Date.parse(last.time + "T23:59:59Z") > 5 * 86400000;
  const name = directory.get(symbol)?.name || data?.name || symbol;
  return (
    <section className="panel forecast-workspace" aria-label="Price forecast">
      <PanelTitle title="Price forecast" tag="FORE">
        <button className="button" onClick={onOpenChart}>
          Open chart <ArrowUpRight size={14} />
        </button>
      </PanelTitle>
      <div className="forecast-toolbar">
        <button className="button forecast-symbol" onClick={onSearch}>
          <Search size={16} />
          <strong>{short(symbol)}</strong>
          <span>{name}</span>
        </button>
        <button
          className="icon-button"
          aria-label="Refresh forecast history"
          onClick={onRefresh}
        >
          <RefreshCw size={15} className={feed.loading ? "spin" : ""} />
        </button>
      </div>
      <div className="forecast-controls">
        <span>Forecast horizon</span>
        <div className="segments" role="group" aria-label="Forecast horizon">
          {horizons.map((days) => (
            <button
              key={days}
              className={horizon === days ? "active" : ""}
              aria-pressed={horizon === days}
              onClick={() => setHorizon(days)}
            >
              {days} weekdays
            </button>
          ))}
        </div>
      </div>
      {!data && !feed.error && (
        <div role="status">
          <Empty
            title="Loading daily history"
            description={`${name} · One year of adjusted prices`}
          />
        </div>
      )}
      {feed.error && (
        <div className="notice" role="alert">
          {feed.error}
          {data ? " · Using cached history." : ""}{" "}
          <button className="button" onClick={onRefresh}>
            Retry
          </button>
        </div>
      )}
      {data && (
        <>
          <p className="forecast-data-note">
            Yahoo Finance · adjusted daily prices · last completed close{" "}
            {last?.time || "unavailable"} · {data.currency} ·{" "}
            {feed.loading
              ? "Refreshing history…"
              : "Current exchange date excluded"}
          </p>
          {stale && (
            <p className="notice" role="status">
              History is more than 5 days old. This projection starts from the
              last available close shown above.
            </p>
          )}
          {forecast.error && (
            <Empty title="Forecast unavailable" description={forecast.error} />
          )}
          {result && (
            <>
              <div className="forecast-cards">
                <article>
                  <span>Projected median · {end.date}</span>
                  <strong>
                    {fmt(end.close)} <small>{data.currency}</small>
                  </strong>
                  <p className={tone(result.change)}>
                    {pct(result.change)} from last completed close
                  </p>
                </article>
                <article>
                  <span>95% model interval at horizon</span>
                  <strong>
                    {fmt(end.lower)} – {fmt(end.upper)}
                  </strong>
                  <p>Model uncertainty, not a guaranteed range</p>
                </article>
                <article>
                  <span>Holdout error · MAPE</span>
                  <strong>{fmt(result.mape)}%</strong>
                  <p>Across {result.holdout} withheld sessions</p>
                </article>
              </div>
              <ForecastChart
                key={symbol + horizon}
                bars={bars}
                result={result}
                symbol={symbol}
                currency={data.currency}
              />
              <details className="forecast-details">
                <summary>How this forecast works</summary>
                <p>
                  {result.model}, fitted to {result.observations} completed
                  daily prices. A withheld tail selects between a drift model
                  and a flat random-walk baseline; the selected model is then
                  refitted to the full history. Holdout error describes that
                  selection window, not future accuracy.
                </p>
                <p>
                  The interval assumes independent, normally distributed log
                  returns and excludes model-selection uncertainty. Dates skip
                  weekends but include exchange holidays. Historical patterns
                  can break; this is an educational projection, not a
                  recommendation.
                </p>
              </details>
              <details className="forecast-details">
                <summary>Projected daily values</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Median · {data.currency}</th>
                        <th>Lower 95%</th>
                        <th>Upper 95%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.points.map((p) => (
                        <tr key={p.date}>
                          <td>{p.date}</td>
                          <td className="number">{fmt(p.close)}</td>
                          <td className="number">{fmt(p.lower)}</td>
                          <td className="number">{fmt(p.upper)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <div className="panel-foot">
                <span>
                  {result.model} · {result.observations} daily prices · Research
                  only
                </span>
                <button
                  className="button"
                  onClick={() =>
                    exportCSV(
                      [
                        [
                          "Date",
                          "Projected median",
                          "Lower 95%",
                          "Upper 95%",
                          "Currency",
                        ],
                        ...result.points.map((p) => [
                          p.date,
                          p.close,
                          p.lower,
                          p.upper,
                          data.currency,
                        ]),
                      ],
                      `alphanova-forecast-${short(symbol)}-${horizon}d.csv`,
                    )
                  }
                >
                  <Download size={14} /> Export forecast
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
