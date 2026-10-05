import News from "./News.jsx";
import Navigation from "./Navigation.jsx";
import Onboarding from "./Onboarding.jsx";
import Watchlist from "./Watchlist.jsx";
import { growthEvent, recordVisit, recordActivation } from "./growth.js";
import "./onboarding.css";
import { PAGES, PAGE_LABELS, viewFromSearch, viewURL } from "./navigation.js";
import { exportCSV, sortRows } from "./ui";
import { buildBackup, parseBackup } from "./backup";
import { presetFromSearch } from "./screens";
import React, {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowLeft,
  ArrowDownUp,
  ArrowUpRight,
  Bell,
  BellRing,
  Check,
  ChevronRight,
  Command,
  Download,
  Globe2,
  HelpCircle,
  History,
  Info,
  Landmark,
  Layers,
  LayoutDashboard,
  Maximize2,
  Newspaper,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Send,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  BellOff,
  Target,
  Star,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { TradePlanner, TradeJournal, KeyLevels } from "./TradeDesk";
import { completedDailyBars, dailyLevels } from "./tradeMath";
const Forecast = lazy(() => import("./Forecast"));
const SwingDesk = lazy(() => import("./SwingDesk"));
const DeliveryRadar = lazy(() => import("./DeliveryRadar"));
const Pulse = lazy(() => import("./Pulse"));
const Screener = lazy(() => import("./Screener"));
const FnO = lazy(() => import("./FnO"));
const Flows = lazy(() => import("./Flows"));
const Rotation = lazy(() => import("./Rotation"));
import FairValue from "./FairValue";
import { Heatmap, ResearchCharts } from "./VisualData";
import {
  enablePush,
  disablePush,
  syncPush,
  pushAction,
  showLocal,
  registerSW,
  pushSupported,
  isIOS,
  isStandalone,
} from "./push";
const Chart = lazy(() => import("./Chart"));
import { useFeed, useQuotes, useSaved } from "./hooks";
import {
  benchmarks,
  directory,
  exchangeName,
  fmt,
  pct,
  compact,
  groups,
  search,
  short,
} from "./data";
import { signalSnapshot, marketRegime, nseSession } from "./marketMath";
const ranges = {
  "1D": "1d",
  "5D": "5d",
  "1M": "1mo",
  "3M": "3mo",
  "6M": "6mo",
  "1Y": "1y",
  "2Y": "2y",
  "5Y": "5y",
};
const tone = (n) =>
  Number.isFinite(n) ? (n >= 0 ? "positive" : "negative") : "muted";
function Spark({ values = [], change }) {
  const v = (values || []).filter(Number.isFinite);
  if (v.length < 2) return <span className="muted">—</span>;
  const min = Math.min(...v),
    max = Math.max(...v);
  return (
    <svg
      className={`spark ${tone(change)}`}
      viewBox="0 0 100 30"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        points={v
          .map(
            (x, i) =>
              `${(i / (v.length - 1)) * 100},${27 - ((x - min) / (max - min || 1)) * 24}`,
          )
          .join(" ")}
      />
    </svg>
  );
}
function PanelTitle({ title, tag, children }) {
  return (
    <div className="panel-title">
      <div>
        <span className="panel-tag">{tag}</span>
        <h2>{title}</h2>
      </div>
      <div>{children}</div>
    </div>
  );
}
function Empty({ title, description, children }) {
  return (
    <div className="empty">
      <Activity size={28} />
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
function uid() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID)
      return crypto.randomUUID();
  } catch {}
  return (
    "id-" +
    Date.now().toString(36) +
    "-" +
    Math.floor(Math.random() * 1e9).toString(36)
  );
}
function downloadFile(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 800);
}

