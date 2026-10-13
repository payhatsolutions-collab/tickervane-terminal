import { Component, useRef, useState } from "react";
import { Star, X } from "lucide-react";
import Chart from "./Chart.jsx";
import { growthEvent } from "./growth.js";

class ChartErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { growthEvent("chart_render_failed"); }
  render() {
    return this.state.failed
      ? <div className="empty"><h3>Chart failed to render</h3><p>Try another range or reload.</p></div>
      : this.props.children;
  }
}

// Mounted once per stock. Refreshes and indicator changes are not new opens.
export default function ResearchChart({ symbol, saved, onSave, ...chartProps }) {
  const ready = useRef(false);
  const interacted = useRef(false);
  const [showSave, setShowSave] = useState(false);
  const onReady = () => {
    if (ready.current) return;
    ready.current = true;
    growthEvent("chart_opened", { source: "charts" });
  };
  const onInteract = () => {
    if (!ready.current || interacted.current) return;
    interacted.current = true;
    growthEvent("chart_interacted", { source: "charts" });
    setShowSave(true);
  };
  return <>
    <ChartErrorBoundary key={chartProps.range}>
      <Chart {...chartProps} onReady={onReady} onInteract={onInteract} />
    </ChartErrorBoundary>
    {showSave && !saved && <div className="research-save" role="region" aria-label="Save this stock">
      <div><strong>Keep researching {symbol.replace(/\.NS$/, "")}.</strong><span>Save it to your watchlist in this browser.</span></div>
      <button className="button" onClick={onSave}><Star size={16} /> Save this stock</button>
      <button className="icon-button" aria-label="Dismiss save suggestion" onClick={() => { setShowSave(false); growthEvent("save_suggestion_dismissed"); }}><X size={16} /></button>
    </div>}
  </>;
}
