import test from 'node:test';
import assert from 'node:assert/strict';
import { screenChart } from '../src/screenerChartMath.js';

const bar = (time, open, high, low, close) => ({time, open, high, low, close});
const daily = Array.from({length:260}, (_, i) => bar(new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),100+i,105+i,98+i,102+i));

test('daily candlestick snapshots retain actual OHLC and use highs/lows for scaling', () => {
  for (const [range, count] of [['1M',22],['3M',64]]) {
    const chart = screenChart(daily, range);
    assert.equal(chart.sessions, count);
    assert.equal(chart.candles.length, count);
    assert.equal(chart.interval, 'Daily');
    assert.equal(chart.candles[0].open, daily.at(-count).open);
    assert.equal(chart.candles.at(-1).close, daily.at(-1).close);
    assert.equal(chart.low, daily.at(-count).low);
    assert.equal(chart.high, daily.at(-1).high);
    assert.equal(chart.change, (daily.at(-1).close/daily.at(-count).close-1)*100);
    assert.equal(chart.candles[0].lowY, 70);
    assert.equal(chart.candles.at(-1).highY, 6);
  }
});

test('yearly chart combines real sessions by calendar week with correct OHLC', () => {
  const bars = [bar('2026-09-21',100,108,97,104),bar('2026-09-23',104,115,101,112),bar('2026-09-25',112,114,96,98),bar('2026-09-28',99,105,95,103)];
  const chart = screenChart(bars,'1Y');
  assert.equal(chart.sessions,4);
  assert.equal(chart.interval,'Weekly');
  assert.equal(chart.candles.length,2);
  assert.deepEqual(['open','high','low','close'].map(k=>chart.candles[0][k]),[100,115,96,98]);
  assert.equal(chart.candles[0].end,'2026-09-25');
  assert.equal(screenChart(daily,'1Y').sessions,252);
});

test('missing OHLC never becomes fabricated candles; flat and down candles stay valid', () => {
  assert.equal(screenChart([100,110]),null);
  assert.equal(screenChart([bar('2026-09-21',100,101,99,null)]),null);
  assert.equal(screenChart([bar('2026-09-21',100,90,99,101)]),null);
  assert.equal(screenChart(undefined),null);
  const flat = screenChart([bar('2026-09-21',100,100,100,100)]);
  assert.equal(flat.candles[0].bodyHeight,.8);
  assert.equal(flat.candles[0].highY,38);
  const down = screenChart([bar('2026-09-21',100,105,85,90)]);
  assert.equal(down.change,0);
  assert.ok(down.candles[0].openY < down.candles[0].closeY);
});
