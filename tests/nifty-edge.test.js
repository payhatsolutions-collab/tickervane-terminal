import test from 'node:test';
import assert from 'node:assert/strict';
import { updateJournal } from '../public/nifty-edge/journal.js';
const snapshot = (extra={}) => ({quotes_fresh:true, data_time:'2026-10-30T10:00+05:30', generated:'2026-10-30T10:00+05:30',
  levels:{spark:{dates:['2026-10-30'], close:[110]}},
  rec:{action:'TRADE', expiry:'30-Oct-2026', structure:'bull_call_debit', iv_rv:1.1,
    legs:[{right:'CE', qty:1, strike:100, price:4}], metrics:{credit:-4,max_loss:4}}, ...extra});
test('paper journal never records stale or closed-session quotes',()=>{
  assert.deepEqual(updateJournal([],snapshot({quotes_fresh:false})),[]);
});
test('paper journal records only the first fresh call per session',()=>{
  const first=updateJournal([],snapshot());
  assert.equal(updateJournal(first,snapshot()).length,1);
  assert.equal(first[0].status,'open');
});
test('paper settlement waits until after expiry day and deducts all modelled costs',()=>{
  const first=updateJournal([],snapshot());
  const settled=updateJournal(first,snapshot({quotes_fresh:false,generated:'2026-10-31T10:00+05:30'}));
  assert.equal(first[0].status,'open');
  assert.equal(settled[0].status,'settled');
  assert.ok(Math.abs(settled[0].pnl_pts-(6-0.75-0.008-0.0125))<1e-10);
});
test('missing expiry close leaves a paper position open',()=>{
  const first=updateJournal([],snapshot());
  const after=snapshot({quotes_fresh:false,generated:'2026-11-01T10:00+05:30',levels:{spark:{dates:[],close:[]}}});
  assert.equal(updateJournal(first,after)[0].status,'open');
});
