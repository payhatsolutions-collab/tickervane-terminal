import { useState } from "react";
import { BellRing, X } from "lucide-react";
import { pushSupported } from "./push.js";
import { growthEvent } from "./growth.js";

const HIDE_KEY = "an2-push-offer-hidden";
const HIDE_FOR = 14 * 24 * 3600e3;

function hiddenUntil() {
  try { return Number(localStorage.getItem(HIDE_KEY)) || 0; } catch { return 0; }
}

/** Home-page opt-in for market-hours push. Permission is asked only when the reader taps Turn on. */
export default function PushOffer({ on, busy, onEnable }) {
  const [hidden, setHidden] = useState(() => hiddenUntil() > Date.now());
  const blocked = typeof Notification !== "undefined" && Notification.permission === "denied";
  // iPhone/iPad Safari exposes push only inside the installed app, so pushSupported() hides it there.
  if (on || hidden || blocked || !pushSupported()) return null;
  const hide = () => {
    try { localStorage.setItem(HIDE_KEY, String(Date.now() + HIDE_FOR)); } catch { /* private mode */ }
    setHidden(true);
    growthEvent("push_offer_dismissed");
  };
  return (
    <section className="panel push-offer" aria-labelledby="push-offer-title">
      <span className="push-offer-icon" aria-hidden="true"><BellRing size={18} /></span>
      <div className="push-offer-copy">
        <strong id="push-offer-title">Market alerts on your phone</strong>
        <span>Nifty’s open and big moves, watchlist stocks moving 3% or more, and your price alerts. About hourly, 9:30 to 3:30 on trading days.</span>
      </div>
      <div className="push-offer-actions">
        <button className="button primary" disabled={busy} onClick={() => { growthEvent("push_offer_accepted"); onEnable(); }}>
          {busy ? "Turning on…" : "Turn on"}
        </button>
        <button className="icon-button" aria-label="Hide market alerts offer" onClick={hide}><X size={16} /></button>
      </div>
    </section>
  );
}
