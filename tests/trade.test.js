import test from 'node:test';
import assert from 'node:assert/strict';
import {sizeTrade,tradeOutcome,completedDailyBars,dailyLevels,validJournalEntry} from '../src/tradeMath.js';
import {companyNews} from '../api/market.js';
const input={capital:100000,riskPct:1,entry:100,stop:95,target:110,costs:100,side:'long'};
test('position size reserves costs and does not exceed risk or capital',()=>{
 const p=sizeTrade(input);assert.equal(p.quantity,180);assert.equal(p.plannedRisk,1000);assert.equal(p.plannedReward,1700);assert.equal(p.rr,1.7);
 const c=sizeTrade({...input,capital:1000,riskPct:50,costs:10});assert.equal(c.quantity,9);assert.equal(c.cashLimited,true);assert.ok(c.notional+10<=1000);
});
test('short sizing and outcomes reverse direction and subtract costs once',()=>{
 const p=sizeTrade({...input,side:'short',stop:105,target:90});assert.equal(p.quantity,180);
 const t={...input,...p,side:'short'};assert.deepEqual(tradeOutcome(t,90,100),{gross:1800,net:1700,r:1.7});assert.equal(tradeOutcome(t,105,100).r,-1);
});
test('bad prices, inverted levels, insufficient budgets and excessive costs fail closed',()=>{
 for(const patch of [{entry:NaN},{capital:Infinity},{stop:100},{stop:101},{target:90},{riskPct:0},{riskPct:101},{costs:-1},{capital:10},{costs:2000},{side:'wrong'}])assert.ok(sizeTrade({...input,...patch}).error);
 assert.equal(tradeOutcome({...input,quantity:5},-1),null);
});
test('daily reference bars exclude today in the exchange timezone and numeric intraday data',()=>{
 const bars=[{time:'2026-09-28'},{time:'2026-09-29'},{time:1790600000}];
 assert.deepEqual(completedDailyBars(bars,'Asia/Kolkata',new Date('2026-09-28T20:00:00Z')),[bars[0]]);
 assert.deepEqual(completedDailyBars(bars,'America/New_York',new Date('2026-09-28T20:00:00Z')),[]);
});
test('ATR includes gaps and levels use the last 20 completed sessions',()=>{
 const bars=Array.from({length:25},(_,i)=>({time:`2026-08-${String(i+1).padStart(2,'0')}`,high:102,low:98,close:100}));
 assert.equal(dailyLevels(bars).atr,4);bars.at(-1).high=112;bars.at(-1).low=108;bars.at(-1).close=110;
 const l=dailyLevels(bars);assert.equal(l.high20,112);assert.equal(l.low20,98);assert.ok(Math.abs(l.atr-(4*13+12)/14)<1e-8);assert.equal(dailyLevels(bars.slice(0,5)),null);
});
test('journal restore validates plans and closed outcomes',()=>{
 const t={...input,...sizeTrade(input),id:'one',symbol:'TEST.NS',currency:'INR',status:'planned'};assert.ok(validJournalEntry(t));assert.equal(validJournalEntry({...t,status:'closed'}),false);assert.ok(validJournalEntry({...t,status:'closed',exit:110,fees:10}));assert.equal(validJournalEntry({...t,quantity:-1}),false);
});
test('NSE company news excludes unrelated event headlines before ranking',()=>{
 const items=[{title:'3 Great Australian Dividend Stocks'},{title:'Reliance Industries announces results'},{title:'RELIANCE shares down'},{title:'Reliances on others grows'}];
 assert.deepEqual(companyNews(items,'RELIANCE.NS','Reliance Industries Limited'),items.slice(1,3));assert.deepEqual(companyNews(items,'^NSEI'),items);
});

