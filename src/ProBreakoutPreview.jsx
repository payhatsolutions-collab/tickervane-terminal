import { useEffect, useRef } from 'react';
import { useFeed } from './hooks.js';
import { directory, short } from './data.js';
import { growthEvent } from './growth.js';

export default function ProBreakoutPreview({ symbol, refresh }) {
  const { data, loading } = useFeed('/api/market?op=screen', refresh);
  const row = data?.rows?.find(item => `${item.symbol}.NS` === symbol);
  const relative = row?.rs3m;
  const hasEvidence = !!data?.date && Number.isFinite(relative);
  const recorded = useRef(null);
  useEffect(() => {
    if (!hasEvidence || recorded.current === symbol) return;
    recorded.current = symbol;
    growthEvent('pro_preview_viewed', { page: 'Breakouts' });
  }, [hasEvidence, symbol]);

  return <div className="pro-preview">
    <div className="pro-preview-heading">
      <strong>{row?.name || directory.get(symbol)?.name || short(symbol)}</strong>
      <span>{short(symbol)}</span>
    </div>
    {hasEvidence ? <>
      <p>
        {relative === 0 ? 'Matched the Nifty 50' : <>{relative > 0 ? 'Outperformed' : 'Trailed'} the Nifty 50 by <strong>{Math.abs(relative).toFixed(1)} percentage points</strong></>} over three months.
      </p>
      <small>Relative strength · NSE snapshot · <time dateTime={data.date}>{data.date}</time></small>
    </> : <p role="status">{loading ? 'Loading the session preview…' : 'Relative strength is unavailable for this stock in the latest snapshot.'}</p>}
  </div>;
}
