import { useEffect, useId } from 'react';
import { growthEvent } from './growth.js';

const samples = {
  Fundamentals: {
    title: 'Business performance and valuation',
    context: 'Example company · annual financials',
    values: [['Sales growth · 5-year CAGR', '+12.4%'], ['Return on equity · latest year', '18.6%'], ['Price / earnings · trailing', '24.0×']],
    note: 'Compare the business’s growth and returns with the price investors are paying. Available reports include financial statements; full scoring depends on data coverage.',
  },
  Markets: {
    title: 'Market participation',
    context: 'Example trading session · Nifty 500 breadth',
    values: [['Advancing / declining', '310 / 190'], ['Above 200-day average', '64%'], ['India VIX', '14.2']],
    note: 'Check whether gains extend across stocks, then compare sector leadership and global cues before judging an individual setup.',
  },
  Forecast: {
    title: '10-session range and trend what-if',
    context: 'Example stock · adjusted daily history',
    values: [['Likely range · 8 in 10', '₹940–1,060'], ['Centre', '₹1,000'], ['If the trend continued', '₹1,045']],
    note: 'The range is what the tested model expects. The trend figure is a what-if: where the price would be if the last 30 sessions’ slope carried on.',
  },
  Analytics: {
    title: 'Historical risk',
    context: 'Example stock · 1-year history',
    values: [['Maximum drawdown', '−18.4%'], ['Annualized volatility', '24.6%'], ['Beta vs. Nifty 50', '1.12']],
    note: 'Compare how far a stock has fallen from a peak, how much it moves and how sensitive it has been to the index.',
  },
  FnO: {
    title: 'Nifty 50 positioning',
    context: 'Example weekly expiry',
    values: [['Put/call open interest', '1.08'], ['Put OI support', '24,500'], ['Call OI resistance', '25,000']],
    note: 'Compare concentration at different strikes. Open interest shows positioning, not where the index will go.',
  },
  Flows: {
    title: 'Institutional cash activity',
    context: 'Example trading session',
    values: [['FII / FPI net', '−₹780 cr'], ['DII net', '+₹1,120 cr'], ['Combined net', '+₹340 cr']],
    note: 'See whether foreign and domestic institutions were net buyers or sellers, then review large trades separately.',
  },
  Breakouts: {
    title: 'Breakout evidence',
    context: 'Example stock · 20-session high',
    values: [['Close vs. breakout level', '+2.3%'], ['Volume vs. 20-day average', '1.8×'], ['Return vs. Nifty 50 · 3 months', '+6.2 pp']],
    note: 'The stock cleared its prior high on higher volume than usual. That gives you a reason to look closer at the setup and its risks.',
  },
};

// Every chart below is drawn from made-up figures that match the sample values above.
const W = 320, H = 132;
const n = value => Number(value.toFixed(1));
const scale = (d0, d1, r0, r1) => value => r0 + (r1 - r0) * (value - d0) / (d1 - d0);
const spread = (values, x0, x1, y) => values.map((value, i) => [n(x0 + (x1 - x0) * i / (values.length - 1)), n(y(value))]);
// A smooth path through the points, so a sample reads as a chart rather than a zig-zag.
function curve(points) {
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i - 1] || points[i], b = points[i], c = points[i + 1], e = points[i + 2] || c;
    d += ` C${n(b[0] + (c[0] - a[0]) / 6)} ${n(b[1] + (c[1] - a[1]) / 6)} ${n(c[0] - (e[0] - b[0]) / 6)} ${n(c[1] - (e[1] - b[1]) / 6)} ${c[0]} ${c[1]}`;
  }
  return d;
}
const closed = (points, base) => `${curve(points)} L${points.at(-1)[0]} ${base} L${points[0][0]} ${base} Z`;
// Columns keep a square foot on the baseline and a rounded data-end.
function column(x, y0, y1, width, r = 2) {
  const up = y1 < y0, top = up ? y1 : y0, bottom = up ? y0 : y1;
  if (bottom - top < r) return `M${x} ${top} H${n(x + width)} V${bottom} H${x} Z`;
  return up ? `M${x} ${y0} V${n(y1 + r)} Q${x} ${y1} ${n(x + r)} ${y1} H${n(x + width - r)} Q${n(x + width)} ${y1} ${n(x + width)} ${n(y1 + r)} V${y0} Z`
    : `M${x} ${y0} V${n(y1 - r)} Q${x} ${y1} ${n(x + r)} ${y1} H${n(x + width - r)} Q${n(x + width)} ${y1} ${n(x + width)} ${n(y1 - r)} V${y0} Z`;
}
const Wash = ({ id, tone = 'accent' }) => <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" className={`pv-wash-${tone}`} /><stop offset="1" className="pv-wash-end" /></linearGradient></defs>;
const Tag = ({ x, y, width, children, anchor = 'start' }) => <g className="pv-tag pv-fade">
  <rect x={anchor === 'end' ? x - width : x} y={y - 9} width={width} height="14" rx="7" />
  <text x={anchor === 'end' ? x - width / 2 : x + width / 2} y={y + 1} textAnchor="middle" className="pv-t-strong">{children}</text>
