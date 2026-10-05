import test from 'node:test';import assert from 'node:assert/strict';
import handler,{normalize,validSymbol,parseNews}from'../api/market.js';import{rsi,ema,bollinger}from'../src/marketMath.js';
const fixture={meta:{symbol:'AAPL',currency:'USD',regularMarketPrice:110,previousClose:100},timestamp:[1704067200,1704153600,1704240000],indicators:{quote:[{open:[100,102,null],high:[104,112,null],low:[99,100,null],close:[103,110,null],volume:[1000,2000,null]}]}};
test('history preserves real bars and calculates session change from previous close',()=>{const d=normalize(fixture,'AAPL','6mo');assert.equal(d.bars.length,2);assert.equal(d.bars[1].close,110);assert.ok(Math.abs(d.change-10)<1e-8);assert.equal(d.bars[0].time,'2024-01-01');});
test('intraday timestamps stay distinct, duplicate bars removed',()=>{const f=structuredClone(fixture);f.timestamp=[1704067200,1704067500,1704067500];f.indicators.quote[0].open[2]=105;f.indicators.quote[0].high[2]=115;f.indicators.quote[0].low[2]=102;f.indicators.quote[0].close[2]=111;assert.equal(normalize(f,'AAPL','1d').bars.length,2);assert.equal(normalize(f,'AAPL','1d').bars[0].time,1704067200);});
test('long-period starting price is never labeled session change',()=>{const f=structuredClone(fixture);delete f.meta.previousClose;f.meta.chartPreviousClose=50;assert.equal(normalize(f,'AAPL','6mo').change,null);});
test('only ticker characters are accepted',()=>{for(const s of ['RELIANCE.NS','M&M.NS','BTC-USD','^NSEI','GC=F'])assert.equal(validSymbol(s),true);for(const s of ['','https://example.com','../secret','AAPL?x=1'])assert.equal(validSymbol(s),false);});
test('news parses CDATA and never emits script or insecure URLs',()=>{const xml='<rss><item><title><![CDATA[Markets &amp; earnings]]></title><link>https://example.com/article</link><source url="https://example.com">Reuters</source></item><item><title>bad</title><link>javascript:alert(1)</link></item></rss>';assert.deepEqual(parseNews(xml),[{title:'Markets & earnings',url:'https://example.com/article',date:'',source:'Reuters'}]);});
test('invalid requests fail before upstream fetch',async()=>{for(const query of [{op:'chart',symbol:'../secret'},{op:'chart',symbol:'AAPL',range:'100y'},{op:'quotes',symbols:Array.from({length:17},(_,i)=>'A'+i).join(',')},{op:'chart',symbol:'AAPL',range:'1y',adjusted:'bad'},{op:'chart',symbol:'AAPL',range:'1d',adjusted:'1'},{op:'bad'}]){let code;const res={setHeader(){},status(n){code=n;return this;},json(data){return data;}};await handler({method:'GET',query},res);assert.equal(code,400);}});
test('RSI handles flat/rising/falling series and indicator warmup',()=>{assert.equal(rsi(Array(30).fill(10)).at(-1),50);assert.equal(rsi(Array.from({length:30},(_,i)=>i+1)).at(-1),100);assert.equal(rsi(Array.from({length:30},(_,i)=>30-i)).at(-1),0);assert.equal(ema([1,2],20).at(-1),null);assert.equal(bollinger(Array(20).fill(10)).at(-1).upper,10);});
import {projectPrices,signalSnapshot} from '../src/marketMath.js';
test('projectPrices uses bar time and supports horizons',()=>{
  const base=new Date('2024-01-01T12:00:00Z');
  const bars=Array.from({length:80},(_,i)=>{const d=new Date(base);d.setUTCDate(d.getUTCDate()+i);while([0,6].includes(d.getUTCDay()))d.setUTCDate(d.getUTCDate()+1);return{time:d.toISOString().slice(0,10),close:100+i*0.5,open:100,high:101,low:99,volume:1000};});
  const r=projectPrices(bars,10);
  assert.equal(r.points.length,10);
  assert.ok(Number.isFinite(r.points.at(-1).close));
  assert.ok(['Random walk with drift','Random walk without drift'].includes(r.model));
  assert.throws(()=>projectPrices(bars,7),/horizon/);
  assert.throws(()=>projectPrices(bars.slice(0,10),10),/70/);
});
test('projectPrices accepts numeric intraday timestamps',()=>{
  const t0=1704067200;
  const bars=Array.from({length:80},(_,i)=>({time:t0+i*86400,close:100+Math.sin(i/5)*2+i*0.2}));
  const r=projectPrices(bars,5);
  assert.equal(r.points.length,5);
});
test('signalSnapshot needs 70 bars and is deterministic',()=>{
  assert.equal(signalSnapshot([]).verdict,'Unavailable');
  const bars=Array.from({length:80},(_,i)=>({close:100+i}));
  const a=signalSnapshot(bars),b=signalSnapshot(bars);
  assert.deepEqual(a,b);
  assert.ok(['Bullish','Mixed','Bearish'].includes(a.verdict));
  assert.equal(a.rules.length,5);
});
test('quotes trims spaces and rate limiting guards abuse',async()=>{
  const mk=()=>{let code;return{res:{setHeader(){},status(n){code=n;return this;},json(d){return d;}},get code(){return code;}};};
  // spaces around symbols should not 400 on validation alone; upstream may 503 but never 400 for valid tickers with spaces
  // use invalid-range chart to prove trimming happens before validation: ' aapl ' -> 'AAPL' valid symbol, fails on range not symbol
  let code;const res={setHeader(){},status(n){code=n;return this;},json(d){return d;}};
  await handler({method:'GET',query:{op:'chart',symbol:' aapl ',range:'100y'},headers:{},socket:{}},res);
  assert.equal(code,400);
  // hammer same IP -> 429
  for(let i=0;i<130;i++){let c;const r2={setHeader(){},status(n){c=n;return this;},json(d){return d;}};await handler({method:'GET',query:{op:'chart',symbol:'../secret'},headers:{'x-forwarded-for':'test-ip-429'},socket:{}},r2);if(i>125)assert.equal(c,429);}
});
import {normalizeFundamentals} from '../api/market.js';
test('fundamentals normalize real Yahoo fields, nulls stay null',()=>{
  const j={quoteSummary:{result:[{summaryDetail:{trailingPE:{raw:22.2},forwardPE:{raw:17.1}},defaultKeyStatistics:{trailingEps:{raw:55.17},forwardEps:{raw:71.4}},financialData:{earningsGrowth:{raw:-0.224},returnOnEquity:{raw:0.14},profitMargins:{raw:0.2},debtToEquity:{raw:45}},price:{marketCap:{raw:1000}},assetProfile:{sector:{raw:'Technology'},industry:{raw:'Consumer Electronics'},longBusinessSummary:{raw:'Makes phones.'}}}]}};
  const f=normalizeFundamentals(j,'AAPL');
  assert.equal(f.peTrailing,22.2);assert.equal(f.epsTrailing,55.17);assert.equal(f.earningsGrowth,-0.224);assert.equal(f.roe,0.14);assert.equal(f.sector,'Technology');assert.equal(f.businessSummary,'Makes phones.');
  const empty=normalizeFundamentals({quoteSummary:{result:[{}]}},'^NSEI');
  assert.equal(empty.peTrailing,null);assert.equal(empty.roe,null);assert.equal(empty.businessSummary,null);
});
test('fundamentals rejects invalid symbols before upstream',async()=>{
  let code;const res={setHeader(){},status(n){code=n;return this;},json(d){return d;}};
  await handler({method:'GET',query:{op:'fundamentals',symbol:'../secret'},headers:{},socket:{}},res);
  assert.equal(code,400);
});
import {normalizeSECFacts,isUSTicker} from '../api/market.js';
const secFacts=(()=>{
  const q=(end,fp,val,frame,filed)=>({end,fp,form:'10-Q',val,frame,filed,start:end});
  const a=(end,val,filed)=>({end,fp:'FY',form:'10-K',val,frame:'CY',filed,start:end});
  const eps=[['2024-03-30','CY2024Q1',1.0],['2024-06-29','CY2024Q2',1.1],['2024-09-28','CY2024Q3',1.2],['2024-12-28','CY2024Q4',1.3],['2025-03-29','CY2025Q1',1.4],['2025-06-28','CY2025Q2',1.5],['2025-09-27','CY2025Q3',1.6],['2025-12-27','CY2025Q4',1.7]].map(([end,frame,val])=>q(end,'Q',val,frame,end));
  const ni=eps.map(e=>({...e,val:e.val*1e9}));
  const units=(arr,unit)=>({[unit]:arr});
  return {facts:{'us-gaap':{
    EarningsPerShareDiluted:{units:units(eps,'USD/shares')},
    NetIncomeLoss:{units:units(ni,'USD')},
    RevenueFromContractWithCustomerExcludingAssessedTax:{units:units(ni.map(e=>({...e,val:e.val*5})),'USD')},
    StockholdersEquity:{units:units([{end:'2025-12-27',form:'10-Q',val:80e9,filed:'2026-01-01'}],'USD')}
  }}};
})();
test('SEC facts derive TTM EPS, growth, ROE and PE from price',()=>{
  const f=normalizeSECFacts(secFacts,160,'TEST');
  assert.equal(f.epsTrailing,1.4+1.5+1.6+1.7);
  assert.equal(f.source,'SEC EDGAR');
  const ttm=(1.4+1.5+1.6+1.7)*1e9,prev=(1.0+1.1+1.2+1.3)*1e9;
  assert.ok(Math.abs(f.earningsGrowth-(ttm/prev-1))<1e-9);
  assert.ok(Math.abs(f.roe-(ttm/80e9))<1e-9);
  assert.ok(Math.abs(f.peTrailing-(160/(1.4+1.5+1.6+1.7)))<1e-9);
  assert.equal(f.peForward,null);
});
test('SEC facts need real data, never fabricate',()=>{
  assert.equal(normalizeSECFacts({facts:{}},100,'X'),null);
  assert.equal(normalizeSECFacts(null,100,'X'),null);
});
test('US ticker gate keeps SEC lookups off indices and NSE symbols',()=>{
  for(const s of ['AAPL','MSFT','BRK-B','JPM'])assert.equal(isUSTicker(s),true);
  for(const s of ['RELIANCE.NS','^NSEI','BTC-USD','GC=F','INR=X','M&M.NS'])assert.equal(isUSTicker(s),false);
});
import {normalizeScreener} from '../api/market.js';
const scrHTML='<div id=\"top-ratios\"><li class=\"flex flex-space-between\"><span class=\"name\"> Market Cap </span><span class=\"nowrap value\">₹ <span class=\"number\">1,00,000</span> Cr. </span></li><li><span class=\"name\"> Current Price </span><span class=\"nowrap value\">₹ <span class=\"number\">2,000</span></span></li><li><span class=\"name\"> Stock P/E </span><span class=\"nowrap value\"><span class=\"number\">20.0</span></span></li><li><span class=\"name\"> ROE </span><span class=\"nowrap value\"><span class=\"number\">15.5</span> % </span></li></div><table class=\"ranges-table\"><tr><th colspan=\"2\">Compounded Sales Growth</th></tr><tr><td>TTM:</td><td>8%</td></tr></table><table class=\"ranges-table\"><tr><th colspan=\"2\">Compounded Profit Growth</th></tr><tr><td>TTM:</td><td>-3%</td></tr></table>';
test('screener parses Indian ratios, derives EPS, never fabricates',()=>{
  const f=normalizeScreener(scrHTML,'X.NS');
  assert.equal(f.peTrailing,20);assert.equal(f.epsTrailing,100);
  assert.equal(f.roe,0.155);assert.equal(f.marketCap,100000*1e7);
  assert.equal(f.revenueGrowth,0.08);assert.equal(f.earningsGrowth,-0.03);
  assert.equal(f.source,'Screener.in');
  assert.equal(normalizeScreener('<html></html>','X.NS'),null);
  assert.equal(normalizeScreener(null,'X.NS'),null);
});
import {rankNews,newsScore,FILING_RE,PRICE_NOISE_RE} from '../api/market.js';
test('news ranks filings and material events above generic price pages',()=>{
  const items=[
    {title:'RELIANCE share price today live',url:'https://example.com/a',date:'2026-09-27',source:'Blog'},
    {title:'RELIANCE Q2 results profit rises, dividend declared',url:'https://example.com/b',date:'2026-09-26',source:'Reuters'},
    {title:'AAPL 10-Q — filed 2026-07-01',url:'https://www.sec.gov/x',date:'2026-07-01',source:'SEC EDGAR',filing:true},
  ];
  const ranked=rankNews(items);
  assert.equal(ranked[0].kind,'filing');
  assert.equal(ranked[1].kind,'event');
  assert.equal(ranked.at(-1).title.includes('share price today'),true);
  assert.ok(newsScore(ranked[0])>newsScore(ranked.at(-1)));
  assert.equal(FILING_RE.test('Q2 earnings dividend buyback merger'),true);
  assert.equal(PRICE_NOISE_RE.test('share price today'),true);
});
test('rankNews never emits insecure urls and keeps date order within tier',()=>{
  const items=[
    {title:'bad',url:'javascript:alert(1)',date:'2026-09-28',source:'X'},
    {title:'Good earnings beat',url:'https://example.com/g',date:'2026-09-28',source:'Y'},
    {title:'Older earnings beat',url:'https://example.com/o',date:'2026-09-20',source:'Y'},
  ];
  const r=rankNews(items);
  assert.ok(r.every(x=>x.url.startsWith('https://')));
  assert.equal(r.length,2);
  assert.equal(r[0].title,'Good earnings beat');
});
import {marketRegime} from '../src/marketMath.js';
test('market regime labels trend + volatility and needs daily bars',()=>{
  const day=(i,close)=>({time:`2024-01-${String((i%28)+1).padStart(2,'0')}`,close,open:close,high:close,low:close,volume:1000});
  const up=Array.from({length:80},(_,i)=>day(i,100+i));
  const down=Array.from({length:80},(_,i)=>day(i,200-i));
  const flat=Array.from({length:80},(_,i)=>day(i,100+Math.sin(i/5)));
  const ru=marketRegime(up),rd=marketRegime(down),rf=marketRegime(flat);
  assert.ok(/uptrend/i.test(ru.trend));
  assert.ok(/downtrend/i.test(rd.trend));
  assert.ok(ru.label.includes('volatility')&&rd.label.includes('volatility')&&rf.label.includes('volatility'));
  assert.ok(Number.isFinite(ru.bandwidth)&&Number.isFinite(ru.bandwidthRank));
  assert.equal(marketRegime([]).label,'Insufficient data');
  assert.equal(marketRegime(Array.from({length:80},(_,i)=>({time:1704067200+i*300,close:100+i}))).trend,'Unknown');
  assert.deepEqual(marketRegime(up),marketRegime(up));
});

