import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Bell,
  Globe2,
  History,
  Landmark,
  Layers,
  LayoutDashboard,
  MoreHorizontal,
  Newspaper,
  Radar,
  RefreshCw,
  SlidersHorizontal,
  Star,
  Target,
  Wallet,
  X,
} from "lucide-react";
import { NAV_GROUPS, PAGE_LABELS } from "./navigation.js";
import ThemeToggle from "./ThemeToggle.jsx";

const icons = {
  Today: Target,
  Terminal: LayoutDashboard,
  Forecast: Activity,
  Markets: Globe2,
  Screener: SlidersHorizontal,
  Delivery: Radar,
  FnO: Layers,
  Flows: Landmark,
  News: Newspaper,
  Portfolio: Wallet,
  Watchlist: Star,
  Journal: History,
  Alerts: Bell,
};
const primary = ["Today", "Markets", "Screener", "Terminal"];

export default function Navigation({
  page,
  onPage,
  triggered,
  loading,
  onRefresh,
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    setOpen(false);
  }, [page]);
  const choose = (next) => {
    onPage(next);
    setOpen(false);
  };
  const item = (name, mobile = false) => {
    const Icon = icons[name];
    return (
      <button
        key={name}
        aria-current={page === name ? "page" : undefined}
        className={page === name ? "active" : ""}
        onClick={() => choose(name)}
        title={PAGE_LABELS[name]}
      >
        <Icon size={18} />
        <span>
          {mobile && name === "Terminal" ? "Charts" : PAGE_LABELS[name]}
        </span>
        {name === "Alerts" && triggered && <i className="alert-dot" />}
      </button>
    );
  };
  return (
    <>
      <nav className="desktop-nav" aria-label="Main navigation">
        {NAV_GROUPS.map((group) => (
          <div className="nav-group" key={group.label}>
            <span className="nav-group-label">{group.label}</span>
            {group.pages.map((name) => item(name))}
          </div>
        ))}
        <div className="nav-bottom">
          <ThemeToggle />
          <div className="nav-refresh">
            <span>Auto-refresh · 5 min</span>
            <button
              className="icon-button"
              aria-label="Refresh market data"
              onClick={onRefresh}
            >
              <RefreshCw size={16} className={loading ? "spin" : ""} />
            </button>
          </div>
        </div>
      </nav>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {primary.map((name) => item(name, true))}
        <button
          className={!primary.includes(page) ? "active" : ""}
          aria-expanded={open}
          aria-controls="workspace-menu"
          onClick={() => setOpen(true)}
        >
          <MoreHorizontal size={19} />
          <span>More</span>
        </button>
      </nav>
      <dialog
        id="workspace-menu"
        ref={dialog}
        className="navigation-dialog dialog"
        aria-labelledby="workspace-menu-title"
        onCancel={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialog.current) setOpen(false);
        }}
      >
        <div className="navigation-dialog-head">
          <h2 id="workspace-menu-title">All workspaces</h2>
          <button
            className="icon-button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        {NAV_GROUPS.map((group) => (
          <div className="nav-group" key={group.label}>
            <span className="nav-group-label">{group.label}</span>
            <div className="navigation-menu-grid">
              {group.pages.map((name) => item(name))}
            </div>
          </div>
        ))}
        <button className="button navigation-menu-refresh" onClick={onRefresh}>
          <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
          market data
        </button>
        <div className="navigation-menu-theme">
          <ThemeToggle />
        </div>
      </dialog>
    </>
  );
}