import {buildBackup,parseBackup} from '../src/backup.js';
test('version 4 backup round-trips journal and keeps older backup journal absent',()=>{
 const t={...input,...sizeTrade(input),id:'one',symbol:'TEST.NS',currency:'INR',status:'closed',exit:110,fees:100};
 const backup=buildBackup({symbol:'TEST.NS',watch:['TEST.NS'],positions:[],alerts:[],journal:[t]});
 assert.equal(backup.version,4);assert.deepEqual(parseBackup(JSON.stringify(backup)).journal,[t]);
 assert.equal(parseBackup({watch:[],positions:[],alerts:[]}).journal,null);
 assert.deepEqual(parseBackup({...backup,data:{...backup.data,journal:[]}}).journal,[]);
 assert.deepEqual(parseBackup({...backup,data:{...backup.data,journal:[{bad:true}]}}).journal,[]);
});
test('US company news filters unrelated company events',()=>{
 const items=[{title:'Conagra earnings report'},{title:'Nvidia releases earnings'},{title:'NVDA shares climb'}];
 assert.deepEqual(companyNews(items,'NVDA','NVIDIA'),items.slice(1));
});
import {pivots,indianCharges,planTrade,journalStats} from '../src/tradeMath.js';
import {vwap,nseSession,breadth,vixRead} from '../src/marketMath.js';
test('pivots and CPR follow the classic floor formulas',()=>{
 const p=pivots({high:110,low:90,close:105});
 assert.ok(Math.abs(p.pivot-101.6667)<1e-3);assert.ok(Math.abs(p.r1-113.3333)<1e-3);assert.ok(Math.abs(p.s1-93.3333)<1e-3);
 assert.equal(p.bc,100);assert.ok(Math.abs(p.tc-103.3333)<1e-3);assert.ok(p.tc>=p.bc);assert.deepEqual(pivots({high:1,low:2,close:1}),{});
});
test('Indian charges: delivery STT both sides plus DP, intraday sell-side STT and capped brokerage',()=>{
 const d=indianCharges({product:'delivery',quantity:100,buy:1000,sell:1100,brokerage:0});
 assert.ok(Math.abs(d.stt-210)<1e-9);assert.ok(Math.abs(d.stamp-15)<1e-9);assert.equal(d.dp,15.93);assert.ok(d.total>d.stt+d.stamp+d.dp);
 const i=indianCharges({product:'intraday',quantity:10,buy:100,sell:101,brokerage:20});
 assert.ok(Math.abs(i.brokerage-(1000*0.0003+1010*0.0003))<1e-9);assert.ok(Math.abs(i.stt-1010*0.00025)<1e-9);assert.equal(i.dp,0);
 assert.equal(indianCharges({product:'futures',quantity:1,buy:1,sell:1}),null);assert.equal(indianCharges({quantity:0,buy:1,sell:1}),null);
});
test('planTrade keeps loss at stop inside the budget including charges',()=>{
 const base={capital:500000,riskPct:1,entry:1000,stop:980,target:1060,side:'long',brokerage:20,slippage:0};
 for(const product of ['delivery','intraday']){
  const p=planTrade({...base,product});assert.ok(!p.error,p.error);assert.ok(p.plannedRisk<=5000+1e-9);
  const next=planTrade({...base,product,capital:500000});assert.equal(next.quantity,p.quantity);
  const worse=indianCharges({product,quantity:p.quantity+1,buy:1000,sell:980,brokerage:20}).total+(p.quantity+1)*20;assert.ok(worse>5000);
 }
 const s=planTrade({...base,product:'intraday',side:'short',stop:1020,target:940});assert.ok(!s.error);assert.ok(s.plannedRisk<=5000);
 assert.ok(planTrade({...base,product:'delivery',capital:1000}).error);
 assert.equal(planTrade({...base,product:'manual',costs:100}).quantity,sizeTrade({...base,costs:100}).quantity);
});
test('journal stats compute expectancy, profit factor, streaks and drawdown in R',()=>{
 const mk=(exit,i)=>({status:'closed',side:'long',entry:100,quantity:10,plannedRisk:100,exit,fees:0,closedAt:new Date(2026,0,i+1).toISOString()});
 const s=journalStats([mk(120,0),mk(90,1),mk(90,2),mk(110,3),{status:'open'}]);
 assert.equal(s.trades,4);assert.equal(s.winRate,50);assert.equal(s.expectancy,0.25);assert.equal(s.profitFactor,1.5);assert.equal(s.maxLossStreak,2);assert.equal(s.maxDrawdown,2);
 assert.equal(journalStats([]),null);
});
test('VWAP resets each IST session and skips zero volume',()=>{
 const t0=Date.UTC(2026,8,28,4,0)/1000,t1=Date.UTC(2026,8,29,4,0)/1000;
 const v=vwap([{time:t0,high:10,low:10,close:10,volume:1},{time:t0+300,high:20,low:20,close:20,volume:1},{time:t1,high:30,low:30,close:30,volume:0},{time:t1+300,high:40,low:40,close:40,volume:2}]);
 assert.deepEqual(v,[10,15,null,40]);
});
test('NSE session uses the IST clock and weekends',()=>{
 assert.equal(nseSession(new Date('2026-09-29T02:55:00Z')).label,'Pre-open in 35m');
 assert.equal(nseSession(new Date('2026-09-29T05:00:00Z')).state,'open');
 assert.equal(nseSession(new Date('2026-09-29T03:35:00Z')).state,'pre');
 assert.equal(nseSession(new Date('2026-10-03T05:00:00Z')).state,'closed');
});
test('breadth counts advances, DMA shares and 52W extremes',()=>{
 const b=breadth([{change:1,above50:true,above200:true,fromHigh:-0.5,fromLow:20},{change:-1,above50:false,above200:null,fromHigh:-30,fromLow:0.5},{change:0,above50:true,above200:true}]);
 assert.equal(b.adv,1);assert.equal(b.dec,1);assert.equal(b.ratio,1);assert.ok(Math.abs(b.above50-66.667)<0.01);assert.equal(b.above200,100);assert.equal(b.nearHigh,1);assert.equal(b.nearLow,1);
 assert.equal(vixRead(22).label,'High');assert.equal(vixRead(11).label,'Low');
});