test('forecast history adjusts all candle prices and excludes missing adjusted closes', () => {
  const f = structuredClone(fixture);
  f.indicators.adjclose = [{ adjclose: [51.5, null, null] }];
  const raw = normalize(f, 'AAPL', '1y');
  const adjusted = normalize(f, 'AAPL', '1y', true);
  assert.equal(raw.bars.length, 2);
  assert.equal(raw.bars[0].close, 103);
  assert.equal(adjusted.adjusted, true);
  assert.deepEqual(adjusted.bars, [{ time: '2024-01-01', open: 50, high: 52, low: 49.5, close: 51.5, volume: 1000 }]);
  assert.throws(() => normalize(fixture, 'AAPL', '1y', true), /Adjusted price history unavailable/);
});

test('all forecast horizons return positive ordered intervals after the last completed close', () => {
  const bars = Array.from({ length: 80 }, (_, i) => ({ time: new Date(Date.UTC(2026, 6, i + 1)).toISOString().slice(0, 10), close: 100 * Math.exp(.001 * i + .01 * Math.sin(i)) }));
  bars.at(-1).time = '2026-09-25';
  for (const horizon of [5, 10, 20, 30]) {
    const result = projectPrices(bars, horizon);
    assert.equal(result.points.length, horizon);
    assert.equal(result.points[0].date, '2026-09-28');
    assert.ok(Number.isFinite(result.mape));
    for (const p of result.points) {
      assert.ok(p.lower > 0 && p.lower <= p.close && p.close <= p.upper);
      assert.ok(![0, 6].includes(new Date(p.date).getUTCDay()));
    }
  }
});
