import { PAGES, PAGE_LABELS } from './navigation.js';

const aliases = {
  Today: 'home dashboard overview', Terminal: 'chart technical analysis plan',
  Forecast: 'forecast scenarios', Markets: 'market breadth sectors indices',
  Screener: 'screen filters scan stocks', Delivery: 'delivery accumulation volume',
  FnO: 'options derivatives futures nifty', Flows: 'institutional fii dii flows',
  News: 'news headlines', Watchlist: 'watchlist saved favorites',
  Portfolio: 'holdings positions portfolio backup restore',
  Journal: 'journal trades history', Alerts: 'alerts notifications price',
};

export function commandGroups({ query, instruments, recent = [], catalog, includePages = true }) {
  const needle = query.trim().toLowerCase();
  const pages = includePages ? (needle ? PAGES.filter(page =>
    `${PAGE_LABELS[page]} ${aliases[page]}`.toLowerCase().includes(needle),
  ) : ['Today', 'Watchlist', 'Screener', 'Portfolio']) : [];
  const recentItems = !needle ? [...new Set(recent)].map(symbol => catalog.get(symbol)).filter(Boolean).slice(0, 4) : [];
  const stocks = instruments.filter(item => !recentItems.some(recent => recent.symbol === item.symbol)).slice(0, needle ? 12 : 6);
  return [
    { label: 'Recently viewed', items: recentItems.map(item => ({ ...item, kind: 'instrument', id: `recent-${item.symbol}` })) },
    { label: 'Workspaces', items: pages.map(page => ({ kind: 'page', id: `page-${page}`, page, name: PAGE_LABELS[page] })) },
    { label: needle ? 'Instruments' : 'Explore instruments', items: stocks.map(item => ({ ...item, kind: 'instrument', id: `stock-${item.symbol}` })) },
  ].filter(group => group.items.length);
}
