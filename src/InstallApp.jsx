import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, Check, Gift } from "lucide-react";
import { growthEvent } from "./growth.js";
import { inAppBrowser, openInChromeUrl, useHasApp, useInstalled } from "./installState.js";
import { PRO_APP_TRIAL_DAYS, PRO_PAGES } from "../lib/proPlan.js";
import { proRequest } from "./pro.js";

const fallbackSteps = {
  ios: ["iPhone or iPad · Safari", "In Safari, tap Share, select “Add to Home Screen”, then tap Add. If you don’t see the option, scroll down in the Share menu."],
  android: ["Android · Chrome", "In Chrome, open the ⋮ menu and choose “Install app” or “Add to Home screen”, then confirm."],
  desktop: ["Desktop · Chrome or Edge", "Use the install icon in the address bar. You can also open the browser menu and look for “Install Alpha Nova” or an Apps submenu."],
};
function preferredPlatform() {
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/i.test(navigator.userAgent) ? "android" : "desktop";
}

export function InstallLink({ className, label, source, children }) {
  if (useInstalled()) return null;
  return <a className={className} href="/install" aria-label={source === "header" ? "Install Alpha Nova" : label} title={label}
    onClick={() => growthEvent("install_app_clicked", { destination: "/install", source, pathname: window.location.pathname })}>
    {children || <><ArrowDownToLine size={16} aria-hidden="true" /><span>{label}</span></>}
  </a>;
}

function InstallApp() {
  const installed = useInstalled();
  const hasApp = useHasApp();
  // Readers who have used the app trial, or already have Pro, are not offered it again.
  const [gift, setGift] = useState(true);
  useEffect(() => {
    if (!hasApp) return;
    let live = true;
    proRequest("status").then(status => {
      if (live) setGift(status.configured !== false && !status.active && !status.paused && (!status.signedIn || !!status.appTrialEligible));
    }).catch(() => { /* The Pro workspace decides when the check is unavailable. */ });
    return () => { live = false; };
  }, [hasApp]);
  const [canPrompt, setCanPrompt] = useState(() => !!window.alphaNovaInstall?.prompt);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [manual, setManual] = useState(false);
  const instructions = useRef(null);
  const platform = preferredPlatform();
  // Custom tabs and in-app browsers (the usual route from an ad) can’t install; Chrome can.
  const openInChrome = platform === "android" && !canPrompt && (manual || inAppBrowser());
  useEffect(() => {
    const update = () => setCanPrompt(!!window.alphaNovaInstall?.prompt);
    window.addEventListener("beforeinstallprompt", update);
    window.addEventListener("appinstalled", update);
    update();
    return () => {
      window.removeEventListener("beforeinstallprompt", update);
      window.removeEventListener("appinstalled", update);
    };
  }, []);
  useEffect(() => {
    if (manual) instructions.current?.querySelector("summary")?.focus();
  }, [manual]);

  async function install() {
    const state = window.alphaNovaInstall;
    const prompt = state?.prompt;
    if (!prompt) { setManual(true); return; }
    state.prompt = null;
    setCanPrompt(false);
    setBusy(true);
    setMessage("");
    growthEvent("install_prompt_opened", { destination: "/install" });
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      growthEvent("install_prompt_result", { outcome });
      if (outcome === "accepted") setMessage("Follow your browser’s instructions to finish installing.");
      else { setMessage("You can still install Alpha Nova from your browser menu."); setManual(true); }
    } catch {
      setMessage("The browser couldn’t open its installer. Try these steps instead.");
      setManual(true);
    } finally { setBusy(false); }
  }

  return <section className="install-dialog install-card" aria-labelledby="install-title">
    <img className="install-illustration" src="/icon-192.png" width="64" height="64" alt="" />
    <span className="eyebrow">YOUR RESEARCH WORKSPACE</span>
    <h1 id="install-title">Install Alpha Nova</h1>
    <p>Open your watchlist, charts and market research from your home screen or desktop.</p>
    {(installed || hasApp) && gift && <div className="install-gift" role="status">
      <Gift size={22} aria-hidden="true" />
      <strong>A thank-you for installing</strong>
      <p>{PRO_APP_TRIAL_DAYS} days of Alpha Nova Pro, free. All {PRO_PAGES.length} Pro workspaces, no payment details and no automatic charge.</p>
      {/* ?pro=1 opens the trial offer itself, not the workspace's free example. */}
      <a className="button primary install-action" href="/breakouts?pro=1" onClick={() => growthEvent("pro_cta_clicked", { source: "install", offer: "app_trial" })}>
        Start my {PRO_APP_TRIAL_DAYS} free days <ArrowRight size={16} />
      </a>
      <small>Sign in with Google to begin. Your {PRO_APP_TRIAL_DAYS} days start only when you choose.</small>
    </div>}
    {installed && !gift && <div className="app-installed" role="status"><Check size={15} /> App installed</div>}
    {!installed && <>
      <button className={`button install-action${hasApp && gift ? "" : " primary"}`} onClick={install} disabled={busy}>
        <ArrowDownToLine size={18} />{busy ? "Opening installer…" : canPrompt ? "Install Alpha Nova" : "Install on this device"}
      </button>
      {message && <p role="status">{message}</p>}
      {openInChrome && <a className="button install-action" href={openInChromeUrl("/install")} onClick={() => growthEvent("install_open_chrome", { destination: "/install" })}>
        Open in Chrome to install <ArrowRight size={16} />
      </a>}
      <details className="install-instructions" ref={instructions} open={manual ? true : undefined} onToggle={event => {
        if (!event.currentTarget.open) setManual(false);
      }}>
        <summary>Install instructions for your browser</summary>
        <ol>{[platform, ...Object.keys(fallbackSteps).filter(key => key !== platform)].map(key =>
          <li key={key}><strong>{fallbackSteps[key][0]}</strong><span>{fallbackSteps[key][1]}</span></li>
        )}</ol>
      </details>
    </>}
    <p className="install-note">An internet connection is needed for market data. Your existing research stays in its browser unless you back it up.</p>
    <a className="button" href="/">Back to Alpha Nova</a>
  </section>;
}

export function InstallPage() {
  useEffect(() => {
    document.title = "Install Alpha Nova | Stock Market Research App";
    document.querySelector('link[rel="canonical"]')?.setAttribute("href", "https://alphanova48.in/install");
  }, []);
  return <div className="app install-page"><main><InstallApp /></main></div>;
}
