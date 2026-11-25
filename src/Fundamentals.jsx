import { useEffect, useRef } from 'react';
import './fundamentals.css';

// Keep Lodestar's own document isolated from Alphanova's global styles.
export default function Fundamentals({ symbol, refresh, onSelect }) {
  const frame = useRef(null), current = useRef(symbol), initial = useRef(symbol);
  const select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => {
    const receive = event => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== 'lodestar:select') return;
      const next = event.data.symbol;
      if (typeof next !== 'string' || !/^[A-Z0-9][A-Z0-9.&_-]{0,24}$/.test(next)) return;
      current.current = next;
      select.current(next);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  const priorRefresh = useRef(refresh);
  useEffect(() => {
    if (current.current !== symbol || priorRefresh.current !== refresh) {
      current.current = symbol;
      priorRefresh.current = refresh;
      frame.current?.contentWindow?.postMessage({ type: 'alphanova:select', symbol }, location.origin);
    }
  }, [symbol, refresh]);
  return <section className="lodestar-host" aria-label="Fundamentals">
    <iframe ref={frame} title="Lodestar fundamentals" src={`/lodestar/index.html?t=${encodeURIComponent(initial.current)}`}
      sandbox="allow-scripts allow-same-origin" onLoad={() => {
        if (current.current !== initial.current) frame.current?.contentWindow?.postMessage({ type: 'alphanova:select', symbol: current.current }, location.origin);
      }} />
  </section>;
}
