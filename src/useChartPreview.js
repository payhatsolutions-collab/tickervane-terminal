import { useEffect, useRef, useState } from 'react';
import { loadDailyChart } from './screenChartFeed.js';

// Share a single daily feed between a row's signal and candlestick preview.
export function useChartPreview(symbol, refresh = 0) {
  const host = useRef(), lastRefresh = useRef(refresh);
  const [visible, setVisible] = useState(false);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ symbol, data: null, loading: true, error: null });
  useEffect(() => {
    if (!host.current) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '160px' });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [symbol]);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const force = refresh !== lastRefresh.current || retry > 0;
    lastRefresh.current = refresh;
    setState(previous => ({ symbol, data: previous.symbol === symbol ? previous.data : null, loading: true, error: null }));
    loadDailyChart(symbol, force)
      .then(data => { if (alive) setState({ symbol, data, loading: false, error: null }); })
      .catch(error => { if (alive) setState(previous => ({ ...previous, loading: false, error: error.message })); });
    return () => { alive = false; };
  }, [symbol, visible, refresh, retry]);
  const feed = state.symbol === symbol ? state : { data: null, loading: true, error: null };
  return { host, feed, onRetry: () => setRetry(n => n + 1) };
}
