import { WORKSPACE_SEO, SITE_ORIGIN } from '../src/seo.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { PRESETS, describe } from '../src/screens.js';
import { guides, updated, pricingUpdated } from '../content/seo/screens.mjs';
import { PAGE_LABELS } from '../src/navigation.js';
import { PRO_HEADLINE, PRO_REASON, PRO_WORKSPACE_COPY } from '../lib/proCopy.js';
import { PRO_DAYS, PRO_TRIAL_MINUTES, PRO_PAGES, PRO_PAYEE, PRO_PRICE, PRO_RENEW_DAYS, PRO_SUPPORT_EMAIL, PRO_SUPPORT_MAILTO, PRO_SUPPORT_WHATSAPP } from '../lib/proPlan.js';

const origin = SITE_ORIGIN;
const dateLabel = date => new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'long', year:'numeric', timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link = (path, name) => `<a href="${esc(path)}">${esc(name)}</a>`;
const guidePath = g => `/screens/${g.slug}.html`;
const paragraphs = xs => xs.map(p=>`<p>${esc(p)}</p>`).join('\n');
const lists = xs => `<ol>${xs.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>`;
const pages = [];
function page({path, name, heading=name, eyebrow='Alpha Nova research guides', description, body, parent, type='WebPage', revised=updated}) {
  const url = origin + path;
  const title = `${name} | Alpha Nova`;
  const crumbs = [{name:'Alpha Nova',item:origin+'/'}, ...(parent?[{name:'Screener guides',item:origin+'/screens.html'}]:[]),{name,item:url}];
  const graph = [
    {'@type':type,'@id':url+'#webpage',url,name:title,description,inLanguage:'en-IN',dateModified:revised,isPartOf:{'@id':origin+'/#website'},about:{'@id':origin+'/#app'},breadcrumb:{'@id':url+'#breadcrumb'}},
    {'@type':'BreadcrumbList','@id':url+'#breadcrumb',itemListElement:crumbs.map((c,i)=>({'@type':'ListItem',position:i+1,...c}))}
  ];
  const html = `<!doctype html>
<html lang="en-IN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1016">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}"><link rel="icon" href="/icon-192.png" type="image/png"><link rel="stylesheet" href="/seo.css">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="website"><meta property="og:site_name" content="Alpha Nova"><meta property="og:locale" content="en_IN">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${origin}/share/overview.png"><meta property="og:image:alt" content="Alpha Nova logo">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${origin}/share/overview.png">
<script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@graph':graph}).replaceAll('<','\\u003c')}</script>
</head><body class="seo-page"><a class="seo-skip" href="#content">Skip to content</a>
<header><nav class="seo-nav" aria-label="Site navigation">${link('/','↗ ALPHA NOVA TERMINAL').replace('<a ','<a class="seo-brand" ')}${link('/screens.html','Screener guides')}${link('/methodology.html','Methodology')}${link('/pricing.html','Pricing')}${link('/about.html','About and data')}</nav></header>
<main id="content"><nav class="seo-breadcrumb" aria-label="Breadcrumb">${crumbs.map((c,i)=>i===crumbs.length-1?`<span aria-current="page">${esc(c.name)}</span>`:link(new URL(c.item).pathname,c.name)).join(' / ')}</nav>
<span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(heading)}</h1>
<p class="data-note">Documentation updated <time datetime="${revised}">${dateLabel(revised)}</time> · Describes the current app; not a market-data timestamp.</p>
${body}
</main><footer>Alpha Nova Terminal · ${link('/about.html','About and data sources')} · ${link('/llms.txt','Site guide in plain text')} · Research tools, not investment advice.</footer></body></html>\n`;
  pages.push({path,name,description,html,revised});
}
for (const g of guides) {
  const preset = PRESETS.find(p=>p.id===g.id);
  if (!preset || !g.example || g.checks.length<3 || !g.caveat) throw new Error(`Incomplete guide: ${g.id}`);
  const related = g.related.map(id=>guides.find(x=>x.id===id));
  if (related.some(x=>!x)) throw new Error(`Invalid related guide: ${g.id}`);
  page({path:guidePath(g),name:g.name,description:g.description,parent:true,body:`
<p class="lead">${esc(g.intro)}</p>
<div class="callout"><p>Apply the built-in preset to the latest available dataset. Check source dates and coverage in the results.</p>${link('/screener?screen='+g.id,'Open this screen in Alpha Nova').replace('<a ','<a class="cta" ')}</div>
<h2>What are the exact screening rules?</h2>
<p>All of these conditions must hold. These rules come from the same preset definition used by the interactive screener.</p>
<ul class="rule-list">${preset.when.map(rule=>`<li>${esc(describe([rule]))}</li>`).join('')}</ul>
<h2>How is this screen calculated?</h2>${paragraphs([g.explanation])}
<h2>Worked example</h2>${paragraphs([g.example])}
<h2>What should you check in the results?</h2>${lists(g.checks)}
<h2>Limitations of this screen</h2>${paragraphs([g.caveat])}
<p>The intended universe is Nifty 500. If its constituent list is unavailable, the app may use the latest session’s top 500 EQ stocks by turnover. Numeric conditions exclude unavailable values. Sources can be delayed or have different dates; empty results can reflect missing coverage as well as no matches.</p>
<h2>${esc(g.question)}</h2>${paragraphs([g.answer])}
<h2>Sources and methodology</h2><p>These are Alpha Nova’s own preset definitions. Price-history metrics use Yahoo Finance; volume and delivery use ${link('https://www.nseindia.com/all-reports','NSE daily reports')}. See the ${link('/methodology.html','calculation and coverage methodology')} for formulas and limitations.</p>
<h2>Related screens</h2><ul>${related.map(x=>`<li>${link(guidePath(x),x.name)}</li>`).join('')}</ul><p>${link('/screens.html','Compare all screener guides')} or read the ${link('/stock-screener.html','Nifty 500 screener overview')}.</p>`});
}
page({path:'/screens.html',name:'Nifty 500 Stock Screener Guides & Rules',description:'Compare six Alpha Nova screens with exact rules, worked examples and data limits. Open delivery, volume, breakout, trend and relative strength presets.',type:'CollectionPage',body:`
<p class="lead">Choose a research question, understand its filter, then open the matching Alpha Nova preset. These guides explain the app’s rules and tradeoffs. Current matches and their data dates appear in the interactive screener.</p>
<div class="feature-grid">${guides.map(g=>`<article><h2>${link(guidePath(g),g.name)}</h2><p>${esc(g.intro)}</p></article>`).join('')}</div>
<h2>How do the screens differ?</h2><p>Delivery accumulation measures delivered quantity; volume surge measures all traded shares. A 20-day breakout requires a close above prior daily highs, while the near-high screen measures distance from an available closing-price high. Relative strength compares performance with Nifty 50; the adapted trend template combines moving averages and a composite score.</p>
<h2>How should you use a shortlist?</h2><ol><li>Choose a guide and inspect its exact rules and worked example.</li><li>Open that preset and check the source date, universe label and coverage.</li><li>Review a company’s chart and announcements, then save or export your research.</li></ol><p>${link('/methodology.html','Read the methodology')} or ${link('/stock-screener.html','explore all screener features')}. None of these presets is a recommendation to buy or sell.</p>`});
page({path:'/methodology.html',name:'Stock screener methodology and data',description:'Learn how Alpha Nova calculates delivery and volume ratios, relative strength, moving averages and composite scores, including coverage and timing limits.',body:`
<p class="lead">Alpha Nova combines public Yahoo Finance price history with NSE end-of-day reports. Its stock screens describe observed price, volume and delivery conditions. Calculations depend on the observations available from each source; they do not provide forecasts, execution prices or probabilities of profit.</p>
<h2>Which stocks and sessions are included?</h2><p>The screener normally uses the official Nifty 500 constituent list. If that list is unavailable, it can fall back to the 500 most-traded EQ symbols in the latest NSE archive session. The workspace labels the universe and reports coverage. A cached constituent list can lag index changes, and missing observations can reduce the usable history.</p>
<h2>Volume and delivery</h2><p>Volume ratio = latest traded quantity ÷ average traded quantity across available observations in the prior 20 sessions. Delivery ratio = latest delivered quantity ÷ average delivered quantity across available prior observations. The latest session is excluded from each baseline. Missing values are omitted rather than replaced with zero. Fewer observations can make a ratio less representative.</p><p>Delivery percentage is the share reported in the NSE delivery file. A high delivery ratio does not identify a buyer or establish institutional accumulation. The screener preset and Delivery radar use different classification rules.</p>
<h2>Returns and relative strength</h2><p>Returns use (latest close ÷ earlier close − 1) × 100 over 5, 21, 63 and 126 observations for the week, month, quarter and half-year labels. Three-month relative strength subtracts the Nifty 50 return over 63 observations from the stock return. It is measured in percentage points, not as a percentile or a risk-adjusted performance measure.</p>
<h2>Trend, highs and breakouts</h2><p>Moving averages are simple averages of 50, 150 or 200 daily closes. The screener’s 52-week high and low are the maximum and minimum of up to 252 available closes, not intraday extremes. Its 20-day breakout instead compares the latest NSE close with daily highs from available prior archive sessions. These definitions can differ from other platforms.</p><p>The fresh golden-cross flag compares the current 50/200-day ordering with the ordering 10 observations earlier. It is not an event-by-event count of all crosses inside that window. RSI uses Wilder-style smoothing on up to 120 available closes. Volatility annualizes the sample standard deviation of up to 20 log returns using √252.</p>
<h2>How is the 0–100 composite score calculated?</h2><p>Each available factor is ranked within the available screener rows. The percentile is the share of finite observations less than or equal to that value, multiplied by 100. The score takes a weighted mean of those factor percentiles:</p>
<ul><li>One-month return: weight 1</li><li>Three-month return: weight 2</li><li>Six-month return: weight 1.5</li><li>Three-month relative strength: weight 1.5</li><li>Distance from the closing-price high: weight 1.5</li><li>Delivery ratio: weight 0.5</li></ul>
<p>Unavailable factors are excluded and the remaining weights are renormalized. The app adds 5 points above the 200-day average, subtracts 5 below it, and adds 3 when the 50-day average exceeds the 200-day average. The result is clamped to 0–100 and rounded. Scores can change with coverage and are not win probabilities; no backtested return is implied.</p>
<h2>Are the observations synchronized or real time?</h2><p>No. Yahoo history, NSE archives and cached responses can have different dates. A latest price-history observation may represent a partial session while delivery belongs to an earlier completed session. Verify dates before comparing them. Failed data requests remain unavailable or may show cached observations; they are not replaced with fabricated prices.</p>
<h2>Where can I check the sources?</h2><ul><li>${link('https://www.nseindia.com/all-reports','NSE daily reports')}: security-wise delivery and bhavcopy source reports.</li><li>${link('https://www.niftyindices.com/indices/equity/broad-based-indices/NIFTY-500','Nifty Indices')}: Nifty 500 index information.</li><li>${link('https://finance.yahoo.com/','Yahoo Finance')}: price-history provider.</li></ul>
<p>${link('/screens.html','Explore the six worked screener guides')} or ${link('/about.html','read about Alpha Nova’s data and storage')}. These formulas document the current implementation; they are not endorsed by the source providers.</p>`});
const breakoutPreview = WORKSPACE_SEO.Breakouts.path;
const previewCta = link(breakoutPreview, 'Preview Breakout insights').replace('<a ','<a class="cta" ');
// Workspaces that were once Pro and are now free keep their one-line description on the pricing page.
const FREE_WORKSPACES = ['Markets', 'Fundamentals'].filter(key => !PRO_PAGES.includes(key));
const freeIntro = 'The free tools help you find stocks, look up a company, and organise your research. You can start without an account. Sign in with Google if you want to back up your watchlist and restore it on another device.';
page({path:'/pricing.html',revised:pricingUpdated,name:'Alpha Nova Pricing: Free Research Tools and Pro',heading:PRO_HEADLINE,eyebrow:'Alpha Nova · Free and Pro',description:`Try all ${PRO_PAGES.length} Alpha Nova Pro research workspaces with a ${PRO_TRIAL_MINUTES}-minute free trial. No payment details needed. Then ₹${PRO_PRICE} for ${PRO_DAYS} days, with no auto-renewal.`,body:`
<p class="lead">${esc(PRO_REASON)}</p>
<div class="callout"><p><strong>${PRO_TRIAL_MINUTES}-minute free trial.</strong> All ${PRO_PAGES.length} Pro workspaces. No payment details or automatic charge. Then ₹${PRO_PRICE} for ${PRO_DAYS} days if you choose to continue.</p>${previewCta}</div>
<h2>Why get Pro?</h2><p>Say your screen flags a breakout. With Pro, you can see how far price cleared the previous high, check whether volume picked up, and look at how far the stock has fallen from past peaks. That gives you a basis for deciding whether to keep researching or move on.</p>
<ul>${PRO_PAGES.map(key => `<li><strong>${esc(PAGE_LABELS[key])}:</strong> ${esc(PRO_WORKSPACE_COPY[key].benefit)}</li>`).join('')}</ul>
<h2>What can I see before signing in?</h2><p>Each Pro workspace opens on one live example with real data. You don’t need an account. Choosing anything beyond the example opens the Pro offer.</p>
<ul>${PRO_PAGES.map(key => `<li><strong>${esc(PAGE_LABELS[key])}:</strong> ${esc(PRO_WORKSPACE_COPY[key].example)}</li>`).join('')}</ul>
<h2>When is Free enough?</h2><p>${esc(freeIntro)}</p><ul><li>Stock search, historical charts and technical indicators.</li>${FREE_WORKSPACES.map(key => `<li><strong>${esc(PAGE_LABELS[key])}:</strong> ${esc(PRO_WORKSPACE_COPY[key].benefit)}</li>`).join('')}<li>Company and market news.</li><li>Nifty 500 screening with presets, a rule builder, CSV export and up to five saved screens.</li><li>NSE delivery radar.</li><li>Watchlists, plus holdings, risk plans and a manual trade journal that stay in your browser.</li><li>Optional alerts and push notifications on supported devices.</li></ul>
<p>${link('/screener','Open the free stock screener')}</p>
<h2>How do I start the free trial?</h2><p>Open any Pro workspace and select <strong>Try Pro free for ${PRO_TRIAL_MINUTES} min</strong> above its free example. Sign in with Google, then select <strong>Start ${PRO_TRIAL_MINUTES}-minute free trial</strong>. New and existing accounts can try Pro once per account. The trial starts when you select the button and follows your account across devices. When it ends, Pro workspaces lock again and free research stays available.</p>
<h2>How do I get paid Pro?</h2><ol><li>Open a Pro workspace, select the Pro button above its free example and sign in with Google.</li><li>Pay ₹${PRO_PRICE} using the UPI button or QR code. Look for ${PRO_PAYEE}, Alpha Nova’s founder, as the payment recipient.</li><li>Paste the 12-digit UPI reference number (UTR) from your receipt on the same screen.</li></ol>
<p>Most readers get access when they submit the reference. If we need to match a payment by hand, that usually takes a day or less. Your ${PRO_DAYS} days of access follow your Google account across devices. If you want more time, you can renew in the last ${PRO_RENEW_DAYS} days or after access ends.</p>
<p>We check each reference against the bank record and remove access if we can’t find a matching ₹${PRO_PRICE} payment. For payment help, email ${link(PRO_SUPPORT_MAILTO,PRO_SUPPORT_EMAIL)} or message ${link(PRO_SUPPORT_WHATSAPP,'WhatsApp +91 98318 10983')}.</p>
<h2>What are the limits?</h2><p>Public data providers may delay, throttle or withdraw access. Availability and refresh timing are not guaranteed, for free and Pro workspaces alike. Most personal research data stays in the browser; push notifications send the information needed for delivery to the server. Export a backup from Portfolio before changing devices or clearing browser storage.</p>
<h2>Does Alpha Nova charge for broker handoffs?</h2><p>No. Brokerage, exchange charges, taxes and other broker-side costs are separate. Review the broker’s own terms and final order details. A handoff does not confirm execution or place a protective stop automatically.</p>
<p>${link('/pricing.md','Read this pricing information as Markdown')}. See ${link('/methodology.html','data limitations')}, ${link('/privacy.html','privacy')} and ${link('/about.html','storage and product information')}.</p>
<div class="callout"><p>See what the evidence behind a breakout looks like before you pay.</p>${previewCta}</div>`});