</g>;

function BreakoutChart({ id }) {
  const closes = [94, 95, 93.6, 96, 95.2, 97, 96.1, 98, 97, 96.6, 98.2, 97.6, 99, 98.1, 99.4, 98.6, 99.2, 99.6, 99, 99.8, 99.5, 101.4, 102, 102.3];
  const volumes = [10, 9, 11, 10, 8, 10, 9, 11, 10, 9, 10, 11, 9, 10, 11, 10, 9, 10, 11, 10, 12, 17, 19, 18];
  const y = scale(92.5, 103.5, 82, 16), points = spread(closes, 14, 300, y), level = n(y(100));
  const [lastX, lastY] = points.at(-1);
  return <>
    <Wash id={id} />
    <line className="pv-level" x1="14" x2="306" y1={level} y2={level} />
    <text className="pv-t" x="14" y={level - 5}>20-session high</text>
    <path className="pv-fade" d={closed(points, 88)} fill={`url(#${id})`} />
    <path className="pv-line pv-draw" pathLength="1" d={curve(points)} />
    {volumes.map((volume, i) => <path key={i} className={`pv-bar pv-rise${i > 20 ? ' pv-bar-accent' : ''}`} style={{ animationDelay: `${i * 18}ms` }} d={column(n(14 + i * 12.1), 120, n(120 - volume * 1.35), 10)} />)}
    <text className="pv-t" x="14" y="100">Volume</text>
    <circle className="pv-dot pv-fade" cx={lastX} cy={lastY} r="4.5" />
    <Tag x={306} y={13} width={44} anchor="end">+2.3%</Tag>
  </>;
}

function ForecastChart({ id }) {
  const history = [948, 955, 951, 962, 958, 969, 964, 975, 971, 980, 976, 987, 983, 992, 989, 996, 993, 1000];
  const y = scale(925, 1075, 112, 18), past = spread(history, 14, 214, y);
  const [nowX, nowY] = past.at(-1), endX = 296, endY = n(y(1045));
  // The cone is the likely range around an unchanged centre; the dashed line is the trend what-if.
  return <>
    <Wash id={id} />
    <line className="pv-axis" x1={nowX} x2={nowX} y1="12" y2="128" />
    <text className="pv-t" x={nowX - 6} y="125" textAnchor="end">History</text>
    <text className="pv-t" x={nowX + 6} y="125">Next 10 sessions</text>
    <path className="pv-fade" d={`M${nowX} ${nowY} L${endX} ${n(y(1060))} L${endX} ${n(y(940))} Z`} fill={`url(#${id})`} />
    <path className="pv-line pv-line-quiet pv-draw" pathLength="1" d={curve(past)} />
    <line className="pv-level pv-fade" x1={nowX} y1={nowY} x2={endX} y2={nowY} />
    <line className="pv-line pv-dash pv-fade" x1={nowX} y1={nowY} x2={endX} y2={endY} />
    <circle className="pv-dot pv-dot-quiet pv-fade" cx={nowX} cy={nowY} r="4" />
    <circle className="pv-dot pv-fade" cx={endX} cy={endY} r="4.5" />
    <text className="pv-t pv-fade" x={endX} y={n(y(1060)) - 4} textAnchor="end">₹1,060</text>
    <text className="pv-t pv-fade" x={endX} y={n(y(940)) + 11} textAnchor="end">₹940</text>
    <Tag x={nowX - 8} y={nowY + 22} width={46} anchor="end">₹1,000</Tag>
    <Tag x={endX - 12} y={endY + 4} width={74} anchor="end">What-if ₹1,045</Tag>
  </>;
}

