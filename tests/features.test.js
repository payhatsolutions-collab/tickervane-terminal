import test from 'node:test';import assert from 'node:assert/strict';
import{parseBhav,deliveryStats,deliverySignal,buildRadar,screenMetrics}from'../lib/nse.js';
import{PRESETS,matches,cleanScreen,runScreen,describe}from'../src/screens.js';
import pushHandler,{validSubscription,cleanAlerts,mergeAlerts,dueAlerts}from'../api/push.js';

const HEAD='SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER';
const line=(sym,{prev=100,high=105,low=99,close=104,qty=100000,dq=40000,series='EQ',date='25-Sep-2026'}={})=>`${sym}, ${series}, ${date}, ${prev}, ${prev}, ${high}, ${low}, ${close}, ${close}, ${close}, ${qty}, ${(qty*close/1e5).toFixed(2)}, 100, ${dq}, ${(dq/qty*100).toFixed(2)}`;

test('bhavcopy parser keeps validated EQ rows and drops inconsistent delivery',()=>{
  const b=parseBhav([HEAD,line('TCS'),line('ETFX',{series:'BE'}),line('BAD',{dq:200000}),'TCS2, EQ, 25-Sep-2026, x, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1'].join('\n'));
  assert.equal(b.date,'2026-09-25');
  assert.deepEqual([...b.rows.keys()],['TCS','BAD']);
  assert.equal(b.rows.get('TCS').dp,40);
  assert.equal(b.rows.get('BAD').dq,null);
  assert.ok(Math.abs(b.rows.get('TCS').clv-(((104-99)-(105-104))/6))<1e-9);
  assert.equal(parseBhav('nonsense'),null);
});

const sessions=(latest,base,n=20)=>[parseBhav([HEAD,line('RELIANCE',latest)].join('\n')),...Array.from({length:n},()=>parseBhav([HEAD,line('RELIANCE',base)].join('\n')))];
test('delivery stats compare the latest session with a 20-session baseline',()=>{
  const s=deliveryStats(sessions({qty:300000,dq:200000,close:104},{qty:100000,dq:40000}),'RELIANCE');
  assert.equal(s.samples,20);assert.ok(Math.abs(s.delivRatio-5)<1e-9);assert.ok(Math.abs(s.volRatio-3)<1e-9);
  assert.equal(deliverySignal(s),'Accumulation');
  const down=deliveryStats(sessions({qty:300000,dq:200000,close:99.5,high:105,low:99},{qty:100000,dq:40000}),'RELIANCE');
  assert.equal(deliverySignal(down),'Distribution');
  const churn=deliveryStats(sessions({qty:5000000,dq:200000},{qty:100000,dq:40000}),'RELIANCE');
  assert.equal(deliverySignal(churn),'Spike','quantity spike on a collapsing delivery share is not accumulation');
});
test('radar ranks only listed, liquid companies',()=>{
  const r=buildRadar(sessions({qty:300000,dq:200000},{qty:100000,dq:40000}),new Map([['RELIANCE',{name:'Reliance',industry:'Oil'}]]),{minTurnoverCr:1});
  assert.equal(r.rows.length,1);assert.equal(r.rows[0].industry,'Oil');assert.equal(r.rows[0].n500,true);assert.equal(r.counts.Accumulation,1);
  assert.equal(buildRadar(sessions({qty:300000,dq:200000},{qty:100000,dq:40000}),new Map(),{minTurnoverCr:1000}).rows.length,0);
});

test('screen metrics: returns, trend flags and RSI from closes',()=>{
  const closes=Array.from({length:260},(_,i)=>100+i);
  const m=screenMetrics(closes,null,5);
  assert.equal(m.price,359);assert.equal(m.above200,true);assert.equal(m.golden,true);assert.equal(m.rsi,100);assert.equal(m.fromHigh,0);
  assert.ok(Math.abs(m.r1m-(359/338-1)*100)<1e-9);assert.ok(Math.abs(m.rs3m-(m.r3m-5))<1e-9);
  assert.equal(screenMetrics([],{close:10,change:2},null).change,2);
});
test('screens: presets, validation and matching',()=>{
  assert.ok(PRESETS.length>=10);
  const row={score:90,above200:true,rsi:60,industry:'IT'};
  assert.equal(matches(row,PRESETS[0].when),true);
  assert.equal(matches({...row,rsi:null},[['rsi','max',70]]),false,'missing values never pass');
  assert.equal(cleanScreen({id:'x',when:[['evil','min',1],['rsi','max','40'],['above50','is',1]]}).when.length,2);
  assert.equal(cleanScreen({when:[]}),null);
  assert.equal(runScreen([row,{...row,industry:'Bank'}],{when:[['score','min',50]],industry:'IT'}).length,1);
  assert.match(describe([['rsi','max',30],['above200','is',true]]),/RSI 14 ≤ 30 · Above 200 DMA/);
});

const sub={endpoint:'https://fcm.googleapis.com/fcm/send/abc123',keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)}};
test('push subscriptions must point at a real push service',()=>{
  assert.equal(validSubscription(sub),true);
  assert.equal(validSubscription({...sub,endpoint:'https://evil.example.com/fcm.googleapis.com'}),false);
  assert.equal(validSubscription({...sub,endpoint:'http://fcm.googleapis.com/x'}),false);
  assert.equal(validSubscription({...sub,keys:{p256dh:'short',auth:'x'}}),false);
});
test('alerts: cleaning, server-trigger merge and re-arm',()=>{
  const a=cleanAlerts([{id:'1',symbol:'TCS.NS',condition:'above',price:'100',created:1},{id:'2',symbol:'../x',condition:'above',price:1}]);
  assert.equal(a.length,1);assert.equal(a[0].price,100);
  const stored=[{...a[0],triggered:true,triggeredAt:'t'}];
  assert.equal(mergeAlerts(a,stored)[0].triggered,true);
  assert.equal(mergeAlerts([{...a[0],created:2}],stored)[0].triggered,false,'re-armed alert (new created) stays armed');
  assert.deepEqual(dueAlerts(a,{'TCS.NS':{price:101,marketTime:10}}).map(x=>x.id),['1']);
  assert.equal(dueAlerts(a,{'TCS.NS':{price:99,marketTime:10}}).length,0);
  assert.equal(dueAlerts([{...a[0],created:20000}],{'TCS.NS':{price:101,marketTime:10}}).length,0,'quotes older than the alert are ignored');
});
test('push API rejects unauthenticated cron and non-POST writes',async()=>{
  const call=async req=>{let code,body;await pushHandler({headers:{},...req},{setHeader(){},status(n){code=n;return this;},json(d){body=d;return d;}});return{code,body};};
  process.env.CRON_SECRET='s3cret';
  assert.equal((await call({method:'GET',query:{op:'cron'}})).code,401);
  assert.equal((await call({method:'GET',query:{op:'cron'},headers:{authorization:'Bearer wrong'}})).code,401);
  assert.equal((await call({method:'GET',query:{op:'subscribe'}})).code,405);
  const v=await call({method:'GET',query:{op:'vapid'}});assert.equal(v.code,200);assert.equal(typeof v.body.configured,'boolean');
});
