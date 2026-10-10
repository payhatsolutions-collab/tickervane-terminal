import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, isRelevant, cluster, storiesFor, storyKey } from '../agents/jarvis/news.mjs';
import {
  unverifiedFigures, validateAnalysis, extractAnalysis, explainFailure, analyse, LOGIN_FIX
} from '../agents/jarvis/analyst.mjs';
import { readFileSync } from 'node:fs';
import { normalizeSignal } from '../agents/jarvis/envelope.mjs';

const NOW = new Date('2026-10-09T16:00:00Z');
const item = (title, source, date = '2026-10-09T15:00:00Z', url) =>
  ({ title: `${title} - ${source}`, source, date, url: url || `https://news.example/${encodeURIComponent(title).slice(0, 40)}` });

// ---------------------------------------------------------------------------
// Titles and relevance
// ---------------------------------------------------------------------------

test('cleanTitle strips the publisher suffix Google News appends', () => {
  assert.equal(cleanTitle('Iran attacks tankers beyond Strait of Hormuz - Financial Times', 'Financial Times'),
    'Iran attacks tankers beyond Strait of Hormuz');
  assert.equal(cleanTitle('British Pound gains ground as Japanese Yen underperforms | FXStreet'),
    'British Pound gains ground as Japanese Yen underperforms');
});

test('relevance is whole-word, so look-alike words do not leak in', () => {
  assert.equal(isRelevant('Hung Yen: Project to modernise irrigation system launched', 'asia'), false);
  assert.equal(isRelevant('Michelle Randolph shares rare photo with boyfriend Glen Powell', 'fed'), false);
  assert.equal(isRelevant('Bank of Japan weighs second rate hike', 'asia'), true);
  assert.equal(isRelevant('RBI raises daily CRR to 99% for banks', 'india'), true);
});

// ---------------------------------------------------------------------------
// Grouping — the reason the brief is readable
// ---------------------------------------------------------------------------

test('ten outlets reporting one event become one story with ten outlets', () => {
  const sources = ['Reuters', 'Bloomberg', 'NDTV', 'Yahoo', 'AOL.com', 'The Guardian', 'CNN', 'Axios', 'Politico', 'AP News'];
  const items = sources.map((s, i) => item(
    i % 2 ? 'Trump establishes committee to investigate Fed governor Lisa Cook'
          : "Trump establishes committee to investigate Federal Reserve's Lisa Cook", s));
  const stories = storiesFor('fed', items, { now: NOW });
  assert.equal(stories.length, 1);
  assert.equal(stories[0].outlets, 10);
});

test('a dominant story keeps its own key words (regression: it used to split five ways)', () => {
  const items = [
    ...Array.from({ length: 8 }, (_, i) => item('Trump establishes committee to investigate Federal Reserve Lisa Cook', `Outlet ${i}`)),
    item("Fed's Cook lawyers say hearing will show no mortgage fraud case", 'Reuters')
  ];
  const stories = storiesFor('fed', items, { now: NOW });
  assert.equal(stories[0].outlets, 8);
  assert.equal(stories.length, 2, 'the separate court-hearing story stays separate');
});

test('different events on the same theme stay separate', () => {
  const groups = cluster([
    { title: 'RBI raises daily CRR requirement for banks' },
    { title: 'RBI cancels licences of 13 NBFCs' },
    { title: "India's forex reserves drop to $734.61 billion" }
  ], 'india');
  assert.equal(groups.length, 3);
});

test('stories rank by how many outlets carried them', () => {
  const items = [
    item('RBI cancels licences of 13 NBFCs', 'CNBC TV18'),
    ...['Livemint', 'Business Standard', 'Moneycontrol'].map(s => item('RBI raises daily CRR requirement for banks', s))
  ];
  const [first, second] = storiesFor('india', items, { now: NOW });
  assert.equal(first.outlets, 3);
  assert.equal(second.outlets, 1);
});

test('a preferred outlet supplies the headline when several carried the story', () => {
  const items = [
    item('RBI hikes CRR, a huge blow to banks?!', 'Some Blog'),
    item('RBI hikes CRR for banks', 'Reuters')
  ];
  const [s] = storiesFor('india', items, { now: NOW });
  assert.equal(s.title, 'RBI hikes CRR for banks');
});

test('opinion pieces, stale items, off-topic items and non-https links are dropped', () => {
  const items = [
    item('Opinion | Some tout U.S. victory in Iran', 'The Washington Post'),
    item('Iran attacks tanker in Hormuz', 'Reuters', '2026-10-01T10:00:00Z'),
    item('Celebrity wedding photos released', 'Gossip'),
    { title: 'Iran strikes LPG carrier - X', source: 'X', date: '2026-10-09T15:00:00Z', url: 'http://insecure.example/a' },
    item('Iran strikes LPG carrier in Hormuz', 'Reuters')
  ];
  const stories = storiesFor('hormuz', items, { now: NOW });
  assert.deepEqual(stories.map(s => s.title), ['Iran strikes LPG carrier in Hormuz']);
});

test('storyKey is stable across rewordings, so "new" means genuinely new', () => {
  assert.equal(
    storyKey({ title: 'RBI raises daily CRR requirement for banks' }),
    storyKey({ title: 'RBI raises daily CRR requirement for banks' })
  );
  assert.notEqual(
    storyKey({ title: 'RBI raises daily CRR requirement for banks' }),
    storyKey({ title: 'RBI cancels licences of 13 NBFCs' })
  );
});