function sessionStatus(q) {
  if (!q || !Number.isFinite(q.price)) return "Awaiting feed";
  if (q.marketTime == null) return "Quote time unavailable · freshness unknown";
  const age = (Date.now() / 1000 - q.marketTime) / 60;
  const stamp = new Date(q.marketTime * 1000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const delay = q.delay != null ? ` · delayed ${q.delay} min` : "";
  if (age < 20) return `Recent quote · ${stamp}${delay} · may be delayed`;
  if (age < 90) return `Recent quote · ${stamp}${delay} · market may be closed`;
  return `Last session · ${stamp}${delay} · market closed or stale`;
}
function signalExplain(verdict, score, rules) {
  const bull = rules.filter((r) => r.bias > 0).length,
    bear = rules.filter((r) => r.bias < 0).length;
  return `${verdict} bias: ${bull} bullish and ${bear} bearish rules, net ${score}. Correlated trend measurements, not independent confirmations or a probability of profit.`;
}
function MarketStatus() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const st = nseSession(now);
  return (
    <span
      className={`session ${st.state}`}
      title="From the IST clock · exchange holidays not tracked"
    >
      <i /> {st.label}
    </span>
  );
}
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return (
    <span>
      {now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" })} IST
    </span>
  );
}
class ChartErrorBoundary extends React.Component {
  constructor(p) {
    super(p);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="empty">
          <Activity size={28} />
          <h3>Chart failed to render</h3>
          <p>Try another range or reload.</p>
        </div>
      );
    return this.props.children;
  }
}
export default function App() {
  const [existingVisitor] = useState(() => {
    try { return localStorage.getItem("an2-watch") !== null; } catch { return false; }
  });
  const [onboarding, setOnboarding] = useSaved("an2-onboarding-v1", {
    status: existingVisitor ? "hidden" : "welcome",
  });
  const [page, applyPage] = useState(() => {
      try {
        const pg = new URLSearchParams(location.search).get("page");
        return PAGES.includes(pg) ? pg : "Today";
      } catch {
        return "Today";
      }
    }),
    [symbol, setSymbol] = useSaved("an2-symbol", "RELIANCE.NS"),
    [watch, setWatch] = useSaved("an2-watch", []);
  useEffect(() => {
    recordVisit(existingVisitor);
    const revisit = () => { if (document.visibilityState === "visible") recordVisit(existingVisitor); };
    const pulse = setInterval(revisit, 60000);
    document.addEventListener("visibilitychange", revisit);
    return () => { clearInterval(pulse); document.removeEventListener("visibilitychange", revisit); };
  }, [existingVisitor]);
  const watchedStocks = watch.filter((s) => {
    const instrument = directory.get(s);
    return instrument && ["India", "US"].includes(instrument.market) && instrument.sector !== "Index";
  });
  useEffect(() => { recordActivation(watchedStocks); }, [watch]);
  useEffect(() => { if (page === "Watchlist") growthEvent("watchlist_viewed", { stock_count: watch.length }); }, [page]);
  const [journal, setJournal] = useSaved("an2-journal", []);
  const [drafts, setDrafts] = useSaved("an2-trade-drafts", {});
  const draft = drafts[symbol] || {
    side: "long",
    capital: "",
    riskPct: "0.5",
    entry: "",
    stop: "",
    target: "",
    costs: "0",
    notes: "",
  };
  const setDraft = (d) => setDrafts((prev) => ({ ...prev, [symbol]: d }));
  const [positions, setPositions] = useSaved("an2-positions", []),
    [alerts, setAlerts] = useSaved("an2-alerts", []),
    [range, setRange] = useSaved("an2-range", "6mo"),
    [type, setType] = useSaved("an2-chart-type", "Candles"),
    [indicators, setIndicators] = useSaved("an2-indicators", [
      "Volume",
      "EMA 20",
    ]);
  const [group, setGroup] = useState("India"),
    [refresh, setRefresh] = useState(0),
    [query, setQuery] = useState(""),
    [showSearch, setShowSearch] = useState(false),
    [help, setHelp] = useState(false),
    [toast, setToast] = useState(""),
    [sort, setSort] = useState("symbol"),
    [direction, setDirection] = useState(1),
    [filter, setFilter] = useState(""),
    [focus, setFocus] = useState(false),
    [reset, setReset] = useState(0),
    [form, setForm] = useState(null),
    [backupMsg, setBackupMsg] = useState(""),
    [backupErr, setBackupErr] = useState("");
  const [alertPrefs, setAlertPrefs] = useSaved("an2-alert-prefs", {
      browser: false,
    }),
    [deliveryHistory, setDeliveryHistory] = useSaved(
      "an2-delivery-history",
      [],
    );
  const [savedScreens, setSavedScreens] = useSaved("an2-screens", []),
    [pushBusy, setPushBusy] = useState(false);
  const [recent, setRecent] = useSaved("an2-recent", []),
    [activeIdx, setActiveIdx] = useState(0),
    [copied, setCopied] = useState(false);
  // Record deliberate navigation only, so hydration and background updates never add stops.
  const [backStack, setBackStack] = useState(() => window.history.state?.anBackStack || []);
  const [screenerView, setScreenerView] = useState(() => ({
    active:
      presetFromSearch(
        typeof location === "undefined" ? "" : location.search,
      ) || "momentum",
  }));
  const currentView = () => ({
    page,
    symbol,
    range,
    group,
    filter,
    sort,
    direction,
    screenerView,
  });
  const navigate = (next) => {
    const target = { ...currentView(), ...next };
    if (target.page === page && target.symbol === symbol) return;
    const stack = [...backStack, currentView()].slice(-50);
    window.history.replaceState(
      {
        ...window.history.state,
        anView: currentView(),
        anBackStack: backStack,
      },
      "",
    );
    window.history.pushState(
      { anView: target, anBackStack: stack },
      "",
      viewURL(location.href, { ...target, screen: target.screenerView.active }),
    );
    setBackStack(stack);
    applyPage(target.page);
    setSymbol(target.symbol);
    setFocus(false);
    setShowSearch(false);
    setHelp(false);
    setForm(null);
    setSearchTarget(null);
    window.scrollTo?.({ top: 0, behavior: "instant" });
  };
  const setPage = (next) => navigate({ page: next });
  const openGuide = () => {
    setOnboarding({ status: watchedStocks.length >= 3 ? "return" : "choose" });
    growthEvent("onboarding_reopened");
    window.scrollTo?.({ top: 0, behavior: "instant" });
  };
  const openWatchAlert = (s) => {
    navigate({ page: "Alerts", symbol: s });
    setForm("alert");
  };
  const previousView = backStack.at(-1);
  const previousLabel = previousView
    ? `${PAGE_LABELS[previousView.page]}${["Terminal", "Forecast", "News"].includes(previousView.page) ? ` · ${short(previousView.symbol)}` : ""}`
    : "";
  const goBack = () => {
    if (previousView) window.history.back();
  };
  useEffect(() => {
    const restore = (event) => {
      const urlView = viewFromSearch(location.search);
      const view = { ...event.state?.anView, ...urlView };
      applyPage(view.page);
      setSymbol(view.symbol);
      setRange(view.range);
      setGroup(view.group || "India");
      setFilter(view.filter || "");
      setSort(view.sort || "symbol");
      setDirection(view.direction || 1);
      setScreenerView(
        view.screenerView || {
          active: presetFromSearch(location.search) || "momentum",
        },
      );
      setBackStack(event.state?.anBackStack || []);
      setFocus(false);
      setShowSearch(false);
      setHelp(false);
      setForm(null);
      setSearchTarget(null);
      window.scrollTo?.({ top: 0, behavior: "instant" });
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const pageRef = useRef(page);
  pageRef.current = page;
  const fileRef = useRef(),
    watchPanelRef = useRef(),
    initialQuery = useRef(
      typeof location !== "undefined" ? location.search : "",
    );
  const [searchTarget, setSearchTarget] = useState(null),
    [undo, setUndo] = useState(null);
  const openSearch = (target = null) => {
    setSearchTarget(target);
    setQuery("");
    setShowSearch(true);
  };

  const searchRef = useRef(),
    dialogRef = useRef();
  const meta = directory.get(symbol) || { symbol, name: symbol };
  const groupSymbols = group === "Watchlist" ? watch : groups[group] || [];
  const symbols = useMemo(
    () => [
      ...new Set(
        [
          ...(page === "Terminal" || form ? [symbol] : []),
          ...(page === "Portfolio" ? positions.map((x) => x.symbol) : []),
          ...alerts.filter((x) => !x.triggered).map((x) => x.symbol),
          ...(["Today", "Terminal", "Watchlist"].includes(page) ? watch : []),
          ...(page === "Markets" ? groupSymbols : []),
        ].filter((s) => s && !benchmarks.includes(s)),
      ),
    ],
    [watch, symbol, page, groupSymbols, positions, alerts, form],
  );
  const benchmarkFeed = useQuotes(benchmarks, refresh);
  const instrumentFeed = useQuotes(symbols, refresh);
  const quotes = useMemo(
    () => ({ ...benchmarkFeed.quotes, ...instrumentFeed.quotes }),
    [benchmarkFeed.quotes, instrumentFeed.quotes],
  );
  const quotesLoading = benchmarkFeed.loading || instrumentFeed.loading,
    quotesError = benchmarkFeed.error || instrumentFeed.error;
  const terminal = page === "Terminal";
  const history = useFeed(
    terminal
      ? "/api/market?op=chart&symbol=" +
          encodeURIComponent(symbol) +
          "&range=" +
          range
      : null,
    refresh,
  );
  const quote = quotes[symbol] || history.data;
  const bars = history.data?.bars || [];

  const isNS = /\.NS$/.test(symbol) && meta.sector !== "Index";
  const delFeed = useFeed(
    terminal && isNS
      ? "/api/market?op=delivery&symbol=" +
          encodeURIComponent(symbol.slice(0, -3))
      : null,
    refresh,
  );
  const del = delFeed.data?.stats;
  const fundFeed = useFeed(
    terminal
      ? "/api/market?op=fundamentals&symbol=" + encodeURIComponent(symbol)
      : null,
    refresh,
  );
  const fund = fundFeed.data;
  const daily = useFeed(
    terminal
      ? "/api/market?op=chart&symbol=" +
          encodeURIComponent(symbol) +
          "&range=1y"
      : null,
    refresh,
  );
  const dailyBars = useMemo(
    () =>
      completedDailyBars(
        daily.data?.bars,
        daily.data?.timezone || "Asia/Kolkata",
      ),
    [daily.data],
  );
  const signal = useMemo(() => signalSnapshot(dailyBars), [dailyBars]);
  const regime = useMemo(() => marketRegime(dailyBars), [dailyBars]);
  const levels = useMemo(() => dailyLevels(dailyBars), [dailyBars]);
  const results = search(query);
  const choose = (s) => {
    if (searchTarget === "position" || searchTarget === "alert") {
      setSymbol(s);
      setForm(searchTarget);
    } else
      navigate({
        page:
          searchTarget === "news"
            ? "News"
            : searchTarget === "forecast" || page === "Forecast"
              ? "Forecast"
              : "Terminal",
        symbol: s,
      });
    setFocus(false);
    setFilter("");
    setSearchTarget(null);
    setShowSearch(false);
    setQuery("");
    setActiveIdx(0);
    try {
      setRecent((r) =>
        [s, ...(Array.isArray(r) ? r.filter((x) => x !== s) : [])].slice(0, 8),
      );
    } catch {}
  };
  const notify = (s, action = null) => {
    setToast(s);
    setUndo(action ? () => action : null);
  };
  const copyLink = async () => {
    try {
      const u = new URL(viewURL(location.href, { ...currentView(), screen: screenerView.active }), location.origin);
      const link = u.toString();
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const t = document.createElement("textarea");
        t.value = link;
        document.body.appendChild(t);
        t.select();
        document.execCommand("copy");
        t.remove();
      }
      setCopied(true);
      growthEvent("view_link_copied", { page });
      notify("Link copied — share this view");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify("Could not copy link");
    }
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), undo ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [toast, undo]);
  useEffect(() => {
    try {
      const q = new URLSearchParams(initialQuery.current);
      const s = q.get("symbol"),
        pg = q.get("page"),
        rg = q.get("range");
      if (s) setSymbol(viewFromSearch(initialQuery.current, { symbol }).symbol);
      if (pg && PAGES.includes(pg)) applyPage(pg);
      if (rg && Object.values(ranges).includes(rg)) setRange(rg);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      const u = new URL(location.href);
      if (u.searchParams.get("symbol") !== symbol)
        u.searchParams.set("symbol", symbol);
      if (u.searchParams.get("page") !== page) u.searchParams.set("page", page);
      if (u.searchParams.get("range") !== range)
        u.searchParams.set("range", range);
      if (
        page === "Screener" &&
        screenerView.active &&
        screenerView.active !== "custom"
      )
        u.searchParams.set("screen", screenerView.active);
      else u.searchParams.delete("screen");
      const next = u.pathname + u.search;
      if (location.pathname + location.search !== next)
        window.history.replaceState(window.history.state, "", next);
    } catch {}
  }, [symbol, page, range, screenerView.active]);
  useEffect(() => {
    document.title =
      page === "Today" || page === "Terminal"
        ? "Alpha Nova (AlphaNova) | Indian Stock Screener"
        : `${page === "Screener" ? "Nifty 500 Stock Screener" : page === "Delivery" ? "NSE Delivery Radar" : page === "FnO" ? "NSE Option Chain & Futures OI" : page === "Flows" ? "FII DII Flows & Bulk Deals" : page} | Alpha Nova Terminal`;
  }, [page]);
  useEffect(() => {
    setActiveIdx(0);
  }, [query, showSearch]);
  useEffect(() => {
    const r = setInterval(() => {
      if (!document.hidden) setRefresh((x) => x + 1);
    }, 300000);
    return () => clearInterval(r);
  }, []);
  useEffect(() => {
    const fn = (e) => {
      const typing =
        ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) ||
        e.target.isContentEditable;
      const modal = !!document.querySelector("dialog[open]");
      if (
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") ||
        (e.key === "/" && !typing)
      ) {
        e.preventDefault();
        setSearchTarget(null);
        setShowSearch(true);
      }
      if (e.key === "Escape") {
        setShowSearch(false);
        setHelp(false);
        setForm(null);
        setFocus(false);
      }
      if (!typing && !modal && e.key === "?") setHelp(true);
      const r = Object.values(ranges)[Number(e.key) - 1];
      if (
        !typing &&
        !modal &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        r &&
        pageRef.current === "Terminal"
      )
        setRange(r);
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  useEffect(() => {
    if (showSearch)
      document
        .getElementById(`search-result-${activeIdx}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, showSearch]);
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (showSearch || help || form) {
      if (!d.open) d.showModal();
      if (showSearch) searchRef.current?.focus();
    } else if (d.open) d.close();
  }, [showSearch, help, form]);
  useEffect(() => {
    if (!alerts.length || !Object.keys(quotes || {}).length) return;
    const now = new Date().toISOString();
    let changed = false;
    const fresh = [];
    const seen = new Set(
      (deliveryHistory || [])
        .filter((h) => Date.now() - Date.parse(h.at || 0) < 86400000)
        .map((h) => h.dedup),
    );
    const next = alerts.map((a) => {
      const q = quotes[a.symbol];
      if (a.triggered || !Number.isFinite(q?.price)) return a;
      if (!(q.marketTime == null || q.marketTime >= a.created / 1000)) return a;
      const hit =
        (a.condition === "above" && q.price >= a.price) ||
        (a.condition === "below" && q.price <= a.price);
      if (!hit) return a;
      changed = true;
      const dedup = `${a.symbol}|${a.condition}|${a.price}`;
      const dup = seen.has(dedup);
      seen.add(dedup);
      const entry = {
        id: uid(),
        alertId: a.id,
        dedup,
        symbol: a.symbol,
        condition: a.condition,
        target: a.price,
        observed: q.price,
        at: now,
        channel: dup
          ? "deduped"
          : (alertPrefs?.browser || alertPrefs?.push) &&
              typeof Notification !== "undefined" &&
              Notification.permission === "granted"
            ? "notification"
            : "in-app",
      };
      if (!dup) fresh.push(entry);
      else fresh.push(entry);
      return {
        ...a,
        triggered: true,
        triggeredAt: now,
        deduped: dup || undefined,
      };
    });
    if (changed) {
      setAlerts(next);
      const deliverable = fresh.filter((f) => f.channel !== "deduped");
      setDeliveryHistory(
        [
          ...deliverable,
          ...fresh.filter((f) => f.channel === "deduped"),
          ...(deliveryHistory || []),
        ].slice(0, 100),
      );
      for (const f of deliverable) {
        if (f.channel === "notification")
          showLocal(`${short(f.symbol)} ${f.condition} ${fmt(f.target)}`, {
            body: `Last ${fmt(f.observed)} · ${new Date(f.at).toLocaleString("en-GB")} · Alpha Nova`,
            tag: `${f.symbol}|${f.condition}|${f.target}`,
            data: {
              url: `/?page=Alerts&symbol=${encodeURIComponent(f.symbol)}`,
            },
          });
        notify(
          deliverable.length
            ? `Alert: ${short(deliverable[0].symbol)} ${deliverable[0].condition} ${fmt(deliverable[0].target)} (last ${fmt(deliverable[0].observed)}).`
            : "Alert updated (duplicate suppressed). Open Alerts to review.",
        );
      }
    }
  }, [quotes, alerts, alertPrefs, deliveryHistory]);
  const toggleWatch = (s) => {
    if (watch.includes(s)) {
      setWatch(watch.filter((x) => x !== s));
      growthEvent("watchlist_stock_removed", { stock_count: watch.length - 1 });
      notify(`${short(s)} removed from watchlist`, () =>
        setWatch((current) =>
          current.includes(s) || current.length >= 40
            ? current
            : [...current, s],
        ),
      );
    } else if (watch.length >= 40)
      notify("Watchlists support up to 40 symbols.");
    else {
      setWatch([...watch, s]);
      growthEvent("watchlist_stock_saved", { stock_count: watch.length + 1 });
      notify("Added to watchlist");
    }
  };
  const watchSummary = useMemo(() => {
    const qs = (watch || []).map((sym) => ({ symbol: sym, q: quotes[sym] }));
    const known = qs.filter((x) => Number.isFinite(x.q?.change));
    const up = known.filter((x) => x.q.change > 0).length,
      down = known.filter((x) => x.q.change < 0).length,
      flat = known.length - up - down;
    const avg = known.length
      ? known.reduce((t, x) => t + x.q.change, 0) / known.length
      : null;
    const sorted = [...known].sort(
      (a, b) => Math.abs(b.q.change) - Math.abs(a.q.change),
    );
    const top = sorted[0] || null;
    return {
      total: (watch || []).length,
      known: known.length,
      up,
      down,
      flat,
      avg,
      top,
    };
  }, [watch, quotes]);
  const jumpToWatch = () => {
    setFocus(false);
    setPage("Watchlist");
  };
  const enableBrowserAlerts = async () => {
    try {
      if (typeof Notification === "undefined") {
        notify("This browser does not support notifications.");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        setAlertPrefs({ ...alertPrefs, browser: true });
        growthEvent("alert_notifications_enabled", { channel: "browser" });
        showLocal("Alpha Nova alerts on", {
          body: "In-tab notifications enabled. For alerts with the app closed, turn on push above.",
        });
        notify("Browser notifications on. Alerts need this browser open.");
      } else {
        setAlertPrefs({ ...alertPrefs, browser: false });
        notify(
          "Notifications blocked. Alerts still work in-app while the tab is open.",
        );
      }
    } catch {
      notify("Could not enable notifications.");
    }
  };
  const testBrowserAlert = () => {
    try {
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        showLocal("Alpha Nova test alert", {
          body: "In-tab delivery works on this device.",
        });
        notify("Test notification sent.");
      } else notify("Enable browser notifications first.");
    } catch {
      notify("Notifications unavailable here.");
    }
  };
  const pushPayload = useMemo(
    () => ({
      alerts,
      watch,
      prefs: {
        alerts: alertPrefs?.pushAlerts !== false,
        delivery: !!alertPrefs?.delivery,
        screens: alertPrefs?.screens !== false,
      },
      screens: savedScreens,
    }),
    [alerts, watch, alertPrefs, savedScreens],
  );
  const payloadKey = JSON.stringify(pushPayload);
  const applyServer = (resp) => {
    if (!resp) return;
    if (Array.isArray(resp.alerts)) {
      const m = new Map(resp.alerts.map((a) => [a.id, a]));
      setAlerts((cur) => {
        let ch = false;
        const next = cur.map((a) => {
          const s = m.get(a.id);
          if (s && s.triggered && !a.triggered && s.created === a.created) {
            ch = true;
            return {
              ...a,
              triggered: true,
              triggeredAt: s.triggeredAt,
              via: "push",
            };
          }
          return a;
        });
        return ch ? next : cur;
      });
    }
    if (Array.isArray(resp.log)) {
      setDeliveryHistory((cur) => {
        const list = Array.isArray(cur) ? cur : [];
        const have = new Set(list.map((h) => h.id));
        const add = resp.log
          .filter((l) => l && !have.has("push-" + l.id))
          .map((l) => ({
            id: "push-" + l.id,
            at: l.at,
            symbol: l.symbol || "",
            condition: l.condition || "",
            target: l.target,
            observed: l.observed,
            channel: "push",
            kind: l.kind || "alert",
            title: l.title,
            body: l.body,
          }));
        return add.length
          ? [...add, ...list]
              .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
              .slice(0, 100)
          : cur;
      });
    }
  };
  useEffect(() => {
    registerSW();
  }, []);
  useEffect(() => {
    if (!alertPrefs?.push) return;
    const t = setTimeout(() => {
      syncPush(pushPayload)
        .then(applyServer)
        .catch((e) => {
          if (e.status === 404) {
            setAlertPrefs((p) => ({ ...p, push: false }));
            notify(
              "Push is no longer active on this device. Turn it on again in Alerts.",
            );
          }
        });
    }, 1500);
    return () => clearTimeout(t);
  }, [payloadKey, alertPrefs?.push, page === "Alerts"]);
  const turnOnPush = async () => {
    setPushBusy(true);
    try {
      const prefs = {
        ...pushPayload.prefs,
        delivery: alertPrefs?.delivery ?? true,
      };
      const r = await enablePush({ ...pushPayload, prefs });
      setAlertPrefs((p) => ({
        ...p,
        push: true,
        delivery: p?.delivery ?? true,
      }));
      applyServer(r);
      notify("Push is on — a confirmation notification is on its way.");
      growthEvent("alert_notifications_enabled", { channel: "push" });
    } catch (e) {
      notify(e.message || "Could not enable push.");
    } finally {
      setPushBusy(false);
    }
  };
  const turnOffPush = async () => {
    setPushBusy(true);
    try {
      await disablePush();
    } finally {
      setAlertPrefs((p) => ({ ...p, push: false }));
      setPushBusy(false);
      notify("Push turned off for this device.");
    }
  };
  const pushOp = async (op) => {
    setPushBusy(true);
    try {
      if (op === "check") await syncPush(pushPayload);
      const r = await pushAction(op);
      applyServer(r);
      notify(
        op === "check"
          ? `Server checked ${r.checked} symbol${r.checked === 1 ? "" : "s"} · ${r.fired} alert${r.fired === 1 ? "" : "s"} fired`
          : "Test push sent — it should arrive in a few seconds.",
      );
    } catch (e) {
      notify(e.message || "Push request failed.");
      if (e.status === 410 || e.status === 404)
        setAlertPrefs((p) => ({ ...p, push: false }));
    } finally {
      setPushBusy(false);
    }
  };
  const setPushPref = (k, v) => setAlertPrefs((p) => ({ ...p, [k]: v }));
  const openSymbol = (s) => {
    navigate({ page: "Terminal", symbol: s });
    try {
      setRecent((r) =>
        [s, ...(Array.isArray(r) ? r.filter((x) => x !== s) : [])].slice(0, 8),
      );
    } catch {}
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  };
  const doExportBackup = () => {
    try {
      const payload = buildBackup({
        symbol,
        watch,
        positions,
        alerts,
        deliveryHistory,
        alertPrefs,
        savedScreens,
        journal,
      });
      downloadFile(
        JSON.stringify(payload, null, 2),
        `alphanova-backup-${new Date().toISOString().slice(0, 10)}.json`,
        "application/json",
      );
      setBackupMsg(
        `Backup exported · ${(watch || []).length} watchlisted · ${positions.length} holdings · ${alerts.length} alerts.`,
      );
      setBackupErr("");
    } catch {
      setBackupErr("Export failed in this browser.");
    }
  };
  const doImportBackup = (file) => {
    setBackupMsg("");
    setBackupErr("");
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const parsed = parseBackup(rd.result);
        if (parsed.symbol) setSymbol(parsed.symbol);
        setWatch(parsed.watch);
        setPositions(parsed.positions);
        setAlerts(
          parsed.alerts.map((a) => ({
            ...a,
            id: a.id || uid(),
            created: a.created || Date.now(),
            triggered: !!a.triggered,
          })),
        );
        setDeliveryHistory(parsed.deliveryHistory || []);
        if (parsed.alertPrefs)
          setAlertPrefs((p) => ({
            ...p,
            ...parsed.alertPrefs,
            browser: false,
            push: p?.push || false,
          }));
        setSavedScreens(parsed.savedScreens);
        if (parsed.journal !== null) setJournal(parsed.journal);
        setBackupMsg(
          `Restored ${parsed.watch.length} watchlisted · ${parsed.positions.length} holdings · ${parsed.alerts.length} alerts. Browser notifications stay off until you opt in again.`,
        );
      } catch (e) {
        setBackupErr(e.message || "Could not read this backup file.");
      }
    };
    rd.onerror = () => setBackupErr("Could not read this backup file.");
    rd.readAsText(file);
  };
  const tableSymbols = page === "Markets" ? groupSymbols : watch;
  let rows = (tableSymbols || [])
    .map((s) => ({ ...directory.get(s), symbol: s, ...quotes[s] }))
    .filter(
      (x) =>
        (x.name || x.symbol).toLowerCase().includes(filter.toLowerCase()) ||
        x.symbol.toLowerCase().includes(filter.toLowerCase()),
    );
  rows = sortRows(rows, [sort, direction]);
  const changeSort = (s) => {
    setSort(s);
    setDirection(s === sort ? -direction : s === "symbol" ? 1 : -1);
  };
  const dataStamp = (q) =>
    q?.marketTime
      ? new Date(q.marketTime * 1000).toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Awaiting feed";
  const marketTable = (compactView = false) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th
              aria-sort={
                sort === "symbol"
                  ? direction === 1
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <button onClick={() => changeSort("symbol")}>
                Instrument <ArrowDownUp size={11} />
              </button>
            </th>
            <th
              aria-sort={
                sort === "price"
                  ? direction === 1
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <button onClick={() => changeSort("price")}>
                Last <ArrowDownUp size={11} />
              </button>
            </th>
            <th
              aria-sort={
                sort === "change"
                  ? direction === 1
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <button onClick={() => changeSort("change")}>
                Change % <ArrowDownUp size={11} />
              </button>
            </th>
            {!compactView && (
              <>
                <th>5-day trend</th>
                <th>Volume</th>
                <th>As of</th>
              </>
            )}
            <th>
              <Star size={13} />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr
              key={x.symbol}
              className={symbol === x.symbol ? "selected" : ""}
            >
              <td>
                <button className="instrument" onClick={() => choose(x.symbol)}>
                  <strong>{short(x.symbol)}</strong>
                  <span>{directory.get(x.symbol)?.name || x.name}</span>
                </button>
              </td>
              <td className="number">
                {fmt(x.price)}
                {<small>{x.currency || "—"}</small>}
              </td>
              <td className={`number ${tone(x.change)}`}>{pct(x.change)}</td>
              {!compactView && (
                <>
                  <td>
                    <Spark values={x.spark} change={x.change} />
                  </td>
                  <td className="number">{compact(x.volume)}</td>
                  <td className="muted small">{dataStamp(x)}</td>
                </>
              )}
              <td>
                <button
                  className={`icon-button ${watch.includes(x.symbol) ? "starred" : ""}`}
                  aria-label={`${watch.includes(x.symbol) ? "Remove" : "Add"} ${short(x.symbol)} ${watch.includes(x.symbol) ? "from" : "to"} watchlist`}
                  onClick={() => toggleWatch(x.symbol)}
                >
                  <Star
                    size={14}
                    fill={watch.includes(x.symbol) ? "currentColor" : "none"}
                  />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <Empty
          title="No matching instruments"
          description="Try another search or reset your filters."
        >
          <button className="button" onClick={() => setFilter("")}>
            Reset filters
          </button>
        </Empty>
      )}
    </div>
  );
  function submitForm(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (form === "position") {
      const qty = Number(f.get("quantity")),
        cost = Number(f.get("cost"));
      if (!(qty > 0)) {
        notify("Enter a quantity above zero");
        return;
      }
      if (!(cost > 0)) {
        notify("Enter an average cost above zero");
        return;
      }
      if (!quote?.currency) {
        notify("Price feed is still loading — try again in a moment");
        return;
      }
      setPositions([
        ...positions,
        { id: uid(), symbol, quantity: qty, cost, currency: quote.currency },
      ]);
      notify("Position saved on this device — export a backup to keep it safe");
    } else {
      const price = Number(f.get("price"));
      if (!(price > 0)) {
        notify("Enter a target price above zero");
        return;
      }
      const condition = f.get("condition");
      const dup = alerts.some(
        (a) =>
          !a.triggered &&
          a.symbol === symbol &&
          a.condition === condition &&
          Number(a.price) === price,
      );
      if (dup) {
        notify("This alert already exists and is still watching.");
        setForm(null);
        return;
      }
      setAlerts([
        ...alerts,
        {
          id: uid(),
          symbol,
          price,
          condition,
          created: Date.now(),
          triggered: false,
        },
      ]);
      growthEvent("price_alert_created", { watchlisted: watch.includes(symbol), push_enabled: !!alertPrefs?.push });
      notify(
        alertPrefs?.push
          ? "Price alert created · push armed"
          : alertPrefs?.browser
            ? "Price alert created · in-tab notification armed"
            : "Price alert created · turn on push in Alerts for closed-app delivery",
      );
    }
    setForm(null);
  }
  return (
    <div className={`app ${focus ? "chart-focus" : ""}`}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            setPage("Today");
          }}
        >
          <span className="brand-mark">A</span>
          <span>
            ALPHA <span className="brand-light">NOVA</span>
            <small>TERMINAL</small>
          </span>
        </a>
        <button
          className="global-search"
          aria-label="Search instruments and commands"
          onClick={() => openSearch()}
        >
          <Search size={16} />
          <span>Search symbol or company</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="top-right">
          <MarketStatus />
          <button
            className="icon-button"
            aria-label="Help and shortcuts"
            onClick={() => setHelp(true)}
          >
            <HelpCircle size={18} />
          </button>
        </div>
      </header>
      <Navigation
        page={page}
        onPage={(name) => {
          setPage(name);
          setFilter("");
        }}
        triggered={alerts.some((a) => a.triggered)}
        loading={quotesLoading}
        onRefresh={() => {
          setRefresh((x) => x + 1);
          notify("Refreshing market data…");
        }}
      />
      <div className="benchmark-strip">
        {benchmarks.map((s) => (
          <button onClick={() => choose(s)} key={s}>
            <span>{directory.get(s)?.name}</span>
            <strong>{fmt(quotes[s]?.price)}</strong>
            <em className={tone(quotes[s]?.change)}>
              {pct(quotes[s]?.change)}
            </em>
            <Spark values={quotes[s]?.spark} change={quotes[s]?.change} />
          </button>
        ))}
      </div>
      <main id="main-content" tabIndex={-1}>
        <Onboarding state={onboarding} onState={setOnboarding} watch={watchedStocks}
          onToggle={toggleWatch} onNavigate={navigate} onAlert={openWatchAlert}
          alerts={alerts} pushOn={!!alertPrefs?.push} />
        {previousView && (
          <div className="history-navigation">
            <button
              type="button"
              className="button"
              onClick={goBack}
              disabled={!previousView}
              aria-label={
                previousView
                  ? `Back to ${previousLabel}`
                  : "Back — no previous view"
              }
              title={
                previousView ? `Back to ${previousLabel}` : "No previous view"
              }
            >
              <ArrowLeft size={16} />
              <span>Back</span>
            </button>
            {previousView && <span className="muted">to {previousLabel}</span>}
          </div>
        )}
        <Suspense fallback={<div className="loading">Loading workspace…</div>}>
          <div className="workspace-heading">
            <div>
              <h1>
                {page === "Today"
                  ? "Overview"
                  : page === "Terminal"
                    ? "Research & plan"
                    : page === "Markets"
                      ? "Markets"
                      : page === "Forecast"
                        ? "Price forecast"
                        : page === "Screener"
                          ? "Market screener"
                          : page === "Delivery"
                            ? "Delivery radar"
                            : page === "FnO"
                              ? "Futures & options"
                              : page === "Flows"
                                ? "Institutional flows"
                                : page === "News"
                                  ? "The newswire"
                                  : page === "Portfolio"
                                    ? "Portfolio"
                                    : page === "Journal"
                                      ? "Journal"
                                      : page === "Watchlist" ? "Watchlist" : "Price alerts"}
              </h1>
            </div>
            <div className="heading-actions">
              <span className="feed-status">
                <i
                  className={
                    quotesLoading ? "pending" : quotesError ? "warning" : ""
                  }
                />
                {quotesLoading
                  ? "Updating prices"
                  : quotesError
                    ? "Partial data"
                    : "Quotes may be delayed · 30 sec refresh"}
              </span>
              <button
                className="button primary"
                onClick={() =>
                  openSearch(
                    page === "News"
                      ? "news"
                      : page === "Forecast"
                        ? "forecast"
                        : null,
                  )
                }
              >
                <Search size={15} /> Find instrument
              </button>
            </div>
          </div>
          {quotesError && (
            <div className="notice" role="status">
              {quotesError}
            </div>
          )}
          {page === "Today" && (
            <SwingDesk
              refresh={refresh}
              onRefresh={() => setRefresh((x) => x + 1)}
              onOpen={openSymbol}
              onPage={setPage}
              watch={watch}
              toggleWatch={toggleWatch}
              journal={journal}
              quotes={quotes}
            />
          )}
          {page === "Terminal" && (
            <div className="research-next">
              <span>
                <Target size={16} />
                <strong>Plan your risk before entering.</strong>
                <span className="research-next-detail">
                  Position size and costs, calculated for you.
                </span>
              </span>
              <button
                className="button primary"
                onClick={() =>
                  document
                    .getElementById("trade-planner")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                Build trade plan <Target size={14} />
              </button>
            </div>
          )}
          {page === "Terminal" && (
            <div className="terminal-grid">
              <section className="panel chart-panel">
                <PanelTitle title="Price & technicals" tag="GP">
                  <button
                    className="icon-button"
                    aria-label={focus ? "Exit chart focus" : "Expand chart"}
                    onClick={() => setFocus(!focus)}
                  >
                    {focus ? <X size={15} /> : <Maximize2 size={15} />}
                  </button>
                </PanelTitle>
                <div className="security-header">
                  <div className="security-identity">
                    <span className="security-logo">
                      {short(symbol).replace("^", "").slice(0, 2)}
                    </span>
                    <div>
                      <button
                        className="symbol-picker"
                        onClick={() => openSearch()}
                      >
                        {short(symbol)}
                        <ChevronRight size={15} />
                      </button>
                      <p>
                        {meta.name}{" "}
                        <span>
                          ·{" "}
                          {exchangeName(quote?.exchange) ||
                            meta.market ||
                            "Market"}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="security-price">
                    <strong>
                      {fmt(quote?.price)}
                      <small>{quote?.currency || ""}</small>
                    </strong>
                    <span className={tone(quote?.change)}>
                      {pct(quote?.change)}{" "}
                      <span className="muted">session</span>
                    </span>
                  </div>
                </div>
                <div
                  className="regime-strip"
                  role="status"
                  aria-label="Market regime"
                >
                  <span className="regime-label">REGIME</span>
                  <strong className={regime.tone}>{regime.label}</strong>
                </div>
                <div className="chart-toolbar">
                  <div className="segments">
                    {Object.entries(ranges).map(([label, v]) => (
                      <button
                        key={v}
                        aria-pressed={range === v}
                        className={range === v ? "active" : ""}
                        onClick={() => setRange(v)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="chart-tools">
                    <select
                      aria-label="Chart type"
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                    >
                      <option>Candles</option>
                      <option>Area</option>
                    </select>
                    <button
                      className="icon-button"
                      title="Reset chart view"
                      aria-label="Reset chart view"
                      onClick={() => setReset((x) => x + 1)}
                    >
                      <RefreshCw size={13} />
                    </button>
                    <button
                      className="icon-button"
                      title="Export chart data"
                      aria-label="Export chart data"
                      disabled={!bars.length}
                      onClick={() =>
                        exportCSV(
                          [
                            ["Time", "Open", "High", "Low", "Close", "Volume"],
                            ...bars.map((b) => [
                              typeof b.time === "number"
                                ? new Date(b.time * 1000).toISOString()
                                : b.time,
                              b.open,
                              b.high,
                              b.low,
                              b.close,
                              b.volume,
                            ]),
                          ],
                          `${short(symbol)}-${range}.csv`,
                        )
                      }
                    >
                      <Download size={14} />
                    </button>
                    <button
                      className="icon-button"
                      title="Copy link to this view"
                      aria-label="Copy link to this view"
                      onClick={copyLink}
                    >
                      {copied ? <Check size={14} /> : <Share2 size={14} />}
                    </button>
                  </div>
                </div>
                <div className="indicator-toolbar">
                  {[
                    "Volume",
                    "EMA 20",
                    "EMA 50",
                    "Bollinger",
                    "RSI 14",
                    "VWAP",
                    "Key levels",
                  ].map((i) => (
                    <button
                      key={i}
                      className={indicators.includes(i) ? "enabled" : ""}
                      aria-pressed={indicators.includes(i)}
                      disabled={i === "VWAP" && !["1d", "5d"].includes(range)}
                      title={
                        i === "VWAP"
                          ? "Session VWAP · 1D and 5D ranges"
                          : i === "Key levels"
                            ? "Prior H/L, pivot, R1, S1 and plan lines"
                            : undefined
                      }
                      onClick={() =>
                        setIndicators(
                          indicators.includes(i)
                            ? indicators.filter((x) => x !== i)
                            : [...indicators, i],
                        )
                      }
                    >
                      {indicators.includes(i) && <span />}
                      {i}
                    </button>
                  ))}
                </div>
                <div className="chart-area">
                  {history.loading && !history.data ? (
                    <Empty
                      title="Loading market history"
                      description={`${meta.name} · ${range.toUpperCase()}`}
                    />
                  ) : history.error && !history.data ? (
                    <Empty
                      title="Price history unavailable"
                      description={history.error}
                    >
                      <button
                        className="button"
                        onClick={() => setRefresh((x) => x + 1)}
                      >
                        Retry data
                      </button>
                    </Empty>
                  ) : (
                    <ChartErrorBoundary key={symbol + range}>
                      <Suspense
                        fallback={<div className="loading">Loading chart…</div>}
                      >
                        <Chart
                          bars={bars}
                          levels={
                            indicators.includes("Key levels") ? levels : null
                          }
                          plan={draft}
                          type={type}
                          indicators={indicators}
                          range={range}
                          reset={reset}
                        />
                      </Suspense>
                    </ChartErrorBoundary>
                  )}
                </div>
                <div className="chart-caption">
                  <span>
                    Yahoo Finance · {dataStamp(quote)} · quotes may be delayed
                    {history.error ? " · last cached data" : ""}
                  </span>
                  <button onClick={() => setForm("alert")}>
                    <Bell size={12} /> Set alert
                  </button>
                </div>
                <details className="compact-details">
                  <summary>Daily levels & pivots</summary>
                  <KeyLevels
                    levels={levels}
                    loading={daily.loading}
                    error={daily.error}
                  />
                </details>
                <div className="quote-stats">
                  {[
                    ["Day low", quote?.dayLow],
                    ["Day high", quote?.dayHigh],
                    ["52W low", quote?.yearLow],
                    ["52W high", quote?.yearHigh],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <span>{k}</span>
                      <strong>{fmt(v)}</strong>
                    </div>
                  ))}
                </div>
              </section>
              <section
                className="panel watch-panel"
                id="watchlist-panel"
                ref={watchPanelRef}
              >
                <PanelTitle title="Watchlist" tag="WL">
                  <span className="muted">{watch.length} / 40</span>
                </PanelTitle>
                <div className="watch-changed">
                  {watchSummary.known ? (
                    <>
                      <span>
                        <strong
                          className={
                            watchSummary.avg >= 0 ? "positive" : "negative"
                          }
                        >
                          {pct(watchSummary.avg)}
                        </strong>{" "}
                        avg today
                      </span>
                      <span>
                        {watchSummary.up} up · {watchSummary.down} down
                        {watchSummary.flat
                          ? ` · ${watchSummary.flat} flat`
                          : ""}
                      </span>
                      {watchSummary.top && (
                        <span>
                          Biggest move{" "}
                          <button
                            className="link"
                            onClick={() => choose(watchSummary.top.symbol)}
                          >
                            {short(watchSummary.top.symbol)}{" "}
                            {pct(watchSummary.top.q.change)}
                          </button>
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="muted">Awaiting quotes</span>
                  )}
                </div>
                <Heatmap
                  compact
                  rows={watch.map((s) => ({ symbol: s, ...quotes[s] }))}
                  onOpen={choose}
                />
                <div className="watch-list-head">
                  <strong>Saved instruments</strong>
                  <button className="button" onClick={() => openSearch()}>
                    <Plus size={14} /> Add
                  </button>
                </div>
                {watch.length ? (
                  marketTable(true)
                ) : (
                  <div className="watch-empty">
                    Star any instrument to pin it here for one-tap research.
                    <br />
                    Try RELIANCE, NVDA or BTC-USD.
                  </div>
                )}
              </section>
              <ResearchCharts
                isNSE={isNS}
                bars={dailyBars}
                delivery={delFeed.data?.history || []}
                loading={daily.loading || delFeed.loading}
                error={daily.error || delFeed.error}
              />
              <section className="panel company-panel">
                <PanelTitle title="Company insights" tag="FA">
                  <button
                    className={`icon-button ${watch.includes(symbol) ? "starred" : ""}`}
                    aria-label={`${watch.includes(symbol) ? "Remove" : "Add"} ${short(symbol)} ${watch.includes(symbol) ? "from" : "to"} watchlist`}
                    onClick={() => toggleWatch(symbol)}
                  >
                    <Star
                      size={16}
                      fill={watch.includes(symbol) ? "currentColor" : "none"}
                    />
                  </button>
                </PanelTitle>
                <div className="company-identity">
                  <span className="security-logo">
                    {short(symbol).replace("^", "").slice(0, 2)}
                  </span>
                  <div>
                    <strong>{meta.name}</strong>
                    <p>
                      {short(symbol)} ·{" "}
                      {fund?.industry ||
                        fund?.sector ||
                        directory.get(symbol)?.sector ||
                        meta.sector ||
                        meta.market ||
                        "Market"}
                    </p>
                  </div>
                </div>
                <div className="signal-block">
                  <div className="signal-head">
                    <span>Daily trend bias</span>
                    <strong
                      className={
                        signal.verdict === "Bullish"
                          ? "positive"
                          : signal.verdict === "Bearish"
                            ? "negative"
                            : "muted"
                      }
                    >
                      {signal.rules.length
                        ? `${signal.verdict} · ${signal.score > 0 ? "+" : ""}${signal.score}`
                        : "Not enough data"}
                    </strong>
                  </div>
                  {signal.rules.length ? (
                    <div className="signal-rules">
                      {signal.rules.map((r) => (
                        <div key={r.label}>
                          <i
                            className={
                              r.bias > 0 ? "up" : r.bias < 0 ? "down" : ""
                            }
                          />
                          <span>{r.label}</span>
                          <em>{r.reading}</em>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <details className="signal-explainer">
                    <summary>
                      <Info size={14} /> Methodology <ChevronRight size={14} />
                    </summary>
                    <div>
                      <p>
                        {signal.rules.length
                          ? signalExplain(
                              signal.verdict,
                              signal.score,
                              signal.rules,
                            )
                          : "A separate one-year daily feed is used for this read. At least 70 completed bars are needed."}
                      </p>
                      <div className="signal-meta">
                        <span>
                          Daily bars · {dailyBars.length} completed ·
                          independent of chart range
                        </span>
                        <span>
                          Calculated{" "}
                          {daily.data?.fetchedAt
                            ? new Date(daily.data.fetchedAt).toLocaleString(
                                "en-GB",
                                {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )
                            : "just now"}{" "}
                          · last bar {dailyBars.at(-1)?.time || "—"}
                        </span>
                        <span>{sessionStatus(quote)}</span>
                      </div>
                      <p>
                        Score adds +1 per bullish rule and −1 per bearish rule
                        across 5 fixed rules (EMA-50 trend, RSI-14 momentum,
                        Bollinger position, 63-day momentum, EMA-50 slope). +2
                        or more is Bullish, −2 or less is Bearish, otherwise
                        Mixed. These overlapping indicators describe trend, not
                        a trading edge or an instruction to buy or sell.
                      </p>
                      <p>
                        Research horizon: completed daily closes from a separate
                        one-year feed, excluding today in the exchange timezone.
                        63-day momentum ≈ 3 months; EMA-50 slope looks back 10
                        days. Changing the chart range does not change this
                        read.
                      </p>
                      <p>
                        Market session: {sessionStatus(quote)}. Quotes may be
                        delayed; a stale quote may reflect a closed market or a
                        delayed feed. Signals are educational and never advice.
                      </p>
                    </div>
                  </details>
                </div>
                <div className="company-grid">
                  {(() => {
                    const L = fundFeed.loading && !fund;
                    const cell = (v) => (L ? "…" : v);
                    return [
                      [
                        "P/E · TTM",
                        cell(
                          Number.isFinite(fund?.peTrailing)
                            ? fmt(fund.peTrailing)
                            : "—",
                        ),
                      ],
                      [
                        "Forward P/E",
                        cell(
                          Number.isFinite(fund?.peForward)
                            ? fmt(fund.peForward)
                            : "—",
                        ),
                      ],
                      [
                        "EPS · TTM",
                        cell(
                          Number.isFinite(fund?.epsTrailing)
                            ? fmt(fund.epsTrailing)
                            : "—",
                        ),
                      ],
                      [
                        "EPS growth",
                        cell(
                          Number.isFinite(fund?.earningsGrowth)
                            ? pct(fund.earningsGrowth * 100)
                            : "—",
                        ),
                      ],
                      [
                        "ROE",
                        cell(
                          Number.isFinite(fund?.roe)
                            ? pct(fund.roe * 100)
                            : "—",
                        ),
                      ],
                      [
                        "Profit margin",
                        cell(
                          Number.isFinite(fund?.profitMargin)
                            ? pct(fund.profitMargin * 100)
                            : "—",
                        ),
                      ],
                      [
                        "Market cap",
                        cell(
                          Number.isFinite(fund?.marketCap)
                            ? compact(fund.marketCap)
                            : "—",
                        ),
                      ],
                      ...(isNS
                        ? [
                            [
                              "Delivery %",
                              del && Number.isFinite(del.delivPct)
                                ? `${fmt(del.delivPct, 1)}% · avg ${fmt(del.delivPctAvg, 0)}`
                                : delFeed.loading
                                  ? "…"
                                  : "—",
                            ],
                            [
                              "Delivery vs 20D",
                              del && Number.isFinite(del.delivRatio)
                                ? `${fmt(del.delivRatio, 1)}× · ${del.signal}`
                                : delFeed.loading
                                  ? "…"
                                  : "—",
                            ],
                          ]
                        : []),
                      ["As of", dataStamp(quote)],
                    ];
                  })().map(([k, v]) => (
                    <div key={k}>
                      <span>{k}</span>
                      <strong>{String(v)}</strong>
                    </div>
                  ))}
                </div>
                {fund?.businessSummary ? (
                  <details className="compact-details">
                    <summary>Company profile</summary>
                    <p className="company-biz">{fund.businessSummary}</p>
                  </details>
                ) : fundFeed.error ? (
                  <p className="company-biz muted">
                    Fundamentals unavailable. Try refreshing the data.
                  </p>
                ) : null}
                {fund &&
                  !symbol.startsWith("^") &&
                  !symbol.includes("=") &&
                  !symbol.endsWith("-USD") &&
                  ![
                    "Index",
                    "Commodity",
                    "Currency",
                    "Crypto",
                    "Yield",
                  ].includes(meta.sector) && (
                    <FairValue
                      key={symbol}
                      fund={fund}
                      price={quote?.price}
                      currency={quote?.currency || fund?.currency}
                    />
                  )}
                <div className="company-ranges">
                  {(() => {
                    const dl = quote?.dayLow,
                      dh = quote?.dayHigh,
                      p = quote?.price;
                    const dp =
                      Number.isFinite(dl) &&
                      Number.isFinite(dh) &&
                      Number.isFinite(p) &&
                      dh > dl
                        ? Math.min(
                            100,
                            Math.max(0, ((p - dl) / (dh - dl)) * 100),
                          )
                        : null;
                    const yl = quote?.yearLow,
                      yh = quote?.yearHigh;
                    const yp =
                      Number.isFinite(yl) &&
                      Number.isFinite(yh) &&
                      Number.isFinite(p) &&
                      yh > yl
                        ? Math.min(
                            100,
                            Math.max(0, ((p - yl) / (yh - yl)) * 100),
                          )
                        : null;
                    return (
                      <>
                        <div>
                          <div className="range-head">
                            <span>Day range</span>
                            <span>
                              {fmt(dl)} – {fmt(dh)}
                            </span>
                          </div>
                          <div className="range-bar">
                            <i style={{ width: (dp ?? 0) + "%" }} />
                          </div>
                        </div>
                        <div>
                          <div className="range-head">
                            <span>52-week range</span>
                            <span>
                              {fmt(yl)} – {fmt(yh)}
                            </span>
                          </div>
                          <div className="range-bar">
                            <i style={{ width: (yp ?? 0) + "%" }} />
                          </div>
                        </div>
                        <div className="range-head">
                          <span>Volume</span>
                          <span>{compact(quote?.volume)}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
                <div className="company-actions">
                  <button
                    className="button"
                    onClick={() => setPage("Forecast")}
                  >
                    <Activity size={14} /> Forecast
                  </button>
                  <button
                    className="button"
                    onClick={() => toggleWatch(symbol)}
                  >
                    <Star size={14} />
                    {watch.includes(symbol) ? "Watching" : "Add to watchlist"}
                  </button>
                  <button className="button" onClick={() => setForm("alert")}>
                    <Bell size={14} /> Set alert
                  </button>
                  <button
                    className="button"
                    onClick={() => setForm("position")}
                  >
                    <Plus size={14} /> Track
                  </button>
                  {(isNS || symbol === "^NSEI" || symbol === "^NSEBANK") && (
                    <button
                      className="button"
                      title="End-of-day option chain, if this stock trades in F&O"
                      onClick={() => {
                        try {
                          localStorage.setItem(
                            "an2-fno-symbol",
                            JSON.stringify(
                              symbol === "^NSEI"
                                ? "NIFTY"
                                : symbol === "^NSEBANK"
                                  ? "BANKNIFTY"
                                  : symbol.slice(0, -3),
                            ),
                          );
                        } catch {}
                        setPage("FnO");
                      }}
                    >
                      <Layers size={14} /> Options
                    </button>
                  )}
                </div>
                <div className="panel-foot">Delayed · research only</div>
              </section>
              <section id="trade-planner" className="planner-disclosure panel">
                <TradePlanner
                  symbol={symbol}
                  currency={quote?.currency}
                  quote={quote}
                  levels={levels}
                  draft={draft}
                  setDraft={setDraft}
                  supported={
                    ![
                      "Index",
                      "Commodity",
                      "Currency",
                      "Crypto",
                      "Yield",
                    ].includes(meta.sector) &&
                    !symbol.startsWith("^") &&
                    !symbol.includes("=") &&
                    !symbol.endsWith("-USD")
                  }
                  onJournal={() => setPage("Journal")}
                  onSave={(plan) => {
                    setJournal((cur) => [
                      {
                        ...plan,
                        id: uid(),
                        createdAt: new Date().toISOString(),
                      },
                      ...cur,
                    ]);
                    notify("Plan saved to journal. No order placed.");
                    setPage("Journal");
                  }}
                />
              </section>

              <News symbol={symbol} refresh={refresh} />
            </div>
          )}
          {page === "Forecast" && (
            <Forecast
              key={symbol}
              symbol={symbol}
              refresh={refresh}
              onRefresh={() => setRefresh((x) => x + 1)}
              onSearch={() => openSearch("forecast")}
              onOpenChart={() => setPage("Terminal")}
            />
          )}
          {page === "Screener" && (
            <div className="side-grid">
              <Screener
                view={screenerView}
                setView={setScreenerView}
                onOpen={openSymbol}
                watch={watch}
                toggleWatch={toggleWatch}
                refresh={refresh}
                onRefresh={() => setRefresh((x) => x + 1)}
                saved={savedScreens}
                setSaved={setSavedScreens}
                pushOn={!!alertPrefs?.push}
                notify={notify}
                goAlerts={() => setPage("Alerts")}
              />
            </div>
          )}
          {page === "Delivery" && (
            <div className="side-grid">
              <DeliveryRadar
                onOpen={openSymbol}
                watch={watch}
                toggleWatch={toggleWatch}
                refresh={refresh}
                onRefresh={() => setRefresh((x) => x + 1)}
                pushOn={!!alertPrefs?.push}
                digestOn={!!alertPrefs?.delivery}
                setDigest={(v) => {
                  setPushPref("delivery", v);
                  notify(
                    v
                      ? "Delivery digest on — arrives after NSE publishes (19:30–22:30 IST)."
                      : "Delivery digest off.",
                  );
                }}
                goAlerts={() => setPage("Alerts")}
              />
            </div>
          )}
          {page === "Markets" && (
            <Pulse onOpen={openSymbol} refresh={refresh} />
          )}
          {page === "Markets" && (
            <Rotation onOpen={openSymbol} refresh={refresh} />
          )}
          {page === "FnO" && (
            <FnO
              symbol={symbol}
              onOpen={openSymbol}
              refresh={refresh}
              onRefresh={() => setRefresh((x) => x + 1)}
              watch={watch}
            />
          )}
          {page === "Flows" && (
            <Flows
              onOpen={openSymbol}
              refresh={refresh}
              onRefresh={() => setRefresh((x) => x + 1)}
              watch={watch}
              toggleWatch={toggleWatch}
            />
          )}
          {page === "Markets" && (
            <section className="panel market-panel">
              <PanelTitle title="Cross-asset monitor" tag="WEI">
                <button
                  className="button"
                  onClick={() =>
                    exportCSV(
                      [
                        [
                          "Symbol",
                          "Name",
                          "Currency",
                          "Last",
                          "Change %",
                          "Volume",
                          "As of",
                        ],
                        ...rows.map((x) => [
                          x.symbol,
                          x.name,
                          x.currency,
                          x.price,
                          x.change,
                          x.volume,
                          dataStamp(x),
                        ]),
                      ],
                      "alphanova-market.csv",
                    )
                  }
                >
                  <Download size={14} /> Export
                </button>
              </PanelTitle>
              <div className="market-filters">
                <div className="segments">
                  {["Watchlist", ...Object.keys(groups)].map((g) => (
                    <button
                      key={g}
                      className={group === g ? "active" : ""}
                      onClick={() => {
                        setGroup(g);
                        setFilter("");
                      }}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <input
                  aria-label="Filter market instruments"
                  placeholder="Filter instruments…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              {marketTable()}
              <div className="panel-foot">
                Curated universe · click an instrument to research · 5-day
                sparklines · source: Yahoo Finance
              </div>
            </section>
          )}
          {page === "Journal" && (
            <TradeJournal
              entries={journal}
              setEntries={setJournal}
              onOpen={openSymbol}
              onPlan={() => setPage("Terminal")}
              exportCSV={exportCSV}
              notify={notify}
            />
          )}
          {page === "News" && (
            <>
              <div className="news-controls">
                <button
                  className="button"
                  aria-pressed={symbol === "^GSPC"}
                  onClick={() => navigate({ symbol: "^GSPC" })}
                >
                  Global markets
                </button>
                <button
                  className="button"
                  aria-pressed={symbol === "^NSEI"}
                  onClick={() => navigate({ symbol: "^NSEI" })}
                >
                  India markets
                </button>
                <button className="button" onClick={() => openSearch("news")}>
                  Find company news
                </button>
                <span className="muted">Showing {meta.name}</span>
              </div>
              <News key={symbol} symbol={symbol} refresh={refresh} full />
            </>
          )}
          {page === "Portfolio" && (
            <>
              <section className="panel">
                <PanelTitle title="Holdings" tag="PORT">
                  <button
                    className="button"
                    onClick={() => setForm("position")}
                  >
                    <Plus size={14} /> Add {short(symbol)}
                  </button>
                </PanelTitle>
                <div className="portfolio-summary">
                  {[...new Set(positions.map((x) => x.currency))].map((c) => {
                    const ps = positions.filter((x) => x.currency === c),
                      cost = ps.reduce((v, x) => v + x.cost * x.quantity, 0),
                      known = ps.every((x) =>
                        Number.isFinite(quotes[x.symbol]?.price),
                      ),
                      value = known
                        ? ps.reduce(
                            (v, x) => v + quotes[x.symbol].price * x.quantity,
                            0,
                          )
                        : null;
                    return (
                      <div key={c}>
                        <span>{c} HOLDINGS</span>
                        <strong>
                          {fmt(value)} <small>{c}</small>
                        </strong>
                        <p
                          className={tone(value === null ? null : value - cost)}
                        >
                          {value === null
                            ? "Awaiting quotes"
                            : `${cost > 0 ? pct((value / cost - 1) * 100) : "—"} · ${fmt(value - cost)} unrealized`}
                        </p>
                      </div>
                    );
                  })}
                </div>
                {!positions.length ? (
                  <Empty
                    title="Build your personal portfolio"
                    description="Track quantity, average cost and market value. Holdings stay in this browser; no brokerage connection."
                  >
                    <button
                      className="button primary"
                      onClick={() => setForm("position")}
                    >
                      <Plus size={14} /> Add {short(symbol)}
                    </button>
                  </Empty>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {[
                            "Instrument",
                            "Quantity",
                            "Avg. cost",
                            "Last",
                            "Market value",
                            "Unrealized P&L",
                            "",
                          ].map((x, i) => (
                            <th key={i}>{x}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {positions.map((p) => {
                          const q = quotes[p.symbol],
                            gain = q ? (q.price - p.cost) * p.quantity : null;
                          return (
                            <tr key={p.id}>
                              <td>
                                <button
                                  className="instrument"
                                  onClick={() => choose(p.symbol)}
                                >
                                  <strong>{short(p.symbol)}</strong>
                                  <span>{p.currency}</span>
                                </button>
                              </td>
                              <td className="number">{fmt(p.quantity, 3)}</td>
                              <td className="number">{fmt(p.cost)}</td>
                              <td className="number">{fmt(q?.price)}</td>
                              <td className="number">
                                {q ? fmt(q.price * p.quantity) : "—"}
                              </td>
                              <td className={`number ${tone(gain)}`}>
                                {fmt(gain)}
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  aria-label={`Remove ${p.symbol} position`}
                                  onClick={() => {
                                    setPositions(
                                      positions.filter((x) => x.id !== p.id),
                                    );
                                    notify("Position removed", () =>
                                      setPositions((current) => [
                                        ...current,
                                        p,
                                      ]),
                                    );
                                  }}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="panel-foot">
                  Currencies are totaled separately · does not include
                  dividends, fees or taxes · saved on this device
                </div>
              </section>
              <section className="panel backup-panel">
                <PanelTitle title="Backup & restore" tag="SAFE">
                  <>
                    <button className="button" onClick={doExportBackup}>
                      <Download size={14} /> Export backup
                    </button>
                    <button
                      className="button"
                      onClick={() => fileRef.current?.click()}
                    >
                      <Upload size={14} /> Import
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/json,.json"
                      hidden
                      onChange={(e) => {
                        doImportBackup(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </>
                </PanelTitle>
                <div className="backup-body">
                  <div className="backup-counts">
                    <span>{(watch || []).length} watchlisted</span>
                    <span>{positions.length} holdings</span>
                    <span>{alerts.length} alerts</span>
                    <span>{journal.length} journal entries</span>
                    <span>{(deliveryHistory || []).length} deliveries</span>
                  </div>
                  {backupMsg && (
                    <div className="notice" role="status">
                      {backupMsg}
                    </div>
                  )}
                  {backupErr && (
                    <div className="notice error" role="alert">
                      {backupErr}
                    </div>
                  )}
                  <details className="recovery-guide">
                    <summary>
                      <ShieldCheck size={14} /> Data lives only in this browser
                      — export regularly. How restore works
                    </summary>
                    <ol>
                      <li>
                        <strong>Export regularly:</strong> use Export backup
                        after changing watchlists, holdings or alerts. Keep the
                        JSON file somewhere safe.
                      </li>
                      <li>
                        <strong>Restore:</strong> use Import on the new device
                        or after clearing data, then check counts above match.
                      </li>
                      <li>
                        <strong>If data is gone:</strong> there is no cloud copy
                        to recover — re-import your last backup file. Without a
                        backup, you will need to re-add instruments manually.
                      </li>
                    </ol>
                    <p className="muted small">
                      Backup includes watchlist, holdings, alerts, delivery
                      history, saved screens, trade journal and the current
                      instrument. Older backups preserve your existing journal.
                      Browser-notification permission is never exported — re-opt
                      in after import. Existing saved data keeps working;
                      importing replaces the lists present in the backup.
                    </p>
                  </details>
                </div>
                <div className="panel-foot">
                  Tip: export before switching browsers or clearing storage ·
                  JSON opens in any text editor
                </div>
              </section>
            </>
          )}
          {page === "Watchlist" && <Watchlist watch={watch} quotes={quotes} refresh={refresh} onNavigate={navigate}
            onToggle={toggleWatch} onSearch={() => openSearch()} onAlert={openWatchAlert}
            onGuide={openGuide} onCopy={copyLink} />}
          {page === "Alerts" && (
            <>
              <section className="panel">
                <PanelTitle title="Price monitor" tag="ALRT">
                  <button className="button" onClick={() => setForm("alert")}>
                    <Plus size={14} /> New alert
                  </button>
                </PanelTitle>
                <div className="push-panel">
                  <div className="push-status">
                    <span
                      className={`push-icon ${alertPrefs?.push ? "on" : ""}`}
                    >
                      <Smartphone size={18} />
                    </span>
                    <div>
                      <strong>
                        {alertPrefs?.push
                          ? "Push notifications are on"
                          : "Push notifications — even when the app is closed"}
                      </strong>
                      <span className="muted small">
                        {alertPrefs?.push
                          ? "Evening checks: 19:30–20:30 and 21:30–22:30 IST. In-tab price checks every 30 sec."
                          : !pushSupported() && isIOS() && !isStandalone()
                            ? "On iPhone/iPad: tap Share → Add to Home Screen, open Alpha Nova from the Home Screen, then enable push here."
                            : !pushSupported()
                              ? "This browser does not support Web Push."
                              : "Two evening checks · price alerts checked every 30 sec while open."}
                      </span>
                    </div>
                    <div className="push-actions">
                      {alertPrefs?.push ? (
                        <>
                          <button
                            className="button"
                            disabled={pushBusy}
                            onClick={() => pushOp("test")}
                          >
                            <Send size={14} /> Send test
                          </button>
                          <button
                            className="button"
                            disabled={pushBusy || !alerts.length}
                            onClick={() => pushOp("check")}
                          >
                            <RefreshCw size={14} /> Check now
                          </button>
                          <button
                            className="button"
                            disabled={pushBusy}
                            onClick={turnOffPush}
                          >
                            <BellOff size={14} /> Turn off
                          </button>
                        </>
                      ) : (
                        <button
                          className="button primary"
                          disabled={pushBusy || !pushSupported()}
                          onClick={turnOnPush}
                        >
                          <BellRing size={14} />{" "}
                          {pushBusy ? "Enabling…" : "Enable push"}
                        </button>
                      )}
                    </div>
                  </div>
                  {alertPrefs?.push && (
                    <div className="push-options">
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={alertPrefs?.pushAlerts !== false}
                          onChange={(e) =>
                            setPushPref("pushAlerts", e.target.checked)
                          }
                        />{" "}
                        Price alerts
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={!!alertPrefs?.delivery}
                          onChange={(e) =>
                            setPushPref("delivery", e.target.checked)
                          }
                        />{" "}
                        Daily delivery radar digest
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={alertPrefs?.screens !== false}
                          onChange={(e) =>
                            setPushPref("screens", e.target.checked)
                          }
                        />{" "}
                        Saved-screen matches ({savedScreens.length})
                      </label>
                    </div>
                  )}
                  <details className="inline-details">
                    <summary>Alert timing & limitations</summary>
                    <p className="push-note muted small">
                      Two weekday evening checks: 19:30–20:30 and 21:30–22:30
                      IST. Active tabs check every 30 seconds. Delayed quotes can
                      miss brief price touches; alerts are not stop-loss orders.
                      Delivery and saved-screen digests run after NSE publishes.
                    </p>
                  </details>
                </div>
                <div className="notice subtle">
                  Checks every 30 sec while open · duplicates suppressed for 24h.
                </div>
                <div className="alert-prefs">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!!alertPrefs?.browser}
                      onChange={(e) => {
                        if (e.target.checked) enableBrowserAlerts();
                        else {
                          setAlertPrefs({ ...alertPrefs, browser: false });
                          notify(
                            "In-tab notifications off. In-app alerts continue.",
                          );
                        }
                      }}
                    />{" "}
                    In-tab notifications
                  </label>
                  <span className="muted small">
                    {typeof Notification === "undefined"
                      ? "Not supported here"
                      : Notification.permission === "granted"
                        ? "On · works when tab is backgrounded, not when browser is fully closed"
                        : Notification.permission === "denied"
                          ? "Blocked in browser settings"
                          : "Off"}
                  </span>
                  <button className="button" onClick={testBrowserAlert}>
                    Send test
                  </button>
                </div>
                {!alerts.length ? (
                  <Empty
                    title="Keep an eye on a price"
                    description="Choose an instrument and set an above or below threshold."
                  >
                    <button
                      className="button primary"
                      onClick={() => setForm("alert")}
                    >
                      Create an alert
                    </button>
                  </Empty>
                ) : (
                  <div className="alert-list">
                    {alerts.map((a) => (
                      <div key={a.id}>
                        <Bell size={19} />
                        <button onClick={() => choose(a.symbol)}>
                          {short(a.symbol)}
                        </button>
                        <span>
                          {a.condition} <strong>{fmt(a.price)}</strong>
                        </span>
                        <span
                          className={`alert-state ${a.triggered ? "positive" : "muted"}`}
                        >
                          {a.triggered
                            ? a.deduped
                              ? "Triggered · duplicate"
                              : a.via === "push"
                                ? "Triggered · pushed"
                                : "Triggered"
                            : alertPrefs?.push
                              ? "Watching · push"
                              : "Watching"}
                        </span>
                        <span className="muted">
                          Last {fmt(quotes[a.symbol]?.price)}
                        </span>
                        {a.triggered && (
                          <button
                            className="button"
                            onClick={() => {
                              setAlerts(
                                alerts.map((x) =>
                                  x.id === a.id
                                    ? {
                                        ...x,
                                        triggered: false,
                                        triggeredAt: null,
                                        deduped: undefined,
                                        created: Date.now(),
                                      }
                                    : x,
                                ),
                              );
                              notify("Alert re-armed.");
                            }}
                          >
                            Re-arm
                          </button>
                        )}
                        <button
                          className="icon-button"
                          aria-label={`Delete ${a.symbol} alert`}
                          onClick={() => {
                            setAlerts(alerts.filter((x) => x.id !== a.id));
                            notify("Alert deleted", () =>
                              setAlerts((current) => [...current, a]),
                            );
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section className="panel">
                <PanelTitle title="Delivery history" tag="LOG">
                  <>
                    <span className="muted">
                      {(deliveryHistory || []).length} events
                    </span>
                    <button
                      className="button"
                      onClick={() => {
                        setDeliveryHistory([]);
                        notify("Delivery history cleared.");
                      }}
                    >
                      Clear
                    </button>
                  </>
                </PanelTitle>
                {!(deliveryHistory || []).length ? (
                  <div className="watch-empty">
                    No deliveries yet. Triggered alerts appear here with time,
                    price and channel (notification / in-app / deduped).
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Alert</th>
                          <th>Observed</th>
                          <th>Channel</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deliveryHistory.map((h) => (
                          <tr key={h.id}>
                            <td className="muted small">
                              {Number.isFinite(Date.parse(h.at))
                                ? new Date(h.at).toLocaleString("en-GB", {
                                    day: "2-digit",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "—"}
                            </td>
                            <td>
                              {h.kind && h.kind !== "alert" ? (
                                <>
                                  <strong>{h.title}</strong>{" "}
                                  <span className="muted">{h.body}</span>
                                </>
                              ) : (
                                <>
                                  <strong>{short(h.symbol)}</strong>{" "}
                                  <span className="muted">
                                    {h.condition} {fmt(h.target)}
                                  </span>
                                </>
                              )}
                            </td>
                            <td className="number">{fmt(h.observed)}</td>
                            <td>
                              <span className={`history-chip ${h.channel}`}>
                                {h.channel === "push"
                                  ? "Push (server)"
                                  : h.channel === "notification"
                                    ? "Notification"
                                    : h.channel === "deduped"
                                      ? "Duplicate suppressed"
                                      : "In-app"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="panel-foot">
                  <History size={12} /> History is device-local and included in
                  backups. With push on, server deliveries sync here when you
                  open the app.
                </div>
              </section>
            </>
          )}
        </Suspense>
      </main>
      <footer>
        <span>
          <i /> ALPHA NOVA TERMINAL <b>2.5</b>
        </span>
        <span>Market data may be delayed · Research only</span>
        <a href="/stock-prices.html">Stock prices</a>
        <a href="/stock-market-app.html">Stock market app</a>
        <a href="/about.html">About & data sources</a>
        <a
          href="https://www.tradingview.com/lightweight-charts/"
          target="_blank"
          rel="noreferrer"
        >
          Lightweight Charts by TradingView
        </a>
        <button onClick={() => setHelp(true)}>
          Keyboard shortcuts <kbd>?</kbd>
        </button>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{toast}</span>
          {undo && (
            <button
              className="undo-button"
              onClick={() => {
                undo();
                setToast("Restored");
                setUndo(null);
              }}
            >
              Undo
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <dialog
        ref={dialogRef}
        className="dialog"
        aria-label={
          showSearch
            ? "Find an instrument"
            : help
              ? "Help and shortcuts"
              : form === "position"
                ? "Track a position"
                : "Create a price alert"
        }
        onCancel={() => {
          setShowSearch(false);
          setHelp(false);
          setForm(null);
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) {
            setShowSearch(false);
            setHelp(false);
            setForm(null);
          }
        }}
      >
        {showSearch ? (
          <div className="search-dialog">
            <div className="search-input">
              <Search size={20} />
              <input
                ref={searchRef}
                aria-label="Search symbols or commands"
                placeholder="Search symbol or company…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveIdx((i) =>
                      Math.min(i + 1, Math.max(0, results.length - 1)),
                    );
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveIdx((i) => Math.max(0, i - 1));
                  } else if (
                    e.key === "Enter" &&
                    (results[activeIdx] || results[0])
                  )
                    choose((results[activeIdx] || results[0]).symbol);
                }}
              />
              <button
                className="icon-button"
                aria-label="Close search"
                onClick={() => setShowSearch(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="command-shortcuts">
              {PAGES.filter(
                (p) =>
                  !query ||
                  `${p} ${PAGE_LABELS[p]}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              ).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setPage(p);
                    setForm(null);
                    setSearchTarget(null);
                    setShowSearch(false);
                    setQuery("");
                  }}
                >
                  <Command size={13} />
                  {PAGE_LABELS[p]}
                </button>
              ))}
            </div>
            {!query && recent.length ? (
              <div className="recent-row">
                <span>Recent</span>
                {recent
                  .filter((s) => directory.get(s))
                  .slice(0, 8)
                  .map((s) => (
                    <button key={s} onClick={() => choose(s)}>
                      {short(s)}
                    </button>
                  ))}
              </div>
            ) : null}
            <div className="search-results">
              {results.map((r, idx) => (
                <div
                  id={`search-result-${idx}`}
                  key={r.symbol}
                  className={idx === activeIdx ? "active" : ""}
                >
                  <button onClick={() => choose(r.symbol)}>
                    <span>
                      <strong>{short(r.symbol)}</strong>
                      <small>{r.name}</small>
                    </span>
                    <em>{r.market}</em>
                  </button>
                  <button
                    className={`icon-button ${watch.includes(r.symbol) ? "starred" : ""}`}
                    aria-label={`${watch.includes(r.symbol) ? "Remove" : "Add"} ${short(r.symbol)} ${watch.includes(r.symbol) ? "from" : "to"} watchlist`}
                    onClick={() => toggleWatch(r.symbol)}
                  >
                    <Star
                      size={16}
                      fill={watch.includes(r.symbol) ? "currentColor" : "none"}
                    />
                  </button>
                </div>
              ))}
              {!results.length && (
                <Empty
                  title="No matches"
                  description="Search by company name or ticker, such as RELIANCE or AAPL."
                />
              )}
            </div>
            <div className="panel-foot">
              ↑↓ to move · Enter opens · Esc to close
            </div>
          </div>
        ) : help ? (
          <div className="modal-content">
            <button
              className="close icon-button"
              aria-label="Close help"
              onClick={() => setHelp(false)}
            >
              <X />
            </button>
            <h2>Your research workspace</h2>
            <p>
              Search Indian equities, US companies, indices, FX, commodities and
              crypto. Click any instrument to open its price history.
            </p>
            <dl>
              <dt>⌘ / Ctrl + K or /</dt>
              <dd>Search instruments and workspaces</dd>
              <dt>1 – 8</dt>
              <dd>Chart range 1D → 5Y on the Terminal</dd>
              <dt>Esc</dt>
              <dd>Close dialogs or expanded chart</dd>
              <dt>Chart</dt>
              <dd>Drag to pan · scroll to zoom · hover for OHLC</dd>
              <dt>Refresh</dt>
              <dd>
                Quotes refresh every 30 seconds in an active tab. Upstream and
                edge caches can delay updates.
              </dd>
            </dl>
            <p>
              Free public data is provided by Yahoo Finance and can be delayed
              or unavailable. No synthetic prices or simulated chart history are
              shown. Watchlists, holdings and alerts are stored only in this
              browser.
            </p>
            <button className="button" onClick={() => { setHelp(false); openGuide(); }}>Reopen interactive watchlist guide</button>
            <p>
              <strong>Backup:</strong> open Portfolio → Backup & restore to
              export a JSON copy of watchlists, holdings, alerts and delivery
              history. Import it to restore. There is no cloud copy.
            </p>
            <p>
              <strong>Alerts:</strong> turn on push on the Alerts page to get
              evening price checks, the delivery digest and saved-screen matches
              with the app closed (iPhone: add to Home Screen first). The app
              also checks every 30 seconds while open.
            </p>
            <p>
              <strong>Delivery radar:</strong> NSE end-of-day delivered quantity
              versus each stock’s 20-session average, classified as
              accumulation, distribution or high conviction.
            </p>
            <p>
              <strong>Screener:</strong> Nifty 500 scanned on momentum, relative
              strength, trend, volume and delivery. Ten presets, a custom rule
              builder, and up to five saved screens.
            </p>
            <p>
              <strong>Signals:</strong> Bullish at +2 or more, Bearish at −2 or
              less, otherwise Mixed, from 5 fixed rules on completed daily bars.
              The bias is independent of chart range and is not a buy or sell
              instruction. See “Methodology” under Company insights for horizon,
              calculation time and session status.
            </p>
            <p>
              <strong>News:</strong> SEC filings and material events rank above
              generic price pages.
            </p>
            <p className="muted">
              TradingView Lightweight Charts™
              <br />
              Copyright (c) 2025 TradingView, Inc.
            </p>
          </div>
        ) : form ? (
          <form onSubmit={submitForm} className="modal-content">
            <button
              type="button"
              className="close icon-button"
              aria-label="Close form"
              onClick={() => setForm(null)}
            >
              <X />
            </button>
            <div className="eyebrow">
              {short(symbol)} · {quote?.currency || ""}
            </div>
            <h2>
              {form === "position"
                ? "Track a position"
                : "Create a price alert"}
            </h2>
            <div className="form-instrument">
              <div>
                <strong>{short(symbol)}</strong>
                <span>
                  {meta.name} · {fmt(quote?.price)} {quote?.currency || ""}
                </span>
              </div>
              <button
                type="button"
                className="button"
                onClick={() => openSearch(form)}
              >
                Change
              </button>
            </div>
            {form === "position" ? (
              <>
                <label>
                  Quantity
                  <input
                    name="quantity"
                    type="number"
                    min="0.000001"
                    step="any"
                    required
                    autoFocus
                  />
                </label>
                <label>
                  Average cost per unit (
                  {quote?.currency || "awaiting currency"})
                  <input
                    name="cost"
                    type="number"
                    min="0.000001"
                    step="any"
                    required
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  Notify when price goes
                  <select name="condition">
                    <option value="above">Above</option>
                    <option value="below">Below</option>
                  </select>
                </label>
                <label>
                  Target price ({quote?.currency || "instrument currency"})
                  <input
                    name="price"
                    type="number"
                    min="0.000001"
                    step="any"
                    required
                    autoFocus
                  />
                </label>
              </>
            )}
            <button
              className="button primary"
              disabled={form === "position" && !quote?.currency}
            >
              {form === "position" ? "Save position" : "Create alert"}
            </button>
            <p className="small muted">
              {form === "position"
                ? "Saved on this device. No orders are placed."
                : alertPrefs?.push
                  ? "Evening push checks; every 30 sec while this tab is active."
                  : "Checked while the tab is loaded; turn on push in Alerts for delivery when the app is closed."}
            </p>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
