import { useEffect, useRef, useState } from 'react';

export function useMobileLayout() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setMobile(query.matches);
    query.addEventListener('change', update);
    update();
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}

// Observe the displayed rows, so hidden layouts and offscreen stocks do not fetch prices.
export function useVisibleQuoteSymbols(symbols, layoutKey = '') {
  const host = useRef(null);
  const [visible, setVisible] = useState([]);
  const key = symbols.join(',');
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    if (!('IntersectionObserver' in window)) { setVisible(key ? key.split(',') : []); return; }
    const active = new Set();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const symbol = entry.target.dataset.quoteSymbol;
        if (entry.isIntersecting) active.add(symbol);
        else active.delete(symbol);
      }
      const next = [...active].sort();
      setVisible(previous => previous.join(',') === next.join(',') ? previous : next);
    }, { rootMargin: '120px 0px' });
    setVisible([]);
    root.querySelectorAll('[data-quote-symbol]').forEach(row => observer.observe(row));
    return () => observer.disconnect();
  }, [key, layoutKey]);
  return { host, symbols: visible.filter(symbol => symbols.includes(symbol)) };
}