function DrawdownChart({ id }) {
  const falls = [0, -2, -1, -4, -7, -5, -9, -12, -10, -14, -18.4, -15, -11, -12, -8, -6, -9, -5, -3, -4, -2, -1, -3, -1.5];
  const y = scale(0, -20, 26, 112), points = spread(falls, 30, 306, y), [lowX, lowY] = points[10];
  return <>
    <Wash id={id} tone="down" />
    {[0, -10, -20].map(tick => <g key={tick}>
      <line className={tick ? 'pv-grid' : 'pv-axis'} x1="30" x2="306" y1={n(y(tick))} y2={n(y(tick))} />
      <text className="pv-t" x="26" y={n(y(tick)) + 3} textAnchor="end">{tick ? `−${-tick}` : '0'}</text>
    </g>)}
    <text className="pv-t" x="306" y="18" textAnchor="end">Fall from the last peak, %</text>
    <path className="pv-fade" d={closed(points, n(y(0)))} fill={`url(#${id})`} />
    <path className="pv-line pv-line-down pv-draw" pathLength="1" d={curve(points)} />
    <circle className="pv-dot pv-dot-down pv-fade" cx={lowX} cy={lowY} r="4.5" />
    <Tag x={lowX + 9} y={lowY - 1} width={50}>−18.4%</Tag>
  </>;
}

function OptionsChart() {
  const calls = [8, 10, 14, 18, 26, 34, 46, 72, 40, 30], puts = [30, 38, 70, 52, 44, 36, 24, 16, 10, 6];
  // Calls rise from the upper axis and puts hang from the lower one; the strikes sit between them.
  const top = 58, bottom = 76, x = i => n(22 + i * 28.6), size = value => n(value * 0.56);
  return <>
    <line className="pv-axis" x1="14" x2="306" y1={top} y2={top} />
    <line className="pv-axis" x1="14" x2="306" y1={bottom} y2={bottom} />
    {calls.map((value, i) => <path key={`c${i}`} className={`pv-bar pv-rise${i === 7 ? ' pv-bar-accent' : ''}`} style={{ animationDelay: `${i * 30}ms` }} d={column(x(i), top, n(top - size(value)), 18, 3)} />)}
    {puts.map((value, i) => <path key={`p${i}`} className={`pv-bar pv-drop${i === 2 ? ' pv-bar-accent' : ''}`} style={{ animationDelay: `${i * 30}ms` }} d={column(x(i), bottom, n(bottom + size(value)), 18, 3)} />)}
    <text className="pv-t" x="14" y="20">Call open interest</text>
    <text className="pv-t" x="306" y="124" textAnchor="end">Put open interest</text>
    <text className="pv-t" x="14" y="70">Strike</text>
    <text className="pv-t-strong" x={n(x(2) + 9)} y="70.5" textAnchor="middle">24,500</text>
    <text className="pv-t-strong" x={n(x(7) + 9)} y="70.5" textAnchor="middle">25,000</text>
    <Tag x={n(x(7) - 6)} y={n(top - size(72) + 9)} width={64} anchor="end">Resistance</Tag>
    <Tag x={n(x(2) + 24)} y={n(bottom + size(70) + 3)} width={50}>Support</Tag>
  </>;
}

function FlowsChart() {
  const net = [-420, 310, -150, 620, -880, -240, 450, 180, -560, 720, -90, 340];
  const zero = 70, y = scale(0, 900, zero, 22);
  return <>
    <line className="pv-axis" x1="14" x2="306" y1={zero} y2={zero} />
    <text className="pv-t" x="14" y="20">Net buying, ₹ cr</text>
    <text className="pv-t" x="14" y="124">Net selling</text>
    {net.map((value, i) => <path key={i} className={`${value > 0 ? 'pv-rise pv-up' : 'pv-drop pv-down'}${i < net.length - 1 ? ' pv-dim' : ''}`} style={{ animationDelay: `${i * 30}ms` }}
      d={column(n(18 + i * 24.2), zero + (value > 0 ? -1 : 1), n(y(value)), 18, 3)} />)}
    <line className="pv-leader pv-fade" x1="293.2" x2="293.2" y1="21" y2={n(y(340)) - 3} />
    <Tag x={302.2} y={14} width={62} anchor="end">+₹340 cr</Tag>
  </>;
}

