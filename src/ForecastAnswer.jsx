import { fmt } from "./format.js";

// The Forecast answer: the range the tested model expects, its centre, and a trend what-if beside it.
// The centre is usually the last close, because no tested model beat an unchanged price; leading with
// the range keeps that honest result from reading as a missing forecast. `point` is the forecast at the
// horizon, `whatIf` comes from trendScenario, and `evaluation` is the ticker's own backtest record.
export default function ForecastAnswer({ name, point, lastClose, currency, whatIf, evaluation, horizon = 10 }) {
  const digits = lastClose >= 1 ? 2 : 4;
  const price = (value) => fmt(value, digits);
  const rangePrice = (value) => fmt(value, lastClose >= 1000 ? 0 : digits);
  const signed = (value, places = 2) => `${value >= 0 ? "+" : ""}${fmt(value, places)}%`;
  const tone = (value) => (value >= 0 ? "positive" : "negative");
  const change = (point.close / lastClose - 1) * 100;
  const flat = Math.abs(change) <= 0.05;
  const moving = !!whatIf && Math.abs(whatIf.change) > 0.05;
  const tests = evaluation?.count || 0;
  const held = Math.round(((evaluation?.selected?.coverage80 ?? 0) * tests) / 100);
  return (
    <div aria-live="polite">
      <p className="fore-kicker">
        {name} · {point.date} · in {horizon} sessions
      </p>
      <strong className="fore-number fore-range">
        <span>{rangePrice(point.lower80)}</span>{" "}
        <span aria-hidden="true">–</span>
        <span className="fore-hidden"> to </span>{" "}
        <span>{rangePrice(point.upper80)}</span> <small>{currency}</small>
      </strong>
      <p className="fore-sub">Likely range · 8 in 10 outcomes</p>
      <p className="fore-line">
        Centre {price(point.close)}
        {flat ? (
          ", the last close. No clear direction."
        ) : (
          <>
            , <span className={tone(change)}>{signed(change)}</span> from the last close of {price(lastClose)}.
          </>
        )}
      </p>
      {whatIf && (
        <p className="fore-line">
          {moving ? (
            <>
              If the last {whatIf.sessions} sessions’ trend continued: <strong>{price(whatIf.close)}</strong>{" "}
              <span className={tone(whatIf.change)}>{signed(whatIf.change, 1)}</span>
              {whatIf.capped ? " (capped at 1% a session)" : ""}
            </>
          ) : (
            `The last ${whatIf.sessions} sessions show no trend to extend.`
          )}
        </p>
      )}
      <p className="fore-note">
        {moving && "The trend figure is a what-if, not a prediction: in testing, extending the trend was less accurate than assuming no change. "}
        {tests > 0 && `In ${tests} past forecasts for this ticker, the price finished inside the range ${held} times. `}
        Experimental.
      </p>
    </div>
  );
}
