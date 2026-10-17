import { useEffect, useRef, useState } from 'react';

export default function DeferredSection({ children, className = '', label, minHeight = 400, onReveal }) {
  const host = useRef(null);
  const [ready, setReady] = useState(false);
  const reveal = useRef(onReveal);
  reveal.current = onReveal;
  useEffect(() => {
    if (!('IntersectionObserver' in window)) { setReady(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setReady(true);
        observer.disconnect();
      }
    }, { rootMargin: '160px 0px' });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (ready) reveal.current?.(); }, [ready]);
  return <div ref={host} className={className} style={{ minHeight: ready ? undefined : minHeight }}>
    {ready ? children : <div className="deferred-placeholder" aria-hidden="true">{label}</div>}
  </div>;
}