function BreadthChart() {
  const sectors = [1.8, 1.4, 1.1, 0.9, 0.6, 0.4, 0.3, -0.2, -0.3, -0.6, -0.9];
  const zero = 98, y = scale(0, 2, zero, 66), split = n(14 + 292 * 0.62);
  return <>
    <text className="pv-t-strong" x="14" y="22">310 advancing</text>
    <text className="pv-t-strong" x="306" y="22" textAnchor="end">190 declining</text>
    <rect className="pv-up pv-grow" x="14" y="29" width={n(split - 15)} height="10" rx="5" />
    <rect className="pv-down pv-fade" x={n(split + 1)} y="29" width={n(306 - split - 1)} height="10" rx="5" />
    <text className="pv-t" x="14" y="58">Sector moves, strongest to weakest</text>
    <line className="pv-axis" x1="14" x2="306" y1={zero} y2={zero} />
    {sectors.map((value, i) => <path key={i} className={value > 0 ? 'pv-rise pv-up' : 'pv-drop pv-down'} style={{ animationDelay: `${i * 30}ms` }}
      d={column(n(18 + i * 26.4), zero + (value > 0 ? -1 : 1), n(y(value)), 20, 3)} />)}
    <text className="pv-t" x="18" y="124">IT +1.8%</text>
    <text className="pv-t" x="302" y="124" textAnchor="end">Media −0.9%</text>
  </>;
}

function SalesChart() {
  const sales = [100, 112.4, 126.3, 142, 159.6, 179.4], base = 108, y = scale(0, 190, base, 24);
  return <>
    <line className="pv-axis" x1="14" x2="306" y1={base} y2={base} />
    <text className="pv-t" x="14" y="20">Sales, indexed to 100</text>
    {sales.map((value, i) => <g key={i}>
      <path className={`pv-bar pv-rise${i === sales.length - 1 ? ' pv-bar-accent' : ' pv-bar-soft'}`} style={{ animationDelay: `${i * 50}ms` }} d={column(n(30 + i * 46), base, n(y(value)), 24, 4)} />
      <text className="pv-t" x={n(42 + i * 46)} y="122" textAnchor="middle">FY{20 + i}</text>
    </g>)}
    <Tag x={286} y={n(y(179.4)) - 8} width={88} anchor="end">+12.4% a year</Tag>
  </>;
}

const charts = {
  Breakouts: [BreakoutChart, 'A stock’s close moving above its 20-session high while volume rises.'],
  Forecast: [ForecastChart, 'A price history followed by the likely range over the next ten sessions, from 940 to 1,060 around 1,000, with a dashed trend what-if rising to 1,045.'],
  Analytics: [DrawdownChart, 'How far a stock fell from its last peak over one year, reaching 18.4%.'],
  FnO: [OptionsChart, 'Open interest by strike, with calls peaking at 25,000 and puts at 24,500.'],
  Flows: [FlowsChart, 'Combined institutional net buying and selling across twelve sessions.'],
  Markets: [BreadthChart, '310 stocks advancing against 190 declining, with sector moves ranked.'],
  Fundamentals: [SalesChart, 'Sales rising about 12.4% a year across six financial years.'],
};

export default function ProWorkspacePreview({ page }) {
  const sample = samples[page];
  const id = `pv${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  useEffect(() => {
    if (sample) growthEvent('pro_preview_viewed', { page, source: 'sample' });
  }, [page, sample]);
  if (!sample) return null;
  const [Chart, summary] = charts[page];
  return <figure className="pro-preview pro-workspace-preview">
    <figcaption>
      <span className="eyebrow pv-badge"><i aria-hidden="true" />SAMPLE · ILLUSTRATIVE DATA</span>
      <div className="pro-preview-heading"><strong>{sample.title}</strong><span>{sample.context}</span></div>
    </figcaption>
    <div className="pv-stage">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Illustrative chart. ${summary}`}><Chart id={id} /></svg>
    </div>
    <dl>{sample.values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={[/^\+/.test(value) ? 'up' : /^−/.test(value) ? 'down' : '', value.length > 8 ? 'wide' : ''].join(' ').trim() || undefined}>{value}</dd></div>)}</dl>
    <p>{sample.note}</p>
  </figure>;
}
