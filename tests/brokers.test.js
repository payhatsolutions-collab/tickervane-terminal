import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildBrokerOrder,orderTicket,KITE_BASKET_URL} from '../src/brokers.js';

const plan = {symbol:'RELIANCE.NS',currency:'INR',side:'long',product:'delivery',entry:'1400.25',quantity:7};
test('Publisher basket preserves entry intent and does not submit protective orders',()=>{
  const {order} = buildBrokerOrder(plan);
  assert.deepEqual(order,{variety:'regular',exchange:'NSE',tradingsymbol:'RELIANCE',transaction_type:'BUY',quantity:7,order_type:'LIMIT',price:1400.25,product:'CNC',validity:'DAY',readonly:false});
  assert.match(orderTicket(order,1300,1600),/NOT included/);
  const short = buildBrokerOrder({...plan,side:'short',product:'intraday'}).order;
  assert.equal(short.transaction_type,'SELL');
  assert.equal(short.product,'MIS');
});
test('handoff rejects unsupported instruments, ambiguous products and invalid quantities',()=>{
  for(const patch of [{symbol:'AAPL'},{symbol:'RELIANCE.BO'},{symbol:'FAKE.NS'},{currency:'USD'},{side:'short'},{side:'bad'},{product:'manual'},{quantity:0},{quantity:1.2},{quantity:Infinity},{entry:0},{entry:'NaN'}]) {
    assert.ok(buildBrokerOrder({...plan,...patch}).error,JSON.stringify(patch));
  }
});
test('production policy allows the documented basket destination without remote scripts',()=>{
  const config = JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
  const csp = config.headers.flatMap(x=>x.headers).find(x=>x.key==='Content-Security-Policy').value;
  assert.ok(csp.includes(`form-action 'self' ${new URL(KITE_BASKET_URL).origin}`));
  const scriptSources = csp.split(';').find(part=>part.trim().startsWith('script-src ')).trim().split(/\s+/).slice(1);
  assert.deepEqual(scriptSources, ["'self'"]);
});
