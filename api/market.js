import { stockDirectory } from '../src/stocks.js';
import { recentSessions, nifty500, buildRadar, buildScreen, deliveryStats, deliverySignal, BASELINE } from '../lib/nse.js';
import { latestFo, optionChain, underlyings, futuresBuildup, participants, fiiDii, deals } from '../lib/fno.js';
import { rotation } from '../lib/indices.js';
const cache = new Map();
// Basic per-instance rate limiting so one client cannot exhaust Yahoo upstream
// or Vercel execution time for everyone else. Vercel Hobby has no shared KV,
// so this is best-effort per isolate; edge CDN caching does the heavy lifting.
const rate = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const entry = rate.get(ip);
  if (!entry || now > entry.reset) {
    rate.set(ip, { count: 1, reset: now + 60000 });
    if (rate.size > 2000) rate.delete(rate.keys().next().value);
    return false;
  }
  entry.count += 1;
  return entry.count > 120;
}
export const validSymbol = s => typeof s === 'string' && /^[A-Z0-9^][A-Z0-9._^=&-]{0,24}$/.test(s);
const intervals = {'1d':'5m','5d':'30m','1mo':'1d','3mo':'1d','6mo':'1d','1y':'1d','2y':'1wk','5y':'1wk'};
export function normalize(result, symbol, range, adjusted = false) {
  const m=result.meta || {}, q=result.indicators?.quote?.[0] || {};
  const adj=result.indicators?.adjclose?.[0]?.adjclose;
  if(adjusted && !Array.isArray(adj)) throw new Error('Adjusted price history unavailable');
  const bars=(result.timestamp || []).flatMap((t,i)=>{
    const raw=q.close?.[i];
    if(adjusted && (!Number.isFinite(adj[i]) || adj[i]<=0 || !Number.isFinite(raw) || raw<=0)) return [];
    const factor=adjusted?adj[i]/raw:1;
    const [open,high,low,close]=['open','high','low','close'].map(k=>adjusted && Number.isFinite(q[k]?.[i])?q[k][i]*factor:q[k]?.[i]);
    if (![open,high,low,close].every(Number.isFinite) || close<=0) return [];
    return [{time:range==='1d'||range==='5d'?t:new Date(t*1000).toISOString().slice(0,10),open,high:Math.max(high,open,close),low:Math.min(low,open,close),close,volume:q.volume?.[i] || 0}];
  });
  const unique=[...new Map(bars.map(b=>[b.time,b])).values()].sort((a,b)=>a.time<b.time?-1:1);
  if (!unique.length) throw new Error('No price history available');
  const previous=m.previousClose ?? (range==='1d'?m.chartPreviousClose:null);
  const price=m.regularMarketPrice ?? unique.at(-1).close;
  return {symbol,name:m.longName || m.shortName || symbol,currency:m.currency || 'USD',exchange:m.exchangeName,price,previous,change:Number.isFinite(previous)&&previous>0?(price/previous-1)*100:null,marketTime:m.regularMarketTime,dayHigh:m.regularMarketDayHigh,dayLow:m.regularMarketDayLow,volume:m.regularMarketVolume,yearHigh:m.fiftyTwoWeekHigh,yearLow:m.fiftyTwoWeekLow,timezone:m.exchangeTimezoneName,delay:m.exchangeDataDelayedBy ?? null,bars:unique,source:'Yahoo Finance',fetchedAt:new Date().toISOString(),range,...(adjusted?{adjusted:true}:{})};
}
export async function chart(symbol,range,adjusted=false,daily=false) {
 const key=`${symbol}:${range}${adjusted?':adjusted':''}${daily?':daily':''}`, old=cache.get(key);
 if(old && Date.now()-old.at<15000)return old.data;
 for(const host of ['query2.finance.yahoo.com','query1.finance.yahoo.com']) {
  try {
   const r=await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${daily?'1d':intervals[range]}&includePrePost=false${adjusted?'&includeAdjustedClose=true':''}`,{headers:{'User-Agent':'Mozilla/5.0',Accept:'application/json'},signal:AbortSignal.timeout(7000)});
   if(!r.ok)continue;
   const j=await r.json();if(!j.chart?.result?.[0])continue;
   const data=normalize(j.chart.result[0],symbol,range,adjusted);
   if(cache.size>500)cache.delete(cache.keys().next().value);cache.set(key,{at:Date.now(),data});return data;
  }catch{}
 }
 throw new Error(`Market data unavailable for ${symbol}. Try again shortly.`);
}
const fundCache = new Map();
let yahooSession = null;
async function yahooSessionGet(force=false) {
  if(!force && yahooSession && Date.now()-yahooSession.at<1800000)return yahooSession;
  const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  const fc=await fetch('https://fc.yahoo.com',{headers:{'User-Agent':UA},signal:AbortSignal.timeout(8000)});
  const setCookies=typeof fc.headers.getSetCookie==='function'?fc.headers.getSetCookie():[];
  const cookie=setCookies.map(c=>c.split(';')[0]).join('; ');
  await fc.arrayBuffer().catch(()=>null);
  const cr=await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb',{headers:{'User-Agent':UA,Cookie:cookie},signal:AbortSignal.timeout(8000)});
  if(!cr.ok)throw new Error('Fundamentals temporarily unavailable');
  const crumb=(await cr.text()).trim();
  if(!crumb)throw new Error('Fundamentals temporarily unavailable');
  yahooSession={cookie,crumb,ua:UA,at:Date.now()};
  return yahooSession;
}
const num=v=>Number.isFinite(v?.raw)?v.raw:null;
const str=v=>typeof v?.raw==='string'?v.raw:(typeof v==='string'?v:null);
export function normalizeFundamentals(json, symbol) {
  const r=json?.quoteSummary?.result?.[0] || {};
  const sd=r.summaryDetail||{},ks=r.defaultKeyStatistics||{},fd=r.financialData||{},pr=r.price||{},ap=r.assetProfile||{};
  return {symbol,peTrailing:num(sd.trailingPE),peForward:num(sd.forwardPE),epsTrailing:num(ks.trailingEps),epsForward:num(ks.forwardEps),earningsGrowth:num(fd.earningsGrowth),revenueGrowth:num(fd.revenueGrowth),roe:num(fd.returnOnEquity),profitMargin:num(fd.profitMargins),debtToEquity:num(fd.debtToEquity),marketCap:num(pr.marketCap),sector:str(ap.sector)||null,industry:str(ap.industry)||null,businessSummary:str(ap.longBusinessSummary)||null,source:'Yahoo Finance',fetchedAt:new Date().toISOString()};
}
const SEC_UA='Alpha Nova Terminal (contact@alphanova48.in)';
let secTickers={at:0,map:null};
const secFactsCache=new Map();
export const isUSTicker=s=>/^[A-Z]{1,4}([.-][A-Z])?$/.test(s||'');
async function secTickerMap(){
  if(secTickers.map && Date.now()-secTickers.at<7*86400000)return secTickers.map;
  const r=await fetch('https://www.sec.gov/files/company_tickers.json',{headers:{'User-Agent':SEC_UA,Accept:'application/json'},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('SEC directory unavailable');
  const j=await r.json();
  const map={};
  for(const v of Object.values(j)){if(v?.ticker&&Number.isFinite(v.cik_str))map[String(v.ticker).toUpperCase()]=String(v.cik_str).padStart(10,'0');}
  secTickers={at:Date.now(),map};
  return map;
}
function secEntries(concepts,name,perShare){
  const units=concepts?.[name]?.units;if(!units)return[];
  const keys=Object.keys(units);
  const key=perShare?(keys.find(k=>k.includes('shares'))||keys[0]):(keys.find(k=>k==='USD')||keys[0]);
  return units[key]||[];
}
const byEnd=(a,b)=>a.end<b.end?-1:a.end>b.end?1:0;
function secQuarters(entries){
  const seen=new Map();
  for(const e of entries){
    if(e?.form!=='10-Q'||!/^CY\d{4}Q[1-4]$/.test(e.frame||''))continue;
    const prev=seen.get(e.end);
    if(!prev||String(e.filed||'')>=String(prev.filed||''))seen.set(e.end,e);
  }
  return [...seen.values()].sort(byEnd);
}
function secAnnuals(entries){return entries.filter(e=>e?.form==='10-K'&&e.fp==='FY').sort(byEnd);}
const secSum=xs=>xs.reduce((t,e)=>t+e.val,0);
export function normalizeSECFacts(facts,price,symbol){
  const concepts=facts?.facts?.['us-gaap'];if(!concepts)return null;
  const num=v=>Number.isFinite(v)?v:null;
  const epsQ=secQuarters(secEntries(concepts,'EarningsPerShareDiluted',true));
  const niQ=secQuarters(secEntries(concepts,'NetIncomeLoss',false));
  let epsTrailing=null,niTTM=null,niPrev=null;
  if(epsQ.length>=4)epsTrailing=secSum(epsQ.slice(-4));
  else{const a=secAnnuals(secEntries(concepts,'EarningsPerShareDiluted',true)).at(-1);if(a)epsTrailing=a.val;}
  if(niQ.length>=8){niTTM=secSum(niQ.slice(-4));niPrev=secSum(niQ.slice(-8,-4));}
  else if(niQ.length>=4)niTTM=secSum(niQ.slice(-4));
  if(niTTM==null||niPrev==null){
    // Annual 10-K fallback: latest full-year NI, prior full-year NI as comparator.
    const nas=secAnnuals(secEntries(concepts,'NetIncomeLoss',false));
    if(nas.length>=1&&niTTM==null)niTTM=nas.at(-1).val;
    if(nas.length>=2&&niPrev==null)niPrev=nas.at(-2).val;
  }
  let revTTM=null,revPrev=null;
  // Filers switch revenue concepts over time (e.g. NVDA left a stale 2022 concept
  // behind), so use the concept with the freshest data, not the first non-empty one.
  {
    let best=null;
    for(const c of ['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet']){
      const q=secQuarters(secEntries(concepts,c,false));
      const a=secAnnuals(secEntries(concepts,c,false));
      const end=[q.at(-1)?.end,a.at(-1)?.end].filter(Boolean).sort().at(-1);
      if(end&&(best==null||end>best.end))best={c,q,a,end};
    }
    if(best){
      if(best.q.length>=4){revTTM=secSum(best.q.slice(-4));if(best.q.length>=8)revPrev=secSum(best.q.slice(-8,-4));}
      else if(best.a.length>=1){revTTM=best.a.at(-1).val;if(best.a.length>=2)revPrev=best.a.at(-2).val;}
    }
  }
  const eqAll=secEntries(concepts,'StockholdersEquity',false).sort(byEnd);
  const equity=eqAll.length?eqAll.at(-1).val:null;
  const earningsGrowth=num(niTTM)!=null&&num(niPrev)&&niPrev!==0?niTTM/niPrev-1:null;
  const revenueGrowth=num(revTTM)!=null&&num(revPrev)&&revPrev!==0?revTTM/revPrev-1:null;
  const roe=num(niTTM)!=null&&num(equity)&&equity!==0?niTTM/equity:null;
  const profitMargin=num(niTTM)!=null&&num(revTTM)&&revTTM!==0?niTTM/revTTM:null;
  if(epsTrailing==null&&niTTM==null&&equity==null)return null;
  return {symbol,peTrailing:num(price)&&num(epsTrailing)&&epsTrailing>0?price/epsTrailing:null,peForward:null,epsTrailing:num(epsTrailing),epsForward:null,earningsGrowth,revenueGrowth,roe,profitMargin,debtToEquity:null,marketCap:null,sector:null,industry:null,businessSummary:null,source:'SEC EDGAR',fetchedAt:new Date().toISOString()};
}
async function secFundamentals(symbol,price){
  const map=await secTickerMap();
  const cik=map[symbol];if(!cik)return null;
  const hit=secFactsCache.get(cik);
  let facts=hit&&Date.now()-hit.at<86400000?hit.data:null;
  if(!facts){
    const r=await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,{headers:{'User-Agent':SEC_UA,Accept:'application/json'},signal:AbortSignal.timeout(15000)});
    if(!r.ok)return null;
    facts=await r.json();
    if(secFactsCache.size>500)secFactsCache.delete(secFactsCache.keys().next().value);
    secFactsCache.set(cik,{at:Date.now(),data:facts});
  }
  return normalizeSECFacts(facts,price,symbol);
}
async function yahooFundamentals(symbol) {
  const old=fundCache.get(symbol);
  if(old && Date.now()-old.at<1800000)return old.data;
  let lastErr=null;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const sess=await yahooSessionGet(attempt>0);
      const host=attempt===0?'query2.finance.yahoo.com':'query1.finance.yahoo.com';
      const url=`https://${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price,summaryDetail,defaultKeyStatistics,financialData,assetProfile&crumb=${encodeURIComponent(sess.crumb)}`;
      const r=await fetch(url,{headers:{'User-Agent':sess.ua,Cookie:sess.cookie,Accept:'application/json'},signal:AbortSignal.timeout(9000)});
      if(r.status===401||r.status===403){yahooSession=null;lastErr=new Error('Fundamentals temporarily unavailable');continue;}
      if(!r.ok){lastErr=new Error('Fundamentals temporarily unavailable');continue;}
      const j=await r.json();
      if(j?.finance?.error){yahooSession=null;lastErr=new Error('Fundamentals temporarily unavailable');continue;}
      const data=normalizeFundamentals(j,symbol);
      if(fundCache.size>500)fundCache.delete(fundCache.keys().next().value);
      fundCache.set(symbol,{at:Date.now(),data});
      return data;
    }catch(e){lastErr=e;}
  }
  if(old)return old.data;
  throw lastErr || new Error('Fundamentals temporarily unavailable');
}
const SCR_UA='Alpha Nova Terminal (contact@alphanova48.in)';
const scrSlugCache=new Map();
const scrCache=new Map();
const isIndian=s=>/\.NS$/.test(s||'');
function scrSlugs(symbol){
  const base=symbol.replace(/\.NS$/,'');
  return [...new Set([base,base.replace(/&/g,''),base.replace(/-/g,'')])].filter(Boolean);
}
const scrNum=t=>{const v=parseFloat(String(t||'').replace(/,/g,''));return Number.isFinite(v)?v:null;};
export function normalizeScreener(html,symbol){
  if(!html||!/top-ratios/.test(html))return null;
  const rows={};
  for(const m of html.matchAll(/<li[^>]*>\s*<span class="name">\s*([^<]+?)\s*<\/span>([\s\S]*?)<\/li>/g)){
    const label=m[1].replace(/\s+/g,' ').trim();
    const nums=[...m[2].matchAll(/<span class="number">([^<]+)<\/span>/g)].map(x=>scrNum(x[1])).filter(v=>v!=null);
    if(label&&nums.length)rows[label]={nums,crore:(/Cr\./.test(m[2])),pct:(/%/.test(m[2]))};
  }
  const get=n=>rows[n]||null;
  const pe=get('Stock P/E')?.nums[0]??null;
  const price=get('Current Price')?.nums[0]??null;
  const roeR=get('ROE');
  const roe=roeR?roeR.nums[0]/100:null;
  const mc=get('Market Cap');
  const marketCap=mc?mc.nums[0]*(mc.crore?1e7:1):null;
  const growth=re=>{const m=html.match(new RegExp('Compounded '+re+' Growth<\/th>(?:[\\s\\S]{0,800}?)TTM:<\/td>\\s*<td>\\s*(-?[\\d.]+)%'));return m?scrNum(m[1])/100:null;};
  const out={symbol,peTrailing:pe,peForward:null,epsTrailing:pe&&price&&pe>0?price/pe:null,epsForward:null,earningsGrowth:growth('Profit'),revenueGrowth:growth('Sales'),roe,profitMargin:null,debtToEquity:null,marketCap,sector:null,industry:null,businessSummary:null,source:'Screener.in',fetchedAt:new Date().toISOString()};
  if(out.peTrailing==null&&out.roe==null&&out.marketCap==null)return null;
  return out;
}
async function screenerFundamentals(symbol){
  let slug=scrSlugCache.get(symbol);
  const trySlugs=slug?[slug]:scrSlugs(symbol);
  for(const s of trySlugs){
    const hit=scrCache.get(s);
    if(hit&&Date.now()-hit.at<43200000){scrSlugCache.set(symbol,s);return hit.data;}
    try{
      const r=await fetch(`https://www.screener.in/company/${encodeURIComponent(s)}/`,{headers:{'User-Agent':SCR_UA,Accept:'text/html'},signal:AbortSignal.timeout(10000)});
      if(r.status===404)continue;
      if(!r.ok)continue;
      const html=await r.text();
      const data=normalizeScreener(html,symbol);
      if(!data)continue;
      if(scrCache.size>500)scrCache.delete(scrCache.keys().next().value);
      scrCache.set(s,{at:Date.now(),data});
      scrSlugCache.set(symbol,s);
      return data;
    }catch{/* try next slug */}
  }
  return null;
}
async function fundamentals(symbol) {
  const key=`fund:${symbol}`, old=fundCache.get(key);
  if(old && Date.now()-old.at<1800000)return old.data;
  const price=await chart(symbol,'5d').then(d=>d.price).catch(()=>null);
  const [yahoo,sec,scr]=await Promise.all([
    yahooFundamentals(symbol).catch(()=>null),
    isUSTicker(symbol)?secFundamentals(symbol,price).catch(()=>null):Promise.resolve(null),
    isIndian(symbol)?screenerFundamentals(symbol).catch(()=>null):Promise.resolve(null)
  ]);
  if(!yahoo&&!sec&&!scr){
    if(old)return old.data;
    throw new Error('Fundamentals temporarily unavailable');
  }
  const pick=k=>yahoo?.[k]??sec?.[k]??scr?.[k]??null;
  const sources=[yahoo&&'Yahoo Finance',sec&&'SEC EDGAR',scr&&'Screener.in'].filter(Boolean);
  const data={symbol,peTrailing:pick('peTrailing'),peForward:pick('peForward'),epsTrailing:pick('epsTrailing'),epsForward:pick('epsForward'),earningsGrowth:pick('earningsGrowth'),revenueGrowth:pick('revenueGrowth'),roe:pick('roe'),profitMargin:pick('profitMargin'),debtToEquity:pick('debtToEquity'),marketCap:yahoo?.marketCap??scr?.marketCap??null,sector:yahoo?.sector??null,industry:yahoo?.industry??null,businessSummary:yahoo?.businessSummary??null,source:sources.join(' + ')||'Unavailable',fetchedAt:new Date().toISOString()};
  if(data.peTrailing==null&&data.epsTrailing==null&&data.roe==null){
    if(old)return old.data;
    throw new Error('Fundamentals temporarily unavailable');
  }
  if(fundCache.size>500)fundCache.delete(fundCache.keys().next().value);
  fundCache.set(key,{at:Date.now(),data});
  return data;
}
const decode=s=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]*>/g,'').trim();
// News relevance: filings and material events first, generic price chatter last.
// Generic "stock price today / why X is up today" pages dominate RSS fallbacks,
// so score titles and keep the sort deterministic (score, then recency).
export const FILING_RE=/\b(10-K|10-Q|10Q|10K|8-K|20-F|DEF 14A|S-1|424B|13F|form 4|filing|SEC EDGAR|annual report|quarterly results|financial results|earnings|revenue|profit|dividend|buyback|bonus issue|stock split|merger|acquisition|takeover|guidance|board meeting|AGM|EGM|credit rating|downgrade|upgrade)\b/i;
export const PRICE_NOISE_RE=/\b(share price today|stock price today|share price live|stock price live|why .* (up|down|rising|falling|today)|price prediction|multibagger|upper circuit|lower circuit)\b/i;
export function newsScore(n){
  const t=`${n?.title||''}`;
  let score=0;
  if(n?.filing||/SEC EDGAR/i.test(n?.source||''))score+=4;
  if(FILING_RE.test(t))score+=3;
  if(PRICE_NOISE_RE.test(t))score-=3;
  // Publisher headlines that merely restate the quote are less useful than an event.
  if(/\b(stock|share) (surges?|jumps?|dips?|falls?|rallies)\b/i.test(t)&&!FILING_RE.test(t))score-=1;
  return score;
}
export function companyNews(items,symbol,name) {
  if (!name) return items;
  const normalizeText = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const company = normalizeText(name.replace(/\b(limited|ltd|pvt)\.?/gi,'')).trim();
  const ticker = normalizeText(symbol.replace(/\.NS$/,''));
  return items.filter(n=>{
    const title=' '+normalizeText(n.title)+' ';
    return (company && title.includes(' '+company+' ')) || (ticker.length>=3 && title.includes(' '+ticker+' '));
  });
}
export function rankNews(items){
  const list=(items||[]).filter(n=>n&&n.title&&/^https:\/\//.test(n.url||''));
  const scored=list.map((n,i)=>({n,i,kind:(n.filing||/SEC EDGAR/i.test(n.source||'')||/\b(10-K|10-Q|8-K|20-F)\b/.test(n.title||''))?'filing':(FILING_RE.test(n.title||'')?'event':'market'),score:newsScore(n)}));
  scored.sort((a,b)=>b.score-a.score||((Date.parse(b.n.date)||0)-(Date.parse(a.n.date)||0))||a.i-b.i);
  return scored.map(({n,kind,score})=>({...n,kind,relevance:score}));
}
async function secFilings(symbol){
  try{
    const map=await secTickerMap();
    const cik=map[symbol];if(!cik)return[];
    const r=await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`,{headers:{'User-Agent':SEC_UA,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
    if(!r.ok)return[];
    const j=await r.json();
    const recent=j?.filings?.recent;if(!recent||!Array.isArray(recent.form))return[];
    const out=[];
    for(let i=0;i<recent.form.length&&out.length<4;i++){
      const form=String(recent.form[i]||'');
      if(!/^(10-K|10-Q|8-K|20-F|DEF 14A|S-1|424B4?|13F|4)\b/.test(form))continue;
      const date=recent.filingDate?.[i]||'';
      const acc=String(recent.accessionNumber?.[i]||'').replace(/-/g,'');
      const primary=recent.primaryDocument?.[i]||'';
      if(!acc||!primary)continue;
      out.push({title:`${symbol} ${form} — filed ${date}`,url:`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${primary}`,date,source:'SEC EDGAR',filing:true});
    }
    return out;
  }catch{return[];}
}
export function parseNews(xml, fallbackSource='Yahoo Finance'){return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([_,x])=>{const get=t=>decode(x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`))?.[1]||'');return {title:get('title'),url:get('link'),date:get('pubDate'),source:get('source')||fallbackSource};}).filter(n=>n.title && /^https:\/\//.test(n.url)).sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0)).slice(0,20);}
// Fetch independently: one blocked publisher must not discard healthy feeds.
export async function aggregateNews(symbol, name, fetcher=fetch, filingsLoader=secFilings) {
 const market=symbol==='^NSEI'||symbol==='^GSPC';
 const topic=symbol==='^NSEI'?'(Nifty OR Sensex OR "Indian stocks" OR "India markets" OR RBI)':symbol==='^GSPC'?'global stock markets economy':`${name?`"${name}"`:symbol.replace(/\.NS$/,'')} stock`;
 const google=query=>`https://news.google.com/rss/search?q=${encodeURIComponent(query+' when:7d')}&hl=en-IN&gl=IN&ceid=IN:en`;
 const feeds=[
  {source:'Google News',url:google(topic)},
  {source:'Investing.com',url:market&&symbol==='^GSPC'?'https://www.investing.com/rss/news_25.rss':google(topic+' site:investing.com')},
  ...(!market?[{source:'Yahoo Finance',url:`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`}]:[]),
 ];
 const results=await Promise.allSettled(feeds.map(async feed=>{
  const response=await fetcher(feed.url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(7000)});
  if(!response.ok)throw Error('Feed unavailable');
  const xml=await response.text();
  if(!/<rss[\s>]|<rdf:RDF[\s>]/i.test(xml))throw Error('Invalid feed');
  const parsed=parseNews(xml,feed.source).map(n=>({...n,title:n.title.endsWith(` - ${n.source}`)?n.title.slice(0,-(` - ${n.source}`).length):n.title}));
  const relevant=symbol==='^NSEI'?parsed.filter(n=>/\b(India|Indian|Nifty|Sensex|NSE|BSE|RBI|rupee)\b/i.test(n.title)):parsed;
  return companyNews(relevant,symbol,market?null:name);
 }).concat(isUSTicker(symbol)?[filingsLoader(symbol)]:[]));
 const failedSources=feeds.filter((_,i)=>results[i].status==='rejected').map(f=>f.source);
 const items=dedupeNews(results.flatMap(r=>r.status==='fulfilled'?r.value:[]));
 if(!items.length&&failedSources.length===feeds.length)throw Error('News sources are temporarily unavailable. Please retry.');
 return {items:rankNews(items).slice(0,60),source:[...new Set(items.map(n=>n.source))].join(' · '),failedSources,fetchedAt:new Date().toISOString()};
}
export function dedupeNews(items) {
 const urls=new Set(),titles=new Set();
 return items.filter(item=>{
  const suffix=` - ${item.source}`;
  if(item.title.endsWith(suffix))item={...item,title:item.title.slice(0,-suffix.length)};
  const title=item.title.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  let url;try{const parsed=new URL(item.url);for(const key of [...parsed.searchParams.keys()])if(/^utm_|^(guccounter|guce_referrer|ref)$/i.test(key))parsed.searchParams.delete(key);parsed.hash='';url=parsed.href;}catch{return false;}
  if(urls.has(url)||titles.has(title))return false;
  urls.add(url);titles.add(title);return true;
 });
}
// Macro theme news. Each theme names a lead instrument plus the instruments that
// should move with it, so a caller can check price/news co-occurrence without
// maintaining a second copy of the mapping.
// `sign` is the expected direction RELATIVE to the lead's move: crude up should
// drag energy equities up (+1) and the rupee weaker, which raises USD/INR (+1).
export const THEMES={
 hormuz:{
  lead:'BZ=F',
  linked:[{symbol:'CL=F',sign:1},{symbol:'^CNXENERGY',sign:1},{symbol:'INR=X',sign:1}],
  query:'("Strait of Hormuz" OR "Iran tanker" OR "IRGC seizure" OR "Iran nuclear" OR "Iran sanctions" OR "Red Sea shipping")'
 },
 fed:{
  lead:'^GSPC',
  linked:[{symbol:'^IXIC',sign:1},{symbol:'^TNX',sign:-1},{symbol:'GC=F',sign:-1}],
  query:'("Federal Reserve" OR FOMC OR "rate decision" OR "Powell")'
 },
 india:{
  lead:'^NSEI',
  linked:[{symbol:'^NSEBANK',sign:1},{symbol:'INR=X',sign:-1}],
  query:'(RBI OR "Indian rupee" OR "FII flows" OR "India inflation" OR "India GDP")'
 },
 asia:{
  lead:'^N225',
  linked:[{symbol:'^KS11',sign:1},{symbol:'^NSEI',sign:1}],
  query:'("Bank of Japan" OR "China stimulus" OR "Asia markets" OR "yen" OR "Korea exports")'
 }
};
export const themeNames=Object.keys(THEMES);
async function macronews(theme,days){
 const t=THEMES[theme];
 const url=`https://news.google.com/rss/search?q=${encodeURIComponent(`${t.query} when:${days}d`)}&hl=en-IN&gl=IN&ceid=IN:en`;
 const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw new Error('Theme news feed unavailable');
 const items=parseNews(await r.text());
 // Distinct publishers is condition 2 of the materiality gate, so compute it
 // here where the raw items are, rather than making the agent re-derive it.
 const publishers=[...new Set(items.map(x=>String(x.source||'').trim()).filter(Boolean))];
 return {theme,lead:t.lead,linked:t.linked,items,publishers,windowDays:days,source:'Google News',fetchedAt:new Date().toISOString()};
}
export default async function handler(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'GET only'});}
 const ip=req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
 if(rateLimited(ip)){res.setHeader('Retry-After','60');res.setHeader('Cache-Control','no-store');return res.status(429).json({error:'Too many requests. Please wait a minute and retry.'});}
 const op=req.query?.op || 'chart';
 try {
  let data;let cacheControl='public, max-age=60, s-maxage=300, stale-while-revalidate=300';
  if(op==='chart'){
   const s=String(req.query.symbol||'').trim().toUpperCase(),range=String(req.query.range||'6mo');
   if(!validSymbol(s)||!intervals[range])return res.status(400).json({error:'Invalid symbol or range'});
   if(req.query.adjusted!=null && (!['0','1'].includes(String(req.query.adjusted)) || ['1d','5d'].includes(range)))return res.status(400).json({error:'Adjusted history requires a daily or weekly range'});
   if(req.query.daily!=null && (!['0','1'].includes(String(req.query.daily)) || ['1d','5d'].includes(range)))return res.status(400).json({error:'Daily history requires a daily or weekly range'});
   data=await chart(s,range,req.query.adjusted==='1',req.query.daily==='1');
   cacheControl='public, max-age=0, s-maxage=15';
  }else if(op==='quotes'){
   const symbols=[...new Set(String(req.query.symbols||'').toUpperCase().split(',').map(s=>s.trim()).filter(Boolean))];
   if(!symbols.length||symbols.length>16||!symbols.every(validSymbol))return res.status(400).json({error:'Supply 1–16 valid symbols'});
   const quotes=[],errors=[];
   for(let i=0;i<symbols.length;i+=4){await Promise.all(symbols.slice(i,i+4).map(async s=>{try{const d=await chart(s,'5d');quotes.push({...d,bars:undefined,spark:d.bars.map(b=>b.close)});}catch{errors.push(s);}}));}
   if(!quotes.length)return res.status(503).json({error:'Market feed temporarily unavailable. Please retry.',errors});
   cacheControl=errors.length?'no-store':'public, max-age=0, s-maxage=15';
   data={quotes,errors,fetchedAt:new Date().toISOString()};
  }else if(op==='fundamentals'){
   const s=String(req.query.symbol||'').trim().toUpperCase();if(!validSymbol(s))return res.status(400).json({error:'Invalid symbol'});
   try{data=await fundamentals(s);}catch(e){res.setHeader('Cache-Control','no-store');return res.status(503).json({error:e.message||'Fundamentals temporarily unavailable'});}
   cacheControl='public, max-age=300, s-maxage=1800, stale-while-revalidate=1800';
  }else if(op==='news'){
   const s=String(req.query.symbol||'^NSEI').trim().toUpperCase();if(!validSymbol(s))return res.status(400).json({error:'Invalid symbol'});
   const name=(s.endsWith('.NS')?stockDirectory.find(x=>x.symbol===s.replace(/\.NS$/,''))?.name:null)||({AAPL:'Apple',NVDA:'NVIDIA',MSFT:'Microsoft',AMZN:'Amazon',GOOGL:'Alphabet',META:'Meta Platforms',TSLA:'Tesla',JPM:'JPMorgan',GS:'Goldman Sachs','BRK-B':'Berkshire Hathaway',AMD:'Advanced Micro Devices',NFLX:'Netflix'})[s];
   data=await aggregateNews(s,name);
   cacheControl='public, max-age=0, s-maxage=120, stale-while-revalidate=300';
  }else if(op==='macronews'){
   const theme=String(req.query.theme||'').trim().toLowerCase();
   if(!THEMES[theme])return res.status(400).json({error:`Unknown theme. Try one of: ${themeNames.join(', ')}`});
   const days=Math.max(1,Math.min(7,Number(req.query.days)||3));
   data=await macronews(theme,days);
   cacheControl='public, max-age=120, s-maxage=600, stale-while-revalidate=1800';
  }else if(op==='delivery'){
   // End-of-day data: NSE publishes ~18:00 IST, so a 30-minute edge cache is plenty.
   cacheControl='public, max-age=300, s-maxage=1800, stale-while-revalidate=21600';
   const s=String(req.query.symbol||'').trim().toUpperCase().replace(/\.NS$/,'');
   if(s){
    if(!/^[A-Z0-9&-]{1,20}$/.test(s))return res.status(400).json({error:'Invalid NSE symbol'});
    const sessions=await recentSessions(BASELINE+1);
    const stats=deliveryStats(sessions,s);
    const history=sessions.map(x=>{const r=x.rows.get(s);return r?{date:x.date,close:r.close,delivPct:r.dp,delivQty:r.dq,qty:r.qty}:null;}).filter(Boolean).reverse();
    data={symbol:s,stats:stats?{...stats,signal:deliverySignal(stats)}:null,history,source:'NSE security-wise delivery bhavcopy',fetchedAt:new Date().toISOString()};
   }else{
    const minTurnoverCr=Math.max(0,Math.min(500,Number(req.query.minTurnover)||1));
    const [sessions,universe]=await Promise.all([recentSessions(BASELINE+1),nifty500()]);
    data=buildRadar(sessions,universe,{minTurnoverCr});
   }
  }else if(op==='screen'){
   cacheControl='public, max-age=300, s-maxage=900, stale-while-revalidate=3600';
   data=await buildScreen();
  }else if(op==='options'){
   // End-of-day chain from the F&O bhavcopy; NSE publishes it after the close.
   const s=String(req.query.symbol||'NIFTY').trim().toUpperCase(),exp=String(req.query.expiry||'');
   if(!/^[A-Z0-9&-]{1,20}$/.test(s)||(exp&&!/^\d{4}-\d{2}-\d{2}$/.test(exp)))return res.status(400).json({error:'Invalid symbol or expiry'});
   const fo=await latestFo();const chain=optionChain(fo,s,exp);
   if(!chain)return res.status(404).json({error:`${s} has no listed options in the ${fo.date} F&O bhavcopy`,symbols:underlyings(fo)});
   data={...chain,symbols:underlyings(fo),fetchedAt:new Date().toISOString()};
   cacheControl='public, max-age=300, s-maxage=1800, stale-while-revalidate=21600';
  }else if(op==='futures'){
   data=futuresBuildup(await latestFo());
   cacheControl='public, max-age=300, s-maxage=1800, stale-while-revalidate=21600';
  }else if(op==='flows'){
   const [cash,pos]=await Promise.allSettled([fiiDii(),participants()]);
   if(cash.status==='rejected'&&pos.status==='rejected')throw new Error('NSE flow data is temporarily unavailable.');
   data={cash:cash.value||null,cashError:cash.status==='rejected'?'NSE did not return FII/DII cash data to this server.':null,participants:pos.value||null,participantsError:pos.status==='rejected'?pos.reason?.message:null,fetchedAt:new Date().toISOString()};
   cacheControl=cash.value&&pos.value?'public, max-age=300, s-maxage=1800, stale-while-revalidate=21600':'public, max-age=60, s-maxage=300, stale-while-revalidate=600';
  }else if(op==='deals'){
   data=await deals();
   cacheControl='public, max-age=300, s-maxage=1800, stale-while-revalidate=21600';
  }else if(op==='rotation'){
   data=await rotation();
   cacheControl='public, max-age=600, s-maxage=3600, stale-while-revalidate=21600';
  }else return res.status(400).json({error:'Unknown operation'});
  res.setHeader('Cache-Control',cacheControl);return res.status(200).json(data);
 }catch(e){res.setHeader('Cache-Control','no-store');return res.status(503).json({error:e.message || 'Data temporarily unavailable'});}
}
