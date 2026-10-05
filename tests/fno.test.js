import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { unzipFirst, parseFo, optionChain, maxPain, buildup, futuresBuildup, parseParticipants, participantView, parseFiiDii, parseDeals, csvLine, underlyings } from '../lib/fno.js';
import { parseIndices, rrg, quadrant } from '../lib/indices.js';
import { screenMetrics } from '../lib/nse.js';
import { dcf, impliedGrowth, marginOfSafety, defaultInputs } from '../src/valuation.js';
import { PRESETS, runScreen } from '../src/screens.js';
import handler from '../api/market.js';

// Minimal single-entry zip (deflated), laid out the way NSE's archives are.
function zip(name, text) {
  const data = deflateRawSync(Buffer.from(text)), n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(text.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(0, 42);
  const cdOff = local.length + n.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length + n.length, 12); end.writeUInt32LE(cdOff, 16);
  return Buffer.concat([local, n, data, cd, n, end]);
}

const HEAD = 'TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4';
const row = (tp, sym, exp, strike, type, close, prev, und, oi, chg, vol, lot = 50) => `2026-09-30,2026-09-30,FO,NSE,${tp},1,,${sym},,${exp},${exp},${strike},${type},X,0,0,0,${close},0,${prev},${und},0,${oi * lot},${chg * lot},${vol * lot},0,0,F1,${lot},,,,,`;
const CSV = [HEAD,
  row('IDO', 'NIFTY', '2026-10-06', '22400.00', 'CE', 120, 100, 22420, 100, 20, 500),
  row('IDO', 'NIFTY', '2026-10-06', '22400.00', 'PE', 100, 110, 22420, 80, 10, 400),
  row('IDO', 'NIFTY', '2026-10-06', '22500.00', 'CE', 70, 60, 22420, 300, 50, 900),
  row('IDO', 'NIFTY', '2026-10-06', '22300.00', 'PE', 60, 70, 22420, 250, 40, 700),
  row('IDO', 'NIFTY', '2026-10-13', '22400.00', 'CE', 200, 190, 22420, 10, 1, 5),
  row('IDO', 'NIFTY', '2026-09-29', '22400.00', 'CE', 1, 1, 22420, 0, 0, 0),
  row('IDF', 'NIFTY', '2026-10-27', '', '', 22500, 22400, 22420, 1000, 100, 50),
  row('STF', 'ABC', '2026-10-27', '', '', 95, 100, 94, 500, 50, 20, 100),
  row('STF', 'ABC', '2026-11-23', '', '', 96, 101, 94, 100, -20, 2, 100),
].join('\n');

test('unzipFirst reads a deflated single-file archive and rejects junk', () => {
  assert.equal(unzipFirst(zip('a.csv', CSV)), CSV);
  assert.throws(() => unzipFirst(Buffer.from('not a zip at all, definitely not')), /zip/);
});

test('parseFo converts shares to contracts and groups chains by expiry', () => {
  const fo = parseFo(CSV);
  assert.equal(fo.date, '2026-09-30');
  assert.equal(fo.spot.get('NIFTY'), 22420);
  const chain = fo.options.get('NIFTY').get('2026-10-06');
  assert.equal(chain.get(22400).CE.oi, 100);
  assert.equal(chain.get(22400).PE.chg, 10);
  assert.equal(parseFo('a,b\n1,2'), null);
});

test('optionChain: PCR, walls, max pain, straddle and expired expiries dropped', () => {
  const c = optionChain(parseFo(CSV), 'NIFTY');
  assert.deepEqual(c.expiries, ['2026-10-06', '2026-10-13']);
  assert.equal(c.expiry, '2026-10-06');
  assert.equal(c.atm, 22400);
  assert.equal(c.pcr, Math.round(330 / 400 * 100) / 100);
  assert.equal(c.callWall, 22500);
  assert.equal(c.putWall, 22300);
  assert.equal(c.straddle, 220);
  assert.equal(c.daysToExpiry, 6);
  assert.equal(optionChain(parseFo(CSV), 'NIFTY', '2026-10-13').expiry, '2026-10-13');
  assert.equal(optionChain(parseFo(CSV), 'NOPE'), null);
  assert.deepEqual(underlyings(parseFo(CSV)), ['NIFTY']);
});

