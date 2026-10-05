import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  AreaSeries,
  LineSeries,
  HistogramSeries,
} from "lightweight-charts";
import { ema, bollinger, rsi, vwap } from "./marketMath";
import { fmt, compact } from "./data";
import { useTheme } from "./theme.jsx";
export default function Chart({
  bars,
  type,
  indicators,
  range,
  reset,
  levels,
  plan,
}) {
  const el = useRef(),
    [hover, setHover] = useState(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const { theme } = useTheme();
  useEffect(() => {
    if (!el.current) return;
    if (!bars?.length) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { color: "#111820" },
        textColor: "#8391a5",
        fontFamily: "IBM Plex Mono, ui-monospace, monospace",
        fontSize: 12,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#1c2632" },
        horzLines: { color: "#1c2632" },
      },
      rightPriceScale: {
        borderColor: "#1d3342",
        scaleMargins: { top: 0.12, bottom: 0.24 },
      },
      timeScale: {
        borderColor: "#1d3342",
        timeVisible: ["1d", "5d"].includes(range),
      },
      crosshair: {
        mode: 0,
        vertLine: { color: "#81aaff", labelBackgroundColor: "#0e3a47" },
        horzLine: { color: "#81aaff", labelBackgroundColor: "#0e3a47" },
      },
    });
    const series = chart.addSeries(
      type === "Candles" ? CandlestickSeries : AreaSeries,
      type === "Candles"
        ? {
            upColor: "#37d4a5",
            downColor: "#f07480",
            wickUpColor: "#37d4a5",
            wickDownColor: "#f07480",
            borderVisible: false,
          }
        : {
            lineColor: "#81aaff",
            topColor: "#81aaff30",
            bottomColor: "#81aaff00",
            lineWidth: 2,
          },
    );
    chartRef.current = chart;
    seriesRef.current = series;
    series.setData(
      bars.map((b) =>
        type === "Candles"
          ? {
              time: b.time,
              open: b.open,
              high: b.high,
              low: b.low,
              close: b.close,
            }
          : { time: b.time, value: b.close },
      ),
    );
    if (levels) {
      for (const [title, price] of [
        ["Prior H", levels.high],
        ["Prior L", levels.low],
      ])
        series.createPriceLine({
          price,
          title,
          color: "#e6bf78",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
        });
      for (const [title, price, color] of [
        ["P", levels.pivot, "#c9a8ff"],
        ["R1", levels.r1, "#f0748099"],
        ["S1", levels.s1, "#37d4a599"],
      ])
        if (Number.isFinite(price))
          series.createPriceLine({
            price,
            title,
            color,
            lineWidth: 1,
            lineStyle: 3,
            axisLabelVisible: true,
          });
    }
    if (plan) {
      for (const [key, title, color] of [
        ["entry", "Entry", "#91b4ff"],
        ["stop", "Stop", "#fa8996"],
        ["target", "Target", "#5dd6a5"],
      ]) {
        const price = Number(plan[key]);
        if (Number.isFinite(price) && price > 0)
          series.createPriceLine({
            price,
            title,
            color,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
          });
      }
    }
    const closes = bars.map((b) => b.close);
    const line = (values, color) => {
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(
        bars.flatMap((b, i) =>
          Number.isFinite(values[i])
            ? [{ time: b.time, value: values[i] }]
            : [],
        ),
      );
    };
    if (indicators.includes("EMA 20")) line(ema(closes, 20), "#81aaff");
    if (indicators.includes("EMA 50")) line(ema(closes, 50), "#b4a1ff");
    if (indicators.includes("Bollinger")) {
      const b = bollinger(closes);
      line(
        b.map((x) => x?.upper),
        "#3f7ca8",
      );
      line(
        b.map((x) => x?.lower),
        "#3f7ca8",
      );
    }
    if (indicators.includes("VWAP") && typeof bars[0]?.time === "number") {
      const v = vwap(bars);
      if (v.some(Number.isFinite)) line(v, "#f3c969");
    }
    if (indicators.includes("Volume")) {
      const s = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      s.setData(
        bars.map((b) => ({
          time: b.time,
          value: b.volume,
          color: b.close >= b.open ? "#37d4a536" : "#f0748036",
        })),
      );
    }
    if (indicators.includes("RSI 14")) {
      const s = chart.addSeries(
        LineSeries,
        { color: "#81aaff", lineWidth: 2, priceLineVisible: false },
        1,
      );
      const values = rsi(closes);
      s.setData(
        bars.flatMap((b, i) =>
          values[i] === null ? [] : [{ time: b.time, value: values[i] }],
        ),
      );
      s.createPriceLine({
        price: 70,
        color: "#f07480",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "70",
      });
      s.createPriceLine({
        price: 30,
        color: "#37d4a5",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "30",
      });
      try {
        chart.panes()[1]?.setHeight(110);
      } catch {}
    }
    const byTime = new Map(bars.map((b) => [b.time, b]));
    chart.subscribeCrosshairMove((p) => {
      const b = p?.time == null ? null : byTime.get(p.time);
      setHover(b || null);
    });
    chart.timeScale().fitContent();
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [
    bars,
    type,
    indicators,
    range,
    reset,
    levels,
    plan?.entry,
    plan?.stop,
    plan?.target,
  ]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const light = theme === "light";
    const accent = light ? "#245ec9" : "#81aaff";
    const line = light ? "#e4eaf2" : "#1c2632";
    const border = light ? "#d5deea" : "#1d3342";
    chart.applyOptions({
      layout: {
        background: { color: light ? "#ffffff" : "#111820" },
        textColor: light ? "#56677e" : "#8391a5",
      },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border },
      crosshair: {
        vertLine: { color: accent, labelBackgroundColor: light ? "#245ec9" : "#0e3a47" },
        horzLine: { color: accent, labelBackgroundColor: light ? "#245ec9" : "#0e3a47" },
      },
    });
    seriesRef.current?.applyOptions(
      type === "Candles"
        ? {
            upColor: light ? "#147653" : "#37d4a5",
            downColor: light ? "#bb354b" : "#f07480",
            wickUpColor: light ? "#147653" : "#37d4a5",
            wickDownColor: light ? "#bb354b" : "#f07480",
          }
        : { lineColor: accent, topColor: `${accent}30`, bottomColor: `${accent}00` },
    );
  }, [theme, bars, type, indicators, range, reset, levels, plan?.entry, plan?.stop, plan?.target]);
  if (!bars?.length)
    return (
      <div className="empty">
        <h3>No bars to display</h3>
        <p>Try another range.</p>
      </div>
    );
  const b = hover && bars.includes(hover) ? hover : bars?.at(-1);
  return (
    <>
      <div className="ohlc">
        <span>
          {b
            ? typeof b.time === "number"
              ? new Date(b.time * 1000).toLocaleString()
              : b.time
            : "—"}
        </span>
        <span>
          O <b>{fmt(b?.open)}</b>
        </span>
        <span>
          H <b>{fmt(b?.high)}</b>
        </span>
        <span>
          L <b>{fmt(b?.low)}</b>
        </span>
        <span>
          C <b>{fmt(b?.close)}</b>
        </span>
        <span>
          VOL <b>{compact(b?.volume)}</b>
        </span>
      </div>
      <div
        ref={el}
        className="chart-canvas"
        aria-label="Interactive price chart: drag to pan and scroll to zoom"
      />
    </>
  );
}
