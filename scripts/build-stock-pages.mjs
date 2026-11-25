import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { PRESETS, runScreen } from '../src/screens.js';
import { publicStockSymbols, stockSources } from '../src/stockCatalog.js';
import { SITE_ORIGIN } from '../src/seo.js';
const { screen, delivery } = JSON.parse(await readFile('content/stock-snapshot.json', 'utf8'));
const candles = JSON.parse(await readFile('content/nse-history.json', 'utf8'));
const deliveries = new Map(delivery.rows.map(row => [row.symbol, row]));
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = value => Number.isFinite(value) ? value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : 'Unavailable';
const percent = value => Number.isFinite(value) ? `${number(value)}%` : 'Unavailable';
const research = JSON.parse(await readFile('content/stock-research.json', 'utf8'));
const technicals = new Map(screen.rows.map(row => [row.symbol, row]));
const prices = research.cash.history;
const futures = new Map(research.futures?.rows.map(row => [row.symbol, row]));
const trades = Map.groupBy(research.trades?.rows ?? [], row => row.symbol);
const stocks = publicStockSymbols(research.names, screen.rows, delivery.rows);
const stockPath = symbol => '/stocks/' + encodeURIComponent(symbol);
const nameOf = symbol => technicals.get(symbol)?.name || research.names[symbol] || deliveries.get(symbol)?.name || symbol;
const groupOf = symbol => /^\d/.test(symbol) ? '0-9' : symbol[0];
const groups = Map.groupBy(stocks, groupOf);
const groupPath = group => '/stocks/by-symbol/' + group.toLowerCase() + '/';
const money = value => Number.isFinite(value) ? '₹' + number(value) : 'Unavailable';
const sourceDate = date => `<time datetime="${esc(date)}">${esc(date)}</time>`;
const metrics = pairs => '<dl class="stock-metrics">' + pairs.map(([key, value]) =>
  `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('') + '</dl>';
const latestDate = (...dates) => dates.filter(Boolean).sort().at(-1);
const sitemapEntries = [];
const directoryDate = latestDate(screen.date, research.cash.date);

await Promise.all(['dist/stock-pages', 'dist/stocks', 'dist/share'].map(path => mkdir(path, { recursive: true })));
function preview(title, subtitle, metrics, values = []) {
  const min = Math.min(...values), span = Math.max(...values) - min || 1;
  const points = values.map((v, i) => `${80 + i / Math.max(1, values.length - 1) * 1040},${540 - (v - min) / span * 115}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#0b1016"/><rect x="0" width="10" height="630" fill="#7ce6ba"/><text x="80" y="78" fill="#7ce6ba" font-family="sans-serif" font-size="24" letter-spacing="5">ALPHA NOVA / NSE RESEARCH</text><text x="80" y="175" fill="#f2f6fa" font-family="sans-serif" font-size="56" font-weight="bold">${esc(title.slice(0, 29))}</text><text x="80" y="223" fill="#9daebf" font-family="sans-serif" font-size="25">${esc(subtitle.slice(0, 70))}</text>${metrics.map(([label, value], i) => `<text x="${80 + i * 355}" y="315" fill="#9daebf" font-family="sans-serif" font-size="20">${esc(label)}</text><text x="${80 + i * 355}" y="368" fill="#f2f6fa" font-family="sans-serif" font-size="40">${esc(value)}</text>`).join('')}<polyline points="${points}" fill="none" stroke="#7ce6ba" stroke-width="4"/><text x="80" y="595" fill="#9daebf" font-family="sans-serif" font-size="19">alphanova48.in · Dated market snapshots · Research, not advice</text></svg>`;
}
await sharp(Buffer.from(preview('NSE stock research', 'Share prices, delivery history and company fundamentals', [
  ['DIRECTORY', String(stocks.length)], ['CASH SESSION', research.cash.date], ['ACCESS', 'Public'],
]))).png({ palette: true }).toFile('dist/share/overview.png');