test('maxPain picks the strike with least writer payout', () => {
  const rows = [{ strike: 90, PE: { oi: 100 } }, { strike: 100, CE: { oi: 10 }, PE: { oi: 10 } }, { strike: 110, CE: { oi: 100 } }];
  assert.equal(maxPain(rows), 100);
});

test('futures build-up sums OI across expiries and classifies the four cases', () => {
  assert.equal(buildup(1, 2), 'Long build-up');
  assert.equal(buildup(-1, 2), 'Short build-up');
  assert.equal(buildup(1, -2), 'Short covering');
  assert.equal(buildup(-1, -2), 'Long unwinding');
  assert.equal(buildup(null, 2), 'Neutral');
  const f = futuresBuildup(parseFo(CSV));
  const abc = f.rows.find(r => r.symbol === 'ABC');
  assert.equal(abc.oi, 600);
  assert.equal(abc.oiChg, 30);
  assert.equal(abc.expiry, '2026-10-27');
  assert.equal(abc.signal, 'Short build-up');
  assert.equal(f.rows.find(r => r.symbol === 'NIFTY').index, true);
});

const POI = `"Participant wise Open Interest (no. of contracts) in Equity Derivatives as on Sep 30, 2026",,,
Client Type,Future Index Long,Future Index Short,Future Stock Long,Future Stock Short       ,Option Index Call Long,Option Index Put Long,Option Index Call Short,Option Index Put Short,Option Stock Call Long,Option Stock Put Long,Option Stock Call Short,Option Stock Put Short,Total Long Contracts      ,Total Short Contracts
Client,300,60,3400,150,3300,1900,2900,2800,1300,500,700,800,10900,7500
DII,50,20,240,4500,8,40,2,0,2,40,170,20,390,4700
FII,30,310,3300,2800,460,1000,930,360,90,190,170,70,5100,4700
Pro,35,26,820,300,1050,780,1020,660,590,750,920,610,4050,3560
TOTAL,415,415,7886,7886,4862,3849,4862,3849,2057,1537,2057,1537,20608,20608`;
test('participant OI parses four groups and nets positions with day change', () => {
  const p = parseParticipants(POI);
  assert.equal(p.FII.futIdxShort, 310);
  assert.equal(parseParticipants('junk'), null);
  const prev = structuredClone(p); prev.FII.futIdxShort = 300;
  const v = participantView(p, prev);
  assert.equal(v.FII.futIdx, -280);
  assert.equal(v.FII.change.futIdx, -10);
  assert.equal(v.FII.futIdxLongPct, Math.round(30 / 340 * 10000) / 100);
  assert.equal(participantView(p).DII.change, null);
});

test('FII/DII cash parsing requires both categories', () => {
  const d = parseFiiDii([{ buyValue: '25420.04', category: 'DII', date: '01-Oct-2026', netValue: '10041.84', sellValue: '15378.2' }, { buyValue: '12260.26', category: 'FII/FPI', date: '01-Oct-2026', netValue: '-9484.22', sellValue: '21744.48' }]);
  assert.equal(d.date, '2026-10-01');
  assert.equal(d.fii.net, -9484.22);
  assert.equal(d.dii.buy, 25420.04);
  assert.equal(parseFiiDii([{ category: 'DII', netValue: '1' }]), null);
  assert.equal(parseFiiDii({}), null);
});

