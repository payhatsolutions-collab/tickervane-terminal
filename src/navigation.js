import { WORKSPACE_SEO } from "./seo.js";

export const NAV_GROUPS = [
  { label: "Workspace", pages: ["Today", "Terminal", "Forecast"] },
  {
    label: "Discover",
    pages: ["Markets", "Screener", "Delivery", "FnO", "Flows", "News"],
  },
  { label: "Personal", pages: ["Watchlist", "Portfolio", "Journal", "Alerts"] },
];
export const PAGE_LABELS = {
  Today: "Overview",
  Terminal: "Charts & plan",
  Forecast: "Forecast",
  Markets: "Markets",
  Screener: "Screener",
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
export const RANGE_VALUES = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"];

export function viewFromSearch(search, fallback = {}) {
  const params = new URLSearchParams(search);
  const page = params.get("page"),
    symbol = params.get("symbol"),
    range = params.get("range");
  return {
    page: PAGES.includes(page) ? page : fallback.page || "Today",
    symbol:
      symbol && /^[A-Za-z0-9^=._-]{1,25}$/.test(symbol)
        ? symbol.toUpperCase()
        : fallback.symbol || "RELIANCE.NS",
    range: RANGE_VALUES.includes(range) ? range : fallback.range || "6mo",
  };
}

export function viewFromLocation(location, fallback = {}) {
  const path = location.pathname.replace(/\/$/, '') || '/';
  const page = Object.keys(WORKSPACE_SEO).find(key => WORKSPACE_SEO[key].path === path);
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

export function viewURL(href, view, { share = true } = {}) {
  const url = new URL(href);
  url.pathname = workspaceURL(view.page);
  url.searchParams.delete("page");
  for (const key of ["symbol", "range"])
    if (share) url.searchParams.set(key, view[key]);
    else url.searchParams.delete(key);
  if (share && view.page === "Screener" && view.screen && view.screen !== "custom")
    url.searchParams.set("screen", view.screen);
  else url.searchParams.delete("screen");
  url.hash = "";
  return url.pathname + url.search;
}
