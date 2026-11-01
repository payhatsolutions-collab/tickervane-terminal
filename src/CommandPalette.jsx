import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Command, CornerDownLeft, Search, Star, X } from 'lucide-react';
import { commandGroups } from './commandSearch.js';
import { short } from './data.js';

export default function CommandPalette({ query, onQuery, instruments, recent, catalog, watch, onChoose, onPage, onToggle, onClose, searchRef, includePages }) {
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const groups = useMemo(() => commandGroups({ query, instruments, recent, catalog, includePages }), [query, instruments, recent, catalog, includePages]);
  const entries = groups.flatMap(group => group.items);
  const selected = entries[Math.min(active, Math.max(0, entries.length - 1))];
  useEffect(() => {
    if (selected) listRef.current?.querySelector(`[id="command-${selected.id}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected?.id]);
  const select = entry => entry.kind === 'page' ? onPage(entry.page) : onChoose(entry.symbol);
  return <div className="command-palette">
    <div className="command-input">
      <Search size={21} />
      <input ref={searchRef} type="text" role="combobox" aria-label="Search symbols or commands" aria-expanded="true"
        aria-controls="command-results" aria-autocomplete="list" aria-activedescendant={selected ? `command-${selected.id}` : undefined}
        placeholder={includePages ? 'Search anything in your workspace…' : 'Search a symbol or company…'}
        autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" value={query}
        onChange={event => { setActive(0); onQuery(event.target.value); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActive(index => entries.length ? (Math.min(index, entries.length - 1) + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length : 0);
          } else if (event.key === 'Enter' && selected) { event.preventDefault(); select(selected); }
        }} />
      <button className="icon-button" aria-label="Close search" onClick={onClose}><X size={19} /></button>
    </div>
    <div className="command-context"><Command size={13} /><span>{includePages ? 'Your entire workspace, one search away' : 'Choose an instrument for this view'}</span><kbd>ESC</kbd></div>
    <div className="command-results" id="command-results" role="listbox" aria-label="Search results" ref={listRef}>
      {groups.map(group => <div role="group" aria-label={group.label} key={group.label}>
        <div className="command-group-label" aria-hidden="true">{group.label}</div>
        {group.items.map(entry => <div className={`command-row ${selected?.id === entry.id ? 'is-selected' : ''}`} role="presentation" key={entry.id}>
          <button role="option" aria-selected={selected?.id === entry.id} id={`command-${entry.id}`} tabIndex={-1}
            onClick={() => select(entry)} onMouseEnter={() => setActive(entries.findIndex(item => item.id === entry.id))}>
            <span className={`command-symbol ${entry.kind === 'page' ? 'is-page' : ''}`}>{entry.kind === 'page' ? <Command size={17} /> : short(entry.symbol).slice(0, 2)}</span>
            <span className="command-result-copy"><strong>{entry.kind === 'page' ? entry.name : short(entry.symbol)}</strong><small>{entry.kind === 'page' ? 'Go to workspace' : entry.name}</small></span>
            <span className="command-result-type">{entry.kind === 'page' ? <ArrowUpRight size={15} /> : entry.market}</span>
          </button>
          {entry.kind === 'instrument' && <button className={`icon-button ${watch.includes(entry.symbol) ? 'starred' : ''}`} aria-label={`${watch.includes(entry.symbol) ? 'Remove' : 'Add'} ${short(entry.symbol)} ${watch.includes(entry.symbol) ? 'from' : 'to'} watchlist`} onClick={() => onToggle(entry.symbol)}><Star size={16} fill={watch.includes(entry.symbol) ? 'currentColor' : 'none'} /></button>}
        </div>)}
      </div>)}
      {!entries.length && <div className="command-empty"><Search size={28} /><h3>No results for “{query}”</h3><p>Try a company, symbol, or workspace like “Screener”.</p></div>}
    </div>
    <div className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> to navigate <kbd><CornerDownLeft size={11} /></kbd> to open</span><span>ALPHA NOVA</span></div>
  </div>;
}