await mkdir('public/screens',{recursive:true});
for (const p of pages) await writeFile('public'+(p.path.endsWith('/')?p.path+'index.html':p.path),p.html);
// Only publish lastmod when the content has a known editorial revision date.
// A deployment or a visit does not make unchanged content newly updated.
const existing = ['/', '/stock-prices.html','/stock-market-app.html','/stock-screener.html','/delivery-radar.html','/about.html'];
const editorialPaths = new Map(pages.map(p => [p.path, p.revised]));
await writeFile('public/sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...existing,...pages.map(p=>p.path),...Object.values(WORKSPACE_SEO).filter(p=>!p.noindex).map(p=>p.path).filter(p=>p!=='/')].map(path=>`  <url><loc>${origin+path}</loc>${editorialPaths.has(path) ? `<lastmod>${editorialPaths.get(path)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
await writeFile('public/pricing.md',`# Alpha Nova pricing

Updated: ${pricingUpdated}
Canonical page: ${origin}/pricing.html

## ${PRO_HEADLINE}

${PRO_REASON}

Start with a ${PRO_TRIAL_MINUTES}-minute free trial of all ${PRO_PAGES.length} Pro workspaces. No payment details or automatic charge. Paid Pro costs INR ${PRO_PRICE} for ${PRO_DAYS} days. One UPI payment includes all ${PRO_PAGES.length} workspaces, with no auto-renewal. [Preview Breakout insights](${origin}${breakoutPreview}).

${PRO_PAGES.map(key => `- **${PAGE_LABELS[key]}:** ${PRO_WORKSPACE_COPY[key].benefit}`).join('\n')}

## What can I see before signing in?

Each Pro workspace opens on one live example with real data. You don’t need an account. Choosing anything beyond the example opens the Pro offer.

${PRO_PAGES.map(key => `- **${PAGE_LABELS[key]}:** ${PRO_WORKSPACE_COPY[key].example}`).join('\n')}

## When is Free enough?

${freeIntro} Free includes charts, the Markets overview, company Fundamentals, news, Nifty 500 screening, CSV export, delivery radar, watchlists, risk plans and a manual journal. You can save up to five screens. Optional alerts require a supported device.

## How do I start the free trial?

Open any Pro workspace and select **Try Pro free for ${PRO_TRIAL_MINUTES} min** above its free example. Sign in with Google, then select **Start ${PRO_TRIAL_MINUTES}-minute free trial**. Available to new and existing accounts, once per account. It starts when you select the button and follows your account across devices. Pro workspaces lock again when it ends; free research stays available.

## How do I get paid Pro?

Open a Pro workspace, select the Pro button above its free example and sign in with Google. Pay by UPI using the button or QR code, then paste your 12-digit UPI reference number on the same screen. Access usually starts on submission. Some payments need a manual match first. Your access follows the same Google account across devices. You can renew during the last ${PRO_RENEW_DAYS} days or after access ends.

We check each reference against the bank record and remove access if we can’t find a matching payment. For payment help, email ${PRO_SUPPORT_EMAIL} or WhatsApp +91 98318 10983.

Public data can be delayed, throttled or unavailable. Personal research data stays in your browser by default; push notifications send the information needed for delivery to the server. Broker charges and third-party costs are separate. Handoffs do not confirm execution or automatically place protective stops. Pro is a research tool and does not provide investment advice.
`);
await writeFile('public/llms.txt',`# Alpha Nova\n\n> Alpha Nova (also written AlphaNova) is a browser-based research app for Indian and global markets. Core tools are free; an optional Pro tier is paid. Canonical website: ${origin}/\n\nAlpha Nova is also known as AlphaNova Terminal. Personal research is stored on the device; use Portfolio backup and restore to move it between browsers or websites.\n\nThe public guides explain the same rules used in the interactive product. Market data can be delayed or unavailable. Screens are research filters, not recommendations or predictions. Interactive matches require JavaScript; static guides do not publish current stock picks.\n\n## Founder\n\nAlphaNova was founded by Yash Sarda, based in Kolkata.\n- [Yash Sarda — professional bio](https://alphanova48.in/about.html)\n- [Yash Sarda — LinkedIn](https://www.linkedin.com/in/yashsarda31/)\n\n## Product and data\n\n- [Public NSE stock directory](${origin}/stocks/)\n- [About and data sources](${origin}/about.html)\n- [Stock market app](${origin}/stock-market-app.html)\n- [Pricing](${origin}/pricing.html): core tools INR 0; a ${PRO_TRIAL_MINUTES}-minute free trial of Alpha Nova Pro; paid Pro INR ${PRO_PRICE} per ${PRO_DAYS} days; current features and limitations.\n- [Pricing in Markdown](${origin}/pricing.md)\n- [Calculation methodology](${origin}/methodology.html)\n- [Nifty 500 screener](${origin}/stock-screener.html)\n- [Delivery radar](${origin}/delivery-radar.html)\n\n## Screener guides\n\n- [Guide index](${origin}/screens.html)\n${guides.map(g=>`- [${g.name}](${origin+guidePath(g)}): ${g.description}`).join('\n')}\n\nDocumentation updated: ${updated}. This is not a market-data timestamp.\n`);
console.log(`Generated ${pages.length} public pages, sitemap, llms.txt and pricing.md.`);