function page({ path, title, description, body, crumbs, image = '/share/overview.png', modified, index = true, company }) {
  const url = SITE_ORIGIN + path;
  const breadcrumb = [...crumbs, [company?.name || title.split(' | ')[0], path]];
  const graph = [
    { '@type': company ? 'WebPage' : 'CollectionPage', '@id': url + '#webpage', url, name: title, description,
      dateModified: modified, about: company, breadcrumb: { '@id': url + '#breadcrumbs' },
      publisher: { '@type': 'Organization', name: 'Alpha Nova', url: SITE_ORIGIN } },
    { '@type': 'BreadcrumbList', '@id': url + '#breadcrumbs', itemListElement: breadcrumb.map(([name, part], i) =>
      ({ '@type': 'ListItem', position: i + 1, name, item: SITE_ORIGIN + part })) },
  ];
  if (index) sitemapEntries.push({ path, modified });
  return `<!doctype html>
<html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}"><meta name="robots" content="${index ? 'index,follow,max-image-preview:large' : 'noindex,follow'}">
<link rel="icon" href="/icon-192.png"><link rel="stylesheet" href="/seo.css">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(SITE_ORIGIN + image)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:image" content="${esc(SITE_ORIGIN + image)}">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replaceAll('<', '\\u003c')}</script></head>
<body class="seo-page stock-research"><a class="seo-skip" href="#research">Skip to research</a>
<header><nav class="seo-nav"><a class="seo-brand" href="/">Alpha Nova</a><a href="/stocks/">Stock directory</a><a href="/screener">Screener</a></nav></header>
<main id="research"><nav aria-label="Breadcrumb" class="seo-breadcrumb">${crumbs.map(([label, part]) =>
    `<a href="${esc(part)}">${esc(label)}</a>`).join(' / ')} / ${esc(company?.tickerSymbol.split(':')[1] || breadcrumb.at(-1)[0])}</nav>
${body}</main><footer><a href="/about.html">Alpha Nova research and sources</a> · <a href="/methodology.html">Methodology</a></footer></body></html>`;
}

function deliveryHistory(symbol, radar) {
  const rows = new Map();
  const dates = delivery.sessions.slice(0, 10).toReversed();
  radar?.history?.forEach((value, i) => {
    if (dates[i]) rows.set(dates[i], { date: dates[i], delivered: value });
  });
  for (const [date, close, delivered, qty, volume, previous] of prices[symbol] ?? []) {
    rows.set(date, { date, close, delivered, qty, volume, previous });
  }
  if (radar && !rows.get(delivery.date)?.close) {
    rows.set(delivery.date, { date: delivery.date, close: radar.close, delivered: radar.delivPct, qty: radar.delivQty, volume: radar.qty });
  }
  return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
}

function deliverySection(history, radar) {
  if (!history.length) return '<p>No delivery observations in the available sessions.</p>';
  const observations = history.filter(row => Number.isFinite(row.delivered));
  const first = observations.at(-1), last = observations[0];
  const delta = last && first ? last.delivered - first.delivered : 0;
  const comparison = observations.length > 1 ? `<p>Delivery moved from ${percent(first.delivered)} on ${sourceDate(first.date)} to ${percent(last.delivered)} on ${sourceDate(last.date)} (${delta > 0 ? '+' : ''}${number(delta)} percentage points).</p>` : '';
  const baseline = Number.isFinite(radar?.delivRatio) ? `<p>On ${sourceDate(delivery.date)}, delivered volume was ${number(radar.delivRatio)}× its average over the prior ${delivery.baseline} sessions.</p>` : '';
  return comparison + `<table><thead><tr><th scope="col">Session</th><th scope="col">Close</th><th scope="col">Delivery</th><th scope="col">Delivered shares</th></tr></thead>
<tbody>${history.map(row => `<tr><th scope="row">${sourceDate(row.date)}</th><td>${money(row.close)}</td><td>${percent(row.delivered)}</td><td>${number(row.qty)}</td></tr>`).join('')}</tbody></table>` + baseline;
}

function technicalSection(row) {
  if (!row) return '';
  const matches = PRESETS.filter(p => runScreen([row], p).length);
  const closeAt = distance => row.hasHistory && Number.isFinite(distance) && distance > -100 ? row.price / (1 + distance / 100) : null;
  const flags = [[row.above50, 50], [row.above200, 200]].filter(([flag]) => typeof flag === 'boolean');
  return `<section><h2>Price trend and matching screens</h2><p class="data-note">Technical snapshot · ${sourceDate(screen.date)}</p>
${metrics([['1-month return', percent(row.r1m)], ['3-month return', percent(row.r3m)], ['1-year return', percent(row.r1y)], ['RSI (14)', number(row.rsi)]])}
${row.hasHistory ? `<p>Estimated 52-week closing range of ${money(closeAt(row.fromLow))} to ${money(closeAt(row.fromHigh))}, calculated from rounded daily-close distances.</p>` : ''}
${flags.length ? '<p>' + flags.map(([above, days]) => `${above ? 'Above' : 'Below'} the ${days}-day average`).join(' · ') + '</p>' : ''}
<p>Screening score of ${number(row.score)} / 100. ${matches.length ? matches.map(p => `<a href="/screener?screen=${p.id}">${esc(p.name)}</a>`).join(' · ') : 'No matching preset screens.'}</p></section>`;
}

