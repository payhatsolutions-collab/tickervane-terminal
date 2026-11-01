import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalize } from '../api/market.js';
import { completedForecastBars } from '../src/forecastHistory.js';
import { projectForecast, scoreForecast, aggregateForecastScores, FORECAST_VERSION } from '../src/forecastModel.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(await readFile(new URL('./forecast-benchmark-config.json', import.meta.url), 'utf8'));
const mode = process.argv[2] || 'development';
const destination = resolve(process.argv[3] || join(root, 'outputs/forecast-accuracy-2026-10-27'));
const sha = text => createHash('sha256').update(text).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const exists = async path => access(path).then(() => true, () => false);
const save = async (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const filename = symbol => encodeURIComponent(symbol) + '.json';
const manifestPath = join(destination, 'manifest.json');
// Fixed pre-change baseline; it remains reproducible after v4 is committed.
const legacyRevision = 'ab21308d0cd8f56f28c4e5ca72c11171be7f988e';
await mkdir(destination, { recursive: true });

if (mode === 'snapshot') {
  if (await exists(manifestPath)) throw new Error('Snapshot already frozen. Use a new output directory for another dataset.');
  for (const [source, target] of [['src/forecastModel.js', 'legacy-model.js'], ['src/forecastCalendar.js', 'forecastCalendar.js']]) {
    const { stdout } = await promisify(execFile)('git', ['show', `${legacyRevision}:${source}`], { cwd: root });
    await writeFile(join(destination, target), stdout);
  }
  const symbols = [...new Set(config.symbols.flatMap(row => [row.symbol, row.market, row.sector]).filter(Boolean))];
  const primary = new Set(config.symbols.map(row => row.symbol));
  const manifest = { createdAt: new Date().toISOString(), config, configSha256: sha(JSON.stringify(config)), legacyRevision,
    source: 'Yahoo Finance v8 chart, 5y adjusted daily observations', files: {}, failures: {} };
  for (const symbol of symbols) {
    let failure;
    for (const host of ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']) {
      try {
        const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d&includePrePost=false&includeAdjustedClose=true`;
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.json();
        if (!raw.chart?.result?.[0]) throw new Error(raw.chart?.error?.description || 'No chart result');
        const data = normalize(raw.chart.result[0], symbol, '5y', true);
        data.bars = completedForecastBars(data);
        if (data.bars.length < config.initialTraining + config.developmentSessions + config.holdoutSessions) throw new Error(`Only ${data.bars.length} completed sessions`);
        const text = JSON.stringify(data);
        await writeFile(join(destination, filename(symbol)), text);
        manifest.files[symbol] = { file: filename(symbol), sha256: sha(text), observations: data.bars.length,
          start: data.bars[0].time, end: data.bars.at(-1).time, host };
        console.log(`${symbol}: ${data.bars.length} sessions`);
        failure = null;
        break;
      } catch (error) { failure = error.message; }
    }
    if (failure) { manifest.failures[symbol] = { error: failure, required: primary.has(symbol) }; console.log(`${symbol}: unavailable (${failure})`); }
  }
  await save(manifestPath, manifest);
  if (Object.values(manifest.failures).some(row => row.required)) throw new Error('Required series missing; snapshot saved with explicit failures. Do not claim full-universe results.');
} else if (['development', 'holdout'].includes(mode)) {
  const manifest = await json(manifestPath);
  if (manifest.configSha256 !== sha(JSON.stringify(config))) throw new Error('Benchmark configuration changed after the snapshot was frozen.');
  const dataset = {};
  for (const [symbol, row] of Object.entries(manifest.files)) {
    const text = await readFile(join(destination, row.file), 'utf8');
    if (sha(text) !== row.sha256) throw new Error(`Snapshot changed: ${symbol}`);
    dataset[symbol] = JSON.parse(text);
  }
  if (config.symbols.some(row => !dataset[row.symbol])) throw new Error('All registered primary series are required.');
  const modelFiles = ['src/forecastModel.js', 'src/forecastRegression.js', 'src/forecastHistory.js', 'scripts/forecast-benchmark-config.json', 'scripts/forecast-benchmark.mjs'];
  const legacyFiles = ['legacy-model.js', 'forecastCalendar.js'];
  const codeSha256 = sha((await Promise.all([...modelFiles.map(path => readFile(join(root, path), 'utf8')), ...legacyFiles.map(path => readFile(join(destination, path), 'utf8'))])).join('\n'));
  if (mode === 'holdout') {
    const lockPath = join(destination, 'holdout-lock.json');
    if (await exists(lockPath)) {
      const lock = await json(lockPath);
      if (lock.codeSha256 !== codeSha256) throw new Error('This holdout was already opened by different code. A new independent period is required for an untouched assessment.');
    } else await save(lockPath, { openedAt: new Date().toISOString(), codeSha256, manifestSha256: sha(JSON.stringify(manifest)) });
  }
  const legacy = await import(pathToFileURL(join(destination, 'legacy-model.js')).href);
  const originalIds = ['baseline', 'ewma', 'garch', 'garch-drift', 'har', 'har-trend'];
  const variants = {
    legacy: (bars, options) => legacy.projectForecast(bars, config.horizon, options),
    alignedOriginalFamily: (bars, options) => projectForecast(bars, config.horizon, { ...options, candidateIds: originalIds }),
    accuracy: (bars, options) => projectForecast(bars, config.horizon, { ...options, experimentalMeans: true }),
    contextExperiment: (bars, options) => projectForecast(bars, config.horizon, { ...options, experimentalContext: true }),
    unchangedPrice: (bars, options) => projectForecast(bars, config.horizon, { ...options, candidateId: 'baseline' }),
    simpleTrend: (bars, options) => projectForecast(bars, config.horizon, { ...options, candidateId: 'trend-30' }),
    directHorizon: (bars, options) => projectForecast(bars, config.horizon, { ...options, candidateId: 'ridge-direct' }),
    directContext: (bars, options) => projectForecast(bars, config.horizon, { ...options, experimentalContext: true, candidateId: 'ridge-context' }),
  };
  const records = [];
  for (const item of config.symbols) {
    const bars = dataset[item.symbol].bars, boundary = bars.length - 1 - config.holdoutSessions;
    const first = mode === 'holdout' ? boundary : Math.max(config.initialTraining, boundary - config.developmentSessions);
    const lastTarget = mode === 'holdout' ? bars.length - 1 : boundary;
    const context = Object.fromEntries(['market', 'sector'].filter(name => dataset[item[name]]).map(name => [name, dataset[item[name]].bars]));
    console.log(`${mode}: ${item.symbol}`);
    for (let origin = first; origin + config.horizon <= lastTarget; origin += config.step) {
      const history = bars.slice(0, origin + 1), actual = Math.log(bars[origin + config.horizon].close / bars[origin].close);
      const recentReturn = Math.log(bars[origin].close / bars[Math.max(0, origin - 60)].close);
      const regime = recentReturn > .02 ? 'rising' : recentReturn < -.02 ? 'falling' : 'sideways';
      const record = { symbol: item.symbol, origin: bars[origin].time, target: bars[origin + config.horizon].time,
        group: item.symbol.endsWith('.NS') ? 'NSE' : item.symbol.endsWith('-USD') ? 'Crypto' : 'US', regime, actual, variants: {} };
      for (const [name, predict] of Object.entries(variants)) {
        const result = predict(history, { symbol: item.symbol, context, includeEvaluation: false });
        // Legacy's returned samples omit its headline overlay. Evaluate the
        // actual displayed price by applying that same shift to its samples.
        const samples = result.samples, mid = (samples[samples.length / 2 - 1] + samples[samples.length / 2]) / 2;
        const shift = Math.log(result.points.at(-1).close / result.lastClose) - mid;
        record.variants[name] = { ...scoreForecast(samples.map(x => x + shift), actual), modelId: result.modelId, available: result.modelAvailable !== false,
          predicted: Math.log(result.points.at(-1).close / result.lastClose) };
      }
      records.push(record);
    }
  }
  const summarize = rows => Object.fromEntries(Object.keys(variants).map(name => [name, {
    ...aggregateForecastScores(rows.map(row => row.variants[name])),
    availableForecasts: rows.filter(row => row.variants[name].available).length,
    modelSelections: rows.reduce((counts, row) => { const id = row.variants[name].modelId; counts[id] = (counts[id] || 0) + 1; return counts; }, {}),
  }]));
  const blocks = [...new Set(records.map(row => row.target.slice(0, 7)))];
  const skillInterval = (name, baseline) => {
    let state = 27102026;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const samples = [];
    for (let i = 0; i < 1000; i++) {
      const rows = Array.from({ length: blocks.length }, () => {
        const month = blocks[Math.floor(random() * blocks.length)];
        return records.filter(row => row.target.startsWith(month));
      }).flat();
      const sum = key => rows.reduce((n, row) => n + row.variants[key].returnMae, 0);
      samples.push((1 - sum(name) / sum(baseline)) * 100);
    }
    samples.sort((a, b) => a - b);
    const sum = key => records.reduce((n, row) => n + row.variants[key].returnMae, 0);
    return { skillPercent: (1 - sum(name) / sum(baseline)) * 100, low95: samples[25], high95: samples[974], blocks: blocks.length,
      method: '1000 paired calendar-month block bootstrap samples; exploratory with few blocks' };
  };
  const report = { mode, createdAt: new Date().toISOString(), modelVersion: FORECAST_VERSION, codeSha256, legacyRevision,
    productionVariant: 'alignedOriginalFamily',
    manifestSha256: sha(JSON.stringify(manifest)), observations: records.length, horizon: config.horizon,
    overall: summarize(records), groups: Object.fromEntries(['NSE', 'US', 'Crypto'].map(group => [group, summarize(records.filter(row => row.group === group))])),
    regimes: Object.fromEntries(['rising', 'falling', 'sideways'].filter(regime => records.some(row => row.regime === regime)).map(regime => [regime, { count: records.filter(row => row.regime === regime).length, ...summarize(records.filter(row => row.regime === regime)) }])),
    symbols: Object.fromEntries(config.symbols.map(row => [row.symbol, summarize(records.filter(record => record.symbol === row.symbol))])),
    comparisons: { productionVsLegacy: skillInterval('alignedOriginalFamily', 'legacy'), productionVsUnchanged: skillInterval('alignedOriginalFamily', 'unchangedPrice'),
      accuracyVsProduction: skillInterval('accuracy', 'alignedOriginalFamily'), contextVsProduction: skillInterval('contextExperiment', 'alignedOriginalFamily'),
      directVsProduction: skillInterval('directHorizon', 'alignedOriginalFamily'), directContextVsProduction: skillInterval('directContext', 'alignedOriginalFamily') },
    limitations: ['Fixed convenience universe; not a survivorship-free exchange panel.', 'Downloaded adjusted history is a current snapshot, not a vintage point-in-time archive.', 'The same source provides targets and inputs.', 'Success on a historical holdout does not establish future accuracy.'], records };
  await save(join(destination, `${mode}-report.json`), report);
  console.log(JSON.stringify({ mode, observations: records.length, overall: report.overall, comparisons: report.comparisons }, null, 2));
} else throw new Error('Usage: node scripts/forecast-benchmark.mjs snapshot|development|holdout [output-directory]');
