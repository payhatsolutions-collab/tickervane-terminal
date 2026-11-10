import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Bell,
  BookOpen,
  Globe2,
  History,
  Landmark,
  Layers,
  LayoutDashboard,
  MoreHorizontal,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  RefreshCw,
  SlidersHorizontal,
  Star,
  Target,
  Wallet,
  X,
} from "lucide-react";
import { NAV_GROUPS, PAGE_LABELS, workspaceURL } from "./navigation.js";
import ThemeToggle from "./ThemeToggle.jsx";
import InstallApp from "./InstallApp.jsx";

const icons = {
  Today: Target,
  Terminal: LayoutDashboard,
  Forecast: Activity,
  Markets: Globe2,
  Screener: SlidersHorizontal,
  Fundamentals: BookOpen,
  Breakouts: Radar,
  Analytics: Activity,
  Delivery: Radar,
  FnO: Layers,
  Flows: Landmark,
  News: Newspaper,
  Portfolio: Wallet,
  Watchlist: Star,
  Journal: History,
  Alerts: Bell,
};
const primary = ["Today", "Delivery", "Markets", "Fundamentals"];

export default function Navigation({
  mobile,
  page,
  collapsed,
  onToggleCollapsed,
  registration,
  onPage,
  triggered,
  loading,
  onRefresh,
  watchCount = 0,
  alertCount = 0,
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
      <a
        href={workspaceURL(name)}
        key={name}
        aria-label={PAGE_LABELS[name]}
        aria-current={page === name ? "page" : undefined}
        className={page === name ? "active" : ""}
        onClick={(event) => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          choose(name);
        }}
        title={PAGE_LABELS[name]}
      >
        <Icon size={18} />
        <span>
          {mobile && name === "Delivery" ? "Delivery" : PAGE_LABELS[name]}
        </span>
        {!mobile && name === "Watchlist" && watchCount > 0 && <b className="nav-count">{watchCount}</b>}
        {!mobile && name === "Alerts" && alertCount > 0 && <b className="nav-count">{alertCount}</b>}
        {name === "Alerts" && triggered && <i className="alert-dot" />}
      </a>
    );
  };
  return (
    <>
      <nav id="desktop-navigation" className="desktop-nav" aria-label="Main navigation">
        <div className="nav-workspace"><span className="workspace-avatar">AN</span><div><strong>Personal workspace</strong><small>Saved on this device</small></div></div>
        <button className="nav-collapse" onClick={onToggleCollapsed} aria-expanded={!collapsed} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} title={collapsed ? "Expand navigation" : "Collapse navigation"}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}<span>Your workspace</span></button>
        {NAV_GROUPS.map((group) => (
          <div className="nav-group" key={group.label}>
            <span className="nav-group-label">{group.label}</span>
            {group.pages.map((name) => item(name))}
          </div>
        ))}
        <div className="nav-bottom">
          {!mobile && <InstallApp />}
          <ThemeToggle />
          <div className="nav-refresh">
            <span>Quotes refresh · 30 sec</span>
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
          <div><span className="eyebrow">EXPLORE ALPHA NOVA</span><h2 id="workspace-menu-title">Your workspace</h2></div>
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
        {mobile && <InstallApp />}
        <button className="button navigation-menu-refresh" onClick={onRefresh}>
          <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
          market data
        </button>
        <div className="navigation-registration">{registration}</div>
        <div className="navigation-menu-theme">
          <ThemeToggle />
        </div>
      </dialog>
    </>
  );
}