function tradeSection(symbol) {
  const feed = research.trades;
  if (!feed) return '<p>The exchange deal files are unavailable.</p>';
  const rows = trades.get(symbol) || [];
  const coverage = `<p class="data-note">NSE deal files · ${feed.dates.map(sourceDate).join(', ')}${feed.partial ? ' · Partial coverage' : ''}</p>`;
  if (!rows.length) return coverage + '<p>No matching trade in the available bulk and block deal files.</p>';
  return coverage + `<ul class="stock-deals">${rows.map(row => `<li><strong>${esc(row.client)}</strong> ${row.side === 'BUY' ? 'bought' : 'sold'} ${number(row.qty)} shares at ${money(row.price)} · ${esc(row.kind)} deal · ${sourceDate(row.date)}</li>`).join('')}</ul>`;
}

for (const symbol of stocks) {
  const name = nameOf(symbol), row = technicals.get(symbol), radar = deliveries.get(symbol);
  const history = deliveryHistory(symbol, radar), quote = history.find(r => Number.isFinite(r.close));
  const close = quote?.close ?? row?.price, quoteDate = quote?.date ?? (row ? screen.date : null);
  const oi = futures.get(symbol), pe = research.pe?.values[symbol], cap = research.cap?.values[symbol];
  const listing = research.listings?.[symbol];
  const index = Boolean(listing?.isin) || Number.isFinite(close) || pe != null || cap != null || !!oi || trades.has(symbol);
  const modified = latestDate(quoteDate, row && screen.date, research.futures?.date, research.trades?.date, research.cap?.date, research.pe?.date);
  const title = `${name} (${symbol}) Share Price & Fundamentals | Alpha Nova`;
  const description = `${name} (NSE: ${symbol}). ${quoteDate && Number.isFinite(close) ? `Closing price ${money(close)} on ${quoteDate}. ` : ''}Explore delivery trends, futures open interest, bulk and block deals, and company valuation.`;
  const ticker = encodeURIComponent(symbol + '.NS');
  const recent = history[0];
  const change = quote?.previous > 0 ? (quote.close / quote.previous - 1) * 100 : quoteDate === delivery.date ? radar?.change : null;
  const oiSection = oi ? metrics([['Open contracts', number(oi.oi)], ['Change in contracts', number(oi.oiChg)], ['Change (%)', percent(oi.oiPct)]])
    : `<p>${research.futures ? 'No stock futures position appears in this session’s NSE report.' : 'The exchange futures report is unavailable.'}</p>`;
  const fundamentals = [
    ['Market capitalisation', cap == null ? null : `₹${number(cap / 1e7)} crore`, research.cap],
    ['Price / earnings', pe == null ? null : number(pe) + '×', research.pe],
  ];
  const industry = row?.industry || radar?.industry;
  const body = `<p class="eyebrow">NSE · ${esc(symbol)}${industry ? ' · ' + esc(industry) : ''}</p>
<h1>${esc(name)} share price</h1>
${Number.isFinite(close) ? `<div class="stock-price">${money(close)}</div><p class="data-note">${quote ? 'NSE closing price' : 'Technical-feed price'} · ${sourceDate(quoteDate)}${Number.isFinite(change) ? ' · ' + percent(change) + ' vs previous close' : ''}</p>` : '<p>No closing price in the available sessions.</p>'}
<a class="cta" href="/charts?symbol=${ticker}">Open ${esc(symbol)} chart</a>
<nav class="stock-sections" aria-label="On this page"><a href="#delivery">Delivery</a><a href="#open-interest">Open interest</a><a href="#deals">Deals</a><a href="#fundamentals">Fundamentals</a></nav>
<section id="delivery"><h2>Delivery percentage and recent history</h2>${deliverySection(history, radar)}</section>
<section id="open-interest"><h2>Futures open interest</h2>${research.futures ? `<p class="data-note">Across unexpired NSE futures · ${sourceDate(research.futures.date)}</p>` : ''}${oiSection}</section>
<section id="deals"><h2>Bulk and block deals</h2>${tradeSection(symbol)}</section>
<section id="fundamentals"><h2>Company fundamentals</h2><dl class="stock-metrics">${fundamentals.map(([label, value, feed]) => `<div><dt>${label}</dt><dd>${esc(value ?? 'Unavailable')}</dd>${feed ? `<dd class="metric-source"><a href="${esc(feed.url)}">NSE report</a> · ${sourceDate(feed.date)}</dd>` : ''}</div>`).join('')}</dl>
${listing ? `<p class="data-note"><a href="${stockSources.find(s => s.id === listing.board).url}">NSE ${listing.board === 'sme' ? 'SME' : 'mainboard'} listing</a> ${listing.series ? ' · ' + esc(listing.series) + ' series' : ''}${listing.isin ? ' · ISIN ' + esc(listing.isin) : ''}${listing.listed ? ' · Listed ' + esc(listing.listed) : ''}</p>` : ''}
<p><a href="/fundamentals?symbol=${ticker}">Explore ${esc(symbol)} financial statements</a></p></section>
${technicalSection(row)}<p class="data-note">Sources include NSE security-wise delivery, derivatives and deal reports. Technical indicators use Yahoo Finance daily closes where available.</p>`;
  let image;
  if (row) {
    image = '/share/' + encodeURIComponent(symbol) + '.png';
    const summary = [['CLOSE', money(close)], ['DELIVERY', percent(recent?.delivered)], ['FROM 52W HIGH', percent(row.fromHigh)]];
    await sharp(Buffer.from(preview(symbol, name + ' · ' + (quoteDate || screen.date), summary, (candles[symbol + '.NS'] || []).map(bar => bar.close)))).png({ palette: true }).toFile(`dist/share/${symbol}.png`);
  }
  const group = groupOf(symbol);
  await writeFile(`dist/stock-pages/${symbol}.html`, page({ title, description, path: stockPath(symbol), image, modified, index, body,
    company: { '@type': 'Corporation', name, tickerSymbol: 'NSE:' + symbol },
    crumbs: [['Home', '/'], ['Stocks', '/stocks/'], [group, groupPath(group)]] }));
}

