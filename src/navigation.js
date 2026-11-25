import { normalizeSymbol } from './symbols.js';
import { WORKSPACE_SEO } from "./seo.js";

export const NAV_GROUPS = [
  { label: "Workspace", pages: ["Today", "Terminal", "Forecast"] },
  {
    label: "Discover",
    pages: ["Markets", "Screener", "Fundamentals", "Breakouts", "Analytics", "Delivery", "FnO", "Flows", "News"],
  },
  { label: "Personal", pages: ["Watchlist", "Portfolio", "Journal", "Alerts"] },
];
export const PAGE_LABELS = {
  Today: "Top Setups",
  Terminal: "Charts & plan",
  Forecast: "Forecast",
  Markets: "Markets",
  Screener: "Screener",
  Fundamentals: "Fundamentals",
  Breakouts: "Breakout insights",
  Analytics: "Advanced analytics",
  Delivery: "Delivery radar",
  FnO: "Futures & options",
  Flows: "Institutional flows",
  News: "News",
  Portfolio: "Portfolio",
  Watchlist: "Watchlist",
  Journal: "Trade journal",
  Alerts: "Price alerts",
};
export const PAGES = NAV_GROUPS.flatMap((group) => group.pages);
export const PRO_CHECKOUT_PATH = "/pro/checkout";
export const RANGE_VALUES = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"];

export function viewFromSearch(search, fallback = {}) {
  const params = new URLSearchParams(search);
  const page = params.get("page"),
    symbol = params.get("symbol"),
    range = params.get("range");
  return {
    page: PAGES.includes(page) ? page : fallback.page || "Today",
    symbol:
      symbol && /^[A-Za-z0-9^][A-Za-z0-9._^=&-]{0,24}$/.test(symbol)
        ? normalizeSymbol(symbol)
        : fallback.symbol || "RELIANCE.NS",
    range: RANGE_VALUES.includes(range) ? range : fallback.range || "6mo",
  };
}

export function viewFromLocation(location, fallback = {}) {
  const path = location.pathname.replace(/\/$/, '') || '/';
  const page = path === PRO_CHECKOUT_PATH ? "Breakouts" : Object.keys(WORKSPACE_SEO).find(key => WORKSPACE_SEO[key].path === path);
  // Named routes take precedence; the root continues to accept old shared links.
  const params = new URLSearchParams(location.search);
  if (path !== "/" && page) params.delete("page");
  return viewFromSearch(params.toString(), { ...fallback, page: page || fallback.page });
}

export function workspaceSearch(location) {
  const params = new URLSearchParams(location.search);
  params.set("page", viewFromLocation(location).page);
  return params.toString();
}

export function workspaceURL(page) {
  return (WORKSPACE_SEO[page] || WORKSPACE_SEO.Today).path;
}

export function viewURL(href, view, { share = true, paidCheckout = false } = {}) {
  const url = new URL(href);
  url.pathname = paidCheckout && view.page === "Breakouts" ? PRO_CHECKOUT_PATH : workspaceURL(view.page);
  url.searchParams.delete("page");
  // `?pro=1` opens the Pro paywall on arrival only; it does not follow the reader around.
  url.searchParams.delete("pro");
  for (const key of ["symbol", "range"])
    if (share || ["Terminal", "Forecast", "News"].includes(view.page) || (key === "symbol" && ["Breakouts", "Analytics", "Fundamentals"].includes(view.page))) url.searchParams.set(key, view[key]);
    else url.searchParams.delete(key);
  if (share && view.page === "Screener" && view.screen && view.screen !== "custom")
    url.searchParams.set("screen", view.screen);
  else url.searchParams.delete("screen");
  url.hash = "";
  return url.pathname + url.search;
}