test('deal files parse quoted client names and skip malformed rows', () => {
  assert.deepEqual(csvLine('a,"b, c",d'), ['a', 'b, c', 'd']);
  const rows = parseDeals('Date,Symbol,Security Name,Client Name,Buy/Sell,Quantity Traded,Trade Price / Wght. Avg. Price,Remarks\n01-OCT-2026,ABC,Abc Ltd,"FUND, LLP",BUY,350000,116.75,-\n01-OCT-2026,XYZ,Xyz,Someone,HOLD,1,1,-\nbad', 'Bulk');
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0] }, { kind: 'Bulk', date: '2026-10-01', symbol: 'ABC', name: 'Abc Ltd', client: 'FUND, LLP', side: 'BUY', qty: 350000, price: 116.75, valueCr: 4.09 });
});

test('index archive parsing and RRG quadrants', () => {
  const d = parseIndices('Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield\nNifty 50,30-09-2026,1,1,1,22620.45,-95.75,-.42,1,1,19.36,2.78,1.22\nIndia VIX,30-09-2026,1,1,1,12,0,0,-,-,-,-,-');
  assert.equal(d.date, '2026-09-30');
  assert.deepEqual(d.rows.get('nifty 50'), { close: 22620.45, change: -0.42, pe: 19.36, pb: 2.78, dy: 1.22 });
  assert.equal(d.rows.get('india vix').pe, null);
  const bench = Array.from({ length: 26 }, () => 100);
  const rising = Array.from({ length: 26 }, (_, i) => 100 * 1.01 ** i);
  const trail = rrg(rising, bench);
  assert.equal(trail.length, 6);
  assert.ok(trail.at(-1).x > 100);
  assert.equal(quadrant(trail.at(-1)), trail.at(-1).y >= 100 ? 'Leading' : 'Weakening');
  assert.deepEqual(rrg(rising.slice(0, 10), bench), []);
  assert.equal(quadrant({ x: 99, y: 101 }), 'Improving');
  assert.equal(quadrant({ x: 99, y: 99 }), 'Lagging');
});

test('Minervini trend template needs a full stage-2 structure', () => {
  const up = Array.from({ length: 250 }, (_, i) => 100 + i);
  assert.equal(screenMetrics(up, null, 0).trendTemplate, true);
  const down = Array.from({ length: 250 }, (_, i) => 400 - i);
  assert.equal(screenMetrics(down, null, 0).trendTemplate, false);
  assert.equal(screenMetrics(up.slice(0, 100), null, 0).trendTemplate, null);
  const preset = PRESETS.find(p => p.id === 'minervini');
  assert.deepEqual(runScreen([{ trendTemplate: true, score: 80 }, { trendTemplate: true, score: 50 }, { trendTemplate: false, score: 90 }], preset).length, 1);
});

test('DCF, margin of safety and implied growth are consistent', () => {
  const inputs = { eps: 10, growth: 10, years: 10, terminal: 4, terminalYears: 10, discount: 12 };
  const v = dcf(inputs);
  assert.ok(v.fair > 100 && v.fair < 250);
  assert.ok(Math.abs(v.fair - v.growthValue - v.terminalValue) < 1e-9);
  assert.equal(dcf({ ...inputs, eps: -1 }), null);
  assert.equal(dcf({ ...inputs, eps: 'x' }), null);
  assert.ok(Math.abs(marginOfSafety(200, 150) - 25) < 1e-9);
  const g = impliedGrowth(v.fair, inputs);
  assert.ok(Math.abs(g - 10) < 1e-6);
  assert.equal(impliedGrowth(1e9, inputs), null);
  assert.deepEqual(defaultInputs({ epsTrailing: 12.345, earningsGrowth: 0.5 }, 'INR'), { eps: 12.35, growth: 20, years: 10, terminal: 5, terminalYears: 10, discount: 12 });
  assert.equal(defaultInputs({}, 'USD').growth, 10);
});

test('new market ops validate input before any upstream fetch', async () => {
  for (const query of [{ op: 'options', symbol: '../x' }, { op: 'options', symbol: 'NIFTY', expiry: 'soon' }]) {
    let code; const res = { setHeader() {}, status(n) { code = n; return this; }, json(d) { return d; } };
    await handler({ method: 'GET', query, headers: {} }, res);
    assert.equal(code, 400);
  }
});
