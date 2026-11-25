import { useEffect, useState } from "react";

// Installed-app detection, shared by the install links and the app's longer Pro trial.
const KEY = "an2-app-installed-v1";
const DISPLAY = "(display-mode: standalone)";

// True while running as the installed app, or in the tab that just installed it.
export const runningInstalled = () => typeof window !== "undefined" && (!!window.alphaNovaInstall?.installed ||
  !!window.matchMedia?.(DISPLAY).matches || window.navigator?.standalone === true);

// Also true in a browser tab that shares storage with an app seen earlier (Android, desktop).
export function hasApp() {
  if (typeof window === "undefined") return false;
  if (runningInstalled()) {
    try { window.localStorage.setItem(KEY, "1"); } catch { /* Detection still works this session. */ }
    return true;
  }
  try { return window.localStorage.getItem(KEY) === "1"; } catch { return false; }
}

function useInstallSignal(read) {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const mode = window.matchMedia(DISPLAY);
    const update = () => setValue(read());
    mode.addEventListener("change", update);
    window.addEventListener("appinstalled", update);
    update();
    return () => {
      mode.removeEventListener("change", update);
      window.removeEventListener("appinstalled", update);
    };
  }, [read]);
  return value;
}

export const useInstalled = () => useInstallSignal(runningInstalled);
export const useHasApp = () => useInstallSignal(hasApp);

// In-app browsers cannot install the app or finish Google sign-in; Chrome can.
export const inAppBrowser = () => typeof navigator !== "undefined" &&
  /; wv\)|\bFBAN\b|\bFBAV\b|FB_IAB|Instagram|LinkedInApp|\bLine\//i.test(navigator.userAgent || "");
export const isAndroid = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");
export function openInChromeUrl(path) {
  const target = new URL(path || window.location.href, window.location.href);
  return `intent://${target.host}${target.pathname}${target.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(target.href)};end`;
}