const directoryCrumb = [['Home', '/']];
const alphabet = [...groups.keys()].map(key => `<a href="${groupPath(key)}">${key}</a>`).join(' ');
const directoryNav = `<nav class="stock-alphabet" aria-label="Browse by ticker">${alphabet}</nav>`;
const directoryTitle = 'NSE Stock Directory – Share Prices & Fundamentals | Alpha Nova';
await writeFile('dist/stocks/index.html', page({ path: '/stocks/', title: directoryTitle, modified: directoryDate,
  description: 'Browse NSE mainboard and SME stocks by ticker for dated share prices, delivery history, futures open interest, bulk and block trades and valuation.',
  crumbs: directoryCrumb, body: `<h1>NSE stock directory</h1><p>Browse ${number(stocks.length)} company profiles by ticker. Latest cash-market session · ${sourceDate(research.cash.date)}.</p>${directoryNav}
<h2>Explore stock profiles</h2><ul class="stock-shortcuts">${['RELIANCE', 'HDFCBANK', 'TCS', 'INFY', 'SBIN', 'M&M'].filter(s => stocks.includes(s)).map(s => `<li><a href="${stockPath(s)}">${esc(nameOf(s))} (${esc(s)})</a></li>`).join('')}</ul>` }));
for (const [group, symbols] of groups) {
  const path = groupPath(group);
  await mkdir('dist' + path, { recursive: true });
  await writeFile('dist' + path + 'index.html', page({ path, title: `NSE Stocks by Symbol – ${group} | Alpha Nova`,
    description: `Browse ${symbols.length} NSE stock profiles for tickers starting with ${group}, including ${nameOf(symbols[0])}. View share prices, delivery and company fundamentals.`,
    crumbs: [...directoryCrumb, ['Stocks', '/stocks/']], body: `<h1>NSE stocks · ${group}</h1>${directoryNav}<ul class="stock-list">${symbols.map(s =>
      `<li><a href="${stockPath(s)}"><b>${esc(s)}</b> ${esc(nameOf(s))}</a></li>`).join('')}</ul>` }));
}
// Start from the editorial sitemap so a repeated stock build is idempotent.
const sitemap = await readFile('public/sitemap.xml', 'utf8');
const entries = sitemapEntries.map(({ path, modified }) =>
  `<url><loc>${esc(SITE_ORIGIN + path)}</loc>${modified ? `<lastmod>${modified}</lastmod>` : ''}</url>`).join('\n');
await writeFile('dist/sitemap.xml', sitemap.replace('</urlset>', entries + '\n</urlset>'));
console.log(`Built ${stocks.length} public profiles, ${sitemapEntries.length - groups.size - 1} indexable, and ${groups.size} directory groups.`);
