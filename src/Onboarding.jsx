import { useMemo, useState } from "react";
import { ArrowUpRight, Bell, Check, ChevronRight, Search, Star } from "lucide-react";
import { directory, instruments } from "./data.js";
import { growthEvent } from "./growth.js";

const examples = ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS"];
export const demoURL = (page, symbol = "RELIANCE.NS") =>
  `/?page=${page}&symbol=${encodeURIComponent(symbol)}&range=6mo`;

export function ViewLink({ page, symbol, onNavigate, children, className = "link" }) {
  return <a className={className} href={demoURL(page, symbol)} onClick={(event) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate({ page, ...(symbol ? { symbol } : {}) });
  }}>{children}</a>;
}

export default function Onboarding({ state, onState, watch, onToggle, onNavigate, onAlert, alerts, pushOn }) {
  const [query, setQuery] = useState("");
  const [alertSymbol, setAlertSymbol] = useState("");
  const count = Math.min(new Set(watch).size, 3);
  const selected = watch.includes(alertSymbol) ? alertSymbol : watch[0];
  const activeAlert = alerts.some((alert) => watch.includes(alert.symbol) && !alert.triggered);
  const step = ["return", "alerts"].includes(state.status) && count < 3 ? "choose" : state.status;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? instruments.filter((x) => x.symbol.endsWith(".NS") &&
      `${x.symbol} ${x.name}`.toLowerCase().includes(q)).slice(0, 6) : examples.map((x) => directory.get(x));
  }, [query]);
  if (["skipped", "complete", "hidden"].includes(step)) return null;
  const advance = (status) => {
    onState({ ...state, status });
    growthEvent(status === "choose" ? "onboarding_started" : status === "complete" ? "onboarding_completed" : "onboarding_step_completed", { step: status });
  };
  const skip = () => {
    onState({ ...state, status: "skipped" });
    growthEvent("onboarding_skipped", { step, stock_count: watch.length });
  };
  return <section className={`first-visit first-visit-${step}`} aria-labelledby="first-visit-title">
    <div className="first-visit-top"><span className="eyebrow">YOUR FIRST ALPHA NOVA WATCHLIST</span>
      <button className="link" onClick={skip}>Skip interactive guide</button></div>
    <div className="first-visit-layout">
      <div className="first-visit-story">
        <ol className="first-visit-steps" aria-label="Getting started">
          {["Save 3 stocks", "Find them again", "Choose alerts"].map((label, i) =>
            <li key={label} aria-current={i === (step === "return" ? 1 : step === "alerts" ? 2 : 0) ? "step" : undefined}>
              <span>{i === 0 && count === 3 ? <Check size={12} /> : i + 1}</span>{label}</li>)}
        </ol>
        <h2 id="first-visit-title">{step === "welcome" ? <>Your market.<br /><span>Your three stocks.</span></> :
          step === "choose" ? <>Three stocks.<br /><span>One place to return.</span></> :
          step === "return" ? <>Saved. Ready<br /><span>for your next visit.</span></> :
          <>Follow the moves<br /><span>that matter to you.</span></>}</h2>
        <p>{step === "welcome" ? "Start with three stocks you want to follow. Save them now, revisit their charts tomorrow, and choose when to hear about a price move." :
          step === "choose" ? "Tap the star to save a stock. Pick from these examples or search for your own. Each chart opens as a shareable view." :
          step === "return" ? "Your stocks are in Watchlist under Personal. On mobile, tap More → Watchlist. Bookmark the view and come back to see what changed." :
          "Pick a saved stock and set a price above or below which you want an alert. You choose the target; notifications are optional."}</p>
        <p className="first-visit-note">Saved in this browser. Example stocks are for learning, not recommendations.</p>
        {step === "welcome" && <button className="button primary" onClick={() => advance("choose")}>Build my watchlist <ChevronRight size={16} /></button>}
        {step === "choose" && <button className="button primary" disabled={count < 3} onClick={() => { advance("return"); onNavigate({ page: "Watchlist" }); }}>
          {count < 3 ? `Save ${3 - count} more ${count === 2 ? "stock" : "stocks"}` : "Find my saved stocks"} <ChevronRight size={16} /></button>}
        {step === "return" && <button className="button primary" onClick={() => advance("alerts")}>Next: choose an alert <Bell size={15} /></button>}
        {step === "alerts" && <button className="button" onClick={() => { advance("complete"); onNavigate({ page: "Watchlist" }); }}>Finish guide <Check size={15} /></button>}
      </div>
      <div className="first-visit-demo" key={step}>
        {["welcome", "choose"].includes(step) ? <>
          <div className="first-visit-progress"><strong>{count} / 3 saved</strong><span aria-live="polite">{count === 3 ? "Your watchlist is ready" : "Make it yours"}</span></div>
          <div className="first-visit-slots" aria-label={`${count} of 3 stocks saved`}>{[0, 1, 2].map((i) => <div className={i < count ? "filled" : ""} key={i}>{i < count ? <Check size={16} /> : <Star size={16} />}<span>{watch[i]?.replace(/\.NS$/, "") || `Stock ${i + 1}`}</span></div>)}</div>
          {step === "choose" && <label className="first-visit-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a stock or company" aria-label="Search stocks for your watchlist" /></label>}
          <div className="first-visit-stocks">{rows.map((stock) => stock && <div key={stock.symbol}>
            <div><strong>{stock.symbol.replace(/\.NS$/, "")}</strong><span>{stock.name}</span></div>
            <ViewLink page="Terminal" symbol={stock.symbol} onNavigate={onNavigate}>Chart <ArrowUpRight size={12} /></ViewLink>
            <button className={`icon-button ${watch.includes(stock.symbol) ? "starred" : ""}`} aria-label={`${watch.includes(stock.symbol) ? "Remove" : "Save"} ${stock.symbol.replace(/\.NS$/, "")} ${watch.includes(stock.symbol) ? "from" : "to"} watchlist`} aria-pressed={watch.includes(stock.symbol)} onClick={() => { if (step === "welcome") advance("choose"); onToggle(stock.symbol); }}><Star size={18} fill={watch.includes(stock.symbol) ? "currentColor" : "none"} /></button>
          </div>)}{!rows.length && <p>No stocks found. Try another name or symbol.</p>}</div>
        </> : step === "return" ? <div className="first-visit-return">
          <div className="first-visit-success"><Check size={28} /></div><h3>Your watchlist has a home.</h3>
          <div className="first-visit-mini-nav"><span>PERSONAL</span><strong><Star size={16} /> Watchlist <span>{watch.length}</span></strong><span>Portfolio · Trade journal · Price alerts</span></div>
          <ViewLink page="Watchlist" onNavigate={onNavigate} className="button primary">Open my watchlist <ArrowUpRight size={15} /></ViewLink>
          <p>Bookmark this link for your next visit. It opens the list saved in this browser; it doesn’t transfer your saved stocks to other devices.</p>
        </div> : <div className="first-visit-return">
          <Bell size={30} className="positive" /><h3>A useful reason to return.</h3>
          <label>Choose a saved stock<select value={selected || ""} onChange={(e) => setAlertSymbol(e.target.value)}>{watch.map((s) => <option key={s} value={s}>{s.replace(/\.NS$/, "")}</option>)}</select></label>
          <ViewLink page="Terminal" symbol={selected} onNavigate={onNavigate}>Review its shareable chart <ArrowUpRight size={13} /></ViewLink>
          <button className="button primary" disabled={!selected} onClick={() => onAlert(selected)}><Bell size={15} /> Set a price alert</button>
          <p aria-live="polite">{activeAlert ? "Price alert saved. " : "Set a target you care about. "}{pushOn ? "Push notifications are on." : "In-app checks work while open. Enable push in Price alerts for delivery with the app closed."}</p>
          <ViewLink page="Alerts" symbol={selected} onNavigate={onNavigate}>Open alert settings <ArrowUpRight size={13} /></ViewLink>
        </div>}
      </div>
    </div>
  </section>;
}
