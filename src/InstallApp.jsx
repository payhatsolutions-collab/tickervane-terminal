import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Check, Smartphone, X } from "lucide-react";

export default function InstallApp() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    const mode = window.matchMedia("(display-mode: standalone)");
    const sync = () => setInstalled(mode.matches || navigator.standalone === true);
    const available = event => { event.preventDefault(); setPrompt(event); };
    const done = () => { setInstalled(true); setPrompt(null); setOpen(false); };
    sync();
    mode.addEventListener("change", sync);
    window.addEventListener("beforeinstallprompt", available);
    window.addEventListener("appinstalled", done);
    return () => {
      mode.removeEventListener("change", sync);
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const install = async () => {
    if (!prompt) { setOpen(true); return; }
    setBusy(true);
    try {
      await prompt.prompt();
      const result = await prompt.userChoice;
      if (result.outcome === "accepted") { setInstalled(true); setOpen(false); }
    } catch { setOpen(true); }
    finally { setPrompt(null); setBusy(false); }
  };
  if (installed) return <div className="app-installed"><Check size={15} /><span>App installed</span></div>;
  return <>
    <button className="install-app" aria-label={busy ? "Opening installer…" : "Install app"} title="Install app" onClick={install} disabled={busy}><Smartphone size={18} /><span>{busy ? "Opening installer…" : "Install app"}<small>A home for your research</small></span><ArrowDownToLine size={15} /></button>
    <dialog ref={dialog} className="dialog install-dialog" aria-labelledby="install-title" onCancel={() => setOpen(false)} onClick={event => { if (event.target === dialog.current) setOpen(false); }}>
      <button className="icon-button close" aria-label="Close install guide" onClick={() => setOpen(false)}><X size={20} /></button>
      <img className="install-illustration" src="/alpha-nova-logo.jpg" width="64" height="64" alt="Alpha Nova" />
      <span className="eyebrow">YOUR POCKET RESEARCH DESK</span>
      <h2 id="install-title">Alpha Nova. One tap away.</h2>
      <p>Add Alpha Nova to your home screen for a dedicated, full-screen workspace.</p>
      <ol><li><strong>Open in Chrome on Android</strong><span>Visit alphanova48.in in your browser.</span></li><li><strong>Open the browser menu ⋮</strong><span>Choose “Add to Home screen” or “Install app”.</span></li><li><strong>Make it part of your routine</strong><span>Launch Alpha Nova from your home screen.</span></li></ol>
      <p className="install-note">On iPhone, use Safari → Share → Add to Home Screen. An internet connection is needed for market data. Your saved research stays in this browser.</p>
      <button className="button primary" onClick={() => setOpen(false)}>Got it</button>
    </dialog>
  </>;
}