// ---------------------------------------------------------------------------
// The analysis step's guard against invented figures
// ---------------------------------------------------------------------------

const input = JSON.stringify({
  snapshot: [{ name: 'Brent crude', price: 104.55, day_change_pct: 0.26 }],
  stories: [{ id: 1, headline: "India's Forex Reserves See Significant Drop to $734.61 Billion" }]
});

test('figures present in the input are accepted, including rounded renderings', () => {
  const analysis = { summary: 'Brent near $104.55 (+0.26%); reserves fell to $734.61 billion; Brent ~104.6.' };
  assert.deepEqual(unverifiedFigures(analysis, input), []);
});

test('story citations are not mistaken for figures', () => {
  const analysis = {
    headline: 'h', summary: 's', watch: [],
    topics: [{ title: 't', what_happened: 'w', why_it_matters: 'y', story_ids: [7, 8, 9, 11] }],
    india_impact: [{ area: 'Banks', direction: 'mixed', reason: 'r', story_ids: [12, 8, 9] }]
  };
  assert.deepEqual(unverifiedFigures(analysis, input), []);
});

test('figures the model made up are flagged', () => {
  const analysis = { summary: 'Brent could test $120 and the rupee may slide 3.5% this month.' };
  const flagged = unverifiedFigures(analysis, input);
  assert.ok(flagged.some(f => f.includes('120')));
  assert.ok(flagged.some(f => f.includes('3.5')));
});

// ---------------------------------------------------------------------------
// Running on the Claude subscription, locked down
// ---------------------------------------------------------------------------

const analystSource = readFileSync(new URL('../agents/jarvis/analyst.mjs', import.meta.url), 'utf8');

test('the analysis call has no tools and no connectors', () => {
  // Headlines are untrusted. The user's Claude Code setup includes Kite, which
  // can place orders; none of that may be reachable from this call.
  assert.match(analystSource, /'--tools', ''/);
  assert.match(analystSource, /'--strict-mcp-config'/);
  assert.match(analystSource, /'--restricted'/);
});

test('the analysis never bills an API key, even if one is in the environment', () => {
  assert.match(analystSource, /delete env\.ANTHROPIC_API_KEY/);
  assert.match(analystSource, /delete env\.ANTHROPIC_AUTH_TOKEN/);
});

test('a missing login is reported with the command that fixes it', () => {
  const r = explainFailure('Not logged in · Please run /login');
  assert.equal(r.status, 'off');
  assert.equal(r.fix, LOGIN_FIX);
});

test('a usage-limit stop is reported plainly, not as a crash', () => {
  assert.match(explainFailure('Claude AI usage limit reached').reason, /usage limit/);
});

test('a missing Claude Code install degrades to "off" instead of throwing', async () => {
  const before = process.env.JARVIS_CLAUDE_BIN;
  process.env.JARVIS_CLAUDE_BIN = '/nonexistent/claude';
  try {
    const { analyse: fresh } = await import(`../agents/jarvis/analyst.mjs?nobin=${Date.now()}`);
    const r = await fresh({ snapshot: [], stories: [] });
    assert.equal(r.status, 'off');
    assert.match(r.fix, /npm install -g @anthropic-ai\/claude-code/);
  } finally {
    if (before === undefined) delete process.env.JARVIS_CLAUDE_BIN; else process.env.JARVIS_CLAUDE_BIN = before;
  }
});

test('structured output is preferred; a fenced JSON reply also parses', () => {
  assert.deepEqual(extractAnalysis({ structured_output: { headline: 'x' } }), { headline: 'x' });
  assert.deepEqual(extractAnalysis({ result: '```json\n{"headline":"y"}\n```' }), { headline: 'y' });
  assert.throws(() => extractAnalysis({ result: 'no json here' }), /No JSON/);
});

test('validation drops citations to stories that do not exist and coerces bad directions', () => {
  const v = validateAnalysis({
    headline: 'h', summary: 's', watch: ['RBI'],
    topics: [{ title: 't', what_happened: 'w', why_it_matters: 'y', story_ids: [1, 99] }],
    india_impact: [{ area: 'Banks', direction: 'bullish!!', reason: 'r', story_ids: [2] }]
  }, new Set([1, 2]));
  assert.deepEqual(v.topics[0].story_ids, [1]);
  assert.equal(v.india_impact[0].direction, 'unclear');
});

test('validation rejects an answer missing required parts', () => {
  assert.throws(() => validateAnalysis({ headline: 'h' }, new Set()), /summary/);
});

// ---------------------------------------------------------------------------
// Structured data on signals
// ---------------------------------------------------------------------------

const base = { agent: 'macro', kind: 'observation', title: 't', evidence: [{ source: 'x', value: 1 }] };

test('a signal can carry structured data for the dashboard', () => {
  const s = normalizeSignal({ ...base, data: { kind: 'research_brief', stories: [{ id: 1 }] } });
  assert.equal(s.data.kind, 'research_brief');
});

test('data must be an object and is size-capped', () => {
  assert.throws(() => normalizeSignal({ ...base, data: [1, 2] }), /data must be an object/);
  assert.throws(() => normalizeSignal({ ...base, data: { blob: 'x'.repeat(250_000) } }), /under 200KB/);
});
