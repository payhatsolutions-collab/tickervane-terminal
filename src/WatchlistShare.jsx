import { useEffect, useRef, useState } from "react";
import { Check, Copy, Share2, X } from "lucide-react";
import { directory, short } from "./data.js";
import { growthEvent } from "./growth.js";
import { mergeWatchlist, watchlistURL } from "./watchlistTools.js";
import "./watchlist-tools.css";

export function SharedWatchlist({ shared, watch, onImport, onDismiss, onNavigate }) {
  const [selected, setSelected] = useState(shared.symbols);
  const available = shared.symbols.filter(symbol => directory.has(symbol));
  const chosen = available.filter(symbol => selected.includes(symbol));
  const preview = mergeWatchlist(watch, chosen);
  const unavailable = shared.symbols.length - available.length;
  return <section className="shared-watchlist panel" aria-labelledby="shared-list-title">
    <div className="watch-brief-heading"><div><span className="desk-kicker">SHARED WITH YOU</span><h2 id="shared-list-title">A stock list to explore</h2></div><button className="icon-button" aria-label="Dismiss shared list" onClick={onDismiss}><X size={18} /></button></div>
    {shared.error ? <p role="status">{shared.error}</p> : <>
      <p>Preview the stocks, then save the ones you want to follow. Your existing watchlist stays intact.</p>
      <div className="shared-stock-grid">{shared.symbols.map(symbol => <div key={symbol}>
        <label><input type="checkbox" checked={selected.includes(symbol) && directory.has(symbol)} disabled={!directory.has(symbol) || watch.includes(symbol)} onChange={event => setSelected(current => event.target.checked ? [...current, symbol] : current.filter(item => item !== symbol))} /><span><strong>{short(symbol)}</strong><small>{watch.includes(symbol) ? "Already saved" : directory.get(symbol)?.name || "Not in the current directory"}</small></span></label>
        {directory.has(symbol) && <button className="link" onClick={() => onNavigate({ page: "Terminal", symbol })}>Chart</button>}
      </div>)}</div>
      {unavailable > 0 && <p>{unavailable} {unavailable === 1 ? "symbol is" : "symbols are"} unavailable in the current directory. Available symbols can still be saved.</p>}
      {preview.overflow > 0 && <p role="status">Your list has room for {preview.added.length} more. {preview.overflow} selected stocks won’t fit in the 40-stock limit.</p>}
      <div className="shared-list-actions"><button className="button primary" disabled={!preview.added.length} onClick={() => onImport(chosen)}><Check size={15} /> {preview.added.length ? `Save ${preview.added.length} to my watchlist` : "No new stocks selected"}</button><button className="button" onClick={onDismiss}>Dismiss</button></div>
      <p className="share-note">Research ideas, not recommendations. Saved in this browser. No account needed.</p>
    </>}
  </section>;
}

export default function WatchlistShare({ watch }) {
  const dialog = useRef(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = watch.filter(symbol => selected.includes(symbol));
  const link = chosen.length ? watchlistURL(location.origin, chosen) : "";
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const copy = async () => {
    setBusy(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(link);
      setMessage("Link copied. Anyone with it can preview these stocks and save their own copy.");
      growthEvent("watchlist_share_copied", { stock_count: chosen.length });
    } catch { setMessage("Copy wasn’t available. Select and copy the link below."); }
    finally { setBusy(false); }
  };
  const share = async () => {
    setBusy(true);
    try {
      await navigator.share({ title: "A stock list to explore · Alpha Nova", text: `Explore ${chosen.length} stocks on Alpha Nova. Save your own watchlist, free.`, url: link });
      setMessage("Share handed off to your device.");
      growthEvent("watchlist_share_handoff", { stock_count: chosen.length });
    } catch (error) { if (error.name !== "AbortError") setMessage("Sharing wasn’t available. Use Copy link below."); }
    finally { setBusy(false); }
  };
  return <>
    <button className="button" disabled={!watch.length} onClick={() => { setSelected([...watch]); setMessage(""); setOpen(true); growthEvent("watchlist_share_opened", { stock_count: watch.length }); }}><Share2 size={15} /> Share stocks</button>
    <dialog className="dialog watch-share-dialog" ref={dialog} aria-labelledby="watch-share-title" onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onClick={event => { if (event.target === dialog.current) setOpen(false); }}>
      <div className="watch-brief-heading"><h2 id="watch-share-title">Share a stock list</h2><button className="icon-button" aria-label="Close sharing" onClick={() => setOpen(false)}><X size={20} /></button></div>
      <p>Give someone a useful starting point. Choose the stocks they’ll see before you share.</p>
      <div className="share-selection"><strong>{chosen.length} selected</strong><button className="link" onClick={() => { setSelected(chosen.length === watch.length ? [] : [...watch]); setMessage(""); }}>{chosen.length === watch.length ? "Clear selection" : "Select all"}</button></div>
      <div className="share-stock-options">{watch.map(symbol => <label key={symbol}><input type="checkbox" checked={chosen.includes(symbol)} onChange={event => { setSelected(current => event.target.checked ? [...current, symbol] : current.filter(item => item !== symbol)); setMessage(""); }} /><span><strong>{short(symbol)}</strong><small>{directory.get(symbol)?.name || symbol}</small></span></label>)}</div>
      <p className="share-note">Only these symbols are included. Holdings, amounts, alerts and journal notes stay private. This is a snapshot; future changes won’t sync.</p>
      <div className="shared-list-actions">{typeof navigator.share === "function" && <button className="button primary" disabled={!link || busy} onClick={share}><Share2 size={15} /> Share…</button>}<button className="button" disabled={!link || busy} onClick={copy}><Copy size={15} /> Copy link</button></div>
      {link && <label className="share-url">Shareable link<input readOnly value={link} onFocus={event => event.target.select()} /></label>}
      <p role="status" className="share-status">{message}</p>
    </dialog>
  </>;
}
