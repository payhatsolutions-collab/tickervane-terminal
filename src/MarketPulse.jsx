import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { marketMood } from "./marketMood.js";
import { pct } from "./data.js";
import "./market-motion.css";

// Reset on a fresh app load; retained across workspace navigation and foreground returns.
let openingPlayed = false;

const MARKET_ART = { bull: "/market/bull-emerald.webp", bear: "/market/bear-crimson.webp" };

function Animal({ direction, animated = false }) {
  return <div className={`market-animal market-animal-art ${animated ? "is-playing" : ""}`} aria-hidden="true">
    <span className="animal-aura" />
    <img className="animal-illustration" src={MARKET_ART[direction]} width="1050" height="700" alt="" decoding="async" draggable="false" />
    <span className="animal-ground-glow" />
    {direction === "bear" && animated && <span className="bear-swipe-trails"><i /><i /><i /></span>}
  </div>;
}

export default function MarketPulse({ quote, loading = false }) {
  const mood = marketMood(quote);
  const artSrc = MARKET_ART[mood.direction];
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [playing, setPlaying] = useState(false);
  const [loadedArt, setLoadedArt] = useState(null);
  useEffect(() => {
    if (!artSrc) return;
    let active = true;
    const art = new Image();
    art.src = artSrc;
    art.decode().then(() => { if (active) setLoadedArt(artSrc); }).catch(() => {});
    return () => { active = false; };
  }, [artSrc]);
  const artworkReady = Boolean(artSrc && loadedArt === artSrc);
  const [replay, setReplay] = useState(0);
  const previous = useRef(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { setReduced(media.matches); if (media.matches) setPlaying(false); };
    const visibility = () => {
      if (document.hidden) setPlaying(false);
    };
    media.addEventListener("change", sync);
    document.addEventListener("visibilitychange", visibility);
    return () => { media.removeEventListener("change", sync); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    if (previous.current !== mood.key) setPlaying(false);
    previous.current = mood.key;
    if (openingPlayed || !mood.key || !["bull", "bear"].includes(mood.direction) || reduced || document.hidden || !artworkReady) return;
    openingPlayed = true;
    setPlaying(true);
    setReplay(value => value + 1);
  }, [mood.key, mood.direction, reduced, artworkReady]);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setPlaying(false), 2800);
    const escape = event => { if (event.key === "Escape") setPlaying(false); };
    window.addEventListener("keydown", escape);
    return () => { clearTimeout(timer); window.removeEventListener("keydown", escape); };
  }, [playing, replay]);
  const canPlay = !reduced && artworkReady;
  const description = mood.change === null ? "Nifty 50 session change unavailable" : `Nifty 50 ${pct(mood.change)}. As of ${mood.stamp} IST. Session move, not a forecast.`;
  if (mood.direction === "unknown") return null;
  return <><button className={`market-pulse ${mood.direction}`} title={`${description}${canPlay ? " Tap to replay." : ""}`} aria-label={`${description}${canPlay ? " Replay market animation" : ""}`} disabled={!canPlay} onClick={() => { setReplay(value => value + 1); setPlaying(true); }}>
    <Animal direction={mood.direction} />
    <span className="market-pulse-copy"><span>NIFTY 50</span><strong>{mood.change === null ? loading ? "Updating…" : "Unavailable" : pct(mood.change)}</strong><small>{mood.date ? `${mood.date} · session` : "Awaiting quote"}</small></span>
  </button>
    {playing && !reduced && createPortal(<div key={replay} className={`market-entrance ${mood.direction}`} data-market-entrance onClick={() => setPlaying(false)}>
      <button className="market-entrance-skip" onClick={() => setPlaying(false)} aria-label="Dismiss market animation">Skip animation ×</button>
      <div className="market-entrance-scene" role="status" aria-live="polite">
        <span className="market-entrance-label">ALPHA NOVA · MARKET PULSE</span>
        <Animal direction={mood.direction} animated />
        <div className="market-entrance-quote"><span>NIFTY 50</span><strong>{pct(mood.change)}</strong><small>{mood.date} · Session change</small></div>
      </div>
    </div>, document.body)}
  </>;
}
