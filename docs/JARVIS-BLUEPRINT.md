# Jarvis — Chief of Staff agent system

Blueprint for a supervising agent (**Jarvis**) with a dashboard, delegating to four
specialist sub-agents, built on top of the existing AlphaNova Terminal.

Status: design document. Nothing here is implemented yet.
Written 2026-09-30 against AlphaNova Terminal 2.3.

**Decisions locked (2026-09-30).** Mail backend: **Gmail**. Runtime: **local daemon on
the Mac**. GIFT Nifty: **out of scope**. TradingView watchlist: **out of scope** — the
app's own watchlist is the source of truth. All four are reflected throughout; §11
records what they closed.

---

## 0. Start here: what already exists

A large fraction of the requested functionality is already built in this repo. The
blueprint reuses it rather than re-implementing it.

| Requested capability | Already in repo | Where |
|---|---|---|
| Brent, gold, Nasdaq, S&P 500, Nikkei quotes | ✅ Live | [data.js](../src/data.js) `rows`, [Pulse.jsx](../src/Pulse.jsx) global cues |
| Indian news + headline relevance/event ranking | ✅ Live | [api/market.js:333](../api/market.js#L333) `op=news`, `rankNews`, `companyNews` |
| Technical analysis (EMA, RSI, Bollinger, ATR, pivots, CPR, VWAP) | ✅ Live | [marketMath.js](../src/marketMath.js), [tradeMath.js](../src/tradeMath.js) |
| Momentum + relative-strength scoring over Nifty 500 | ✅ Live | [lib/nse.js](../lib/nse.js) `buildScreen`, [api/market.js:366](../api/market.js#L366) `op=screen` |
| Delivery-volume conviction signals | ✅ Live | [lib/nse.js](../lib/nse.js) `buildRadar`, `deliverySignal` |
| Watchlist (incl. **already synced to Blob**), alerts, journal, risk sizing | ✅ Live | [App.jsx](../src/App.jsx), [TradeDesk.jsx](../src/TradeDesk.jsx), [api/push.js:229](../api/push.js#L229) |
| Scheduled background work + push to device | ✅ Live (2×/day) | [api/push.js](../api/push.js) `op=cron`, [vercel.json:68](../vercel.json#L68) |
| **KOSPI** | ❌ Missing | one row in `data.js` — `^KS11` |
| **Iran / Hormuz geopolitical feed** | ❌ Missing | new `op=macronews` |
| **Options chain / expiry scanning** | ❌ Missing | needs Kite connector |
| **Gmail triage** | ❌ Missing | Google OAuth in the daemon — §9.1 |
| **Agent runtime / orchestration** | ❌ Missing | the actual new work |

So the build is: **one orchestration layer, four agent modules, one dashboard tab, and
three new data sources** — not a new terminal.

---

## 1. Runtime: local daemon (decided)

The current deployment cannot host an agent loop:

- **Vercel Hobby allows 2 cron jobs, each firing once per day** inside an hour-wide
  window. The README records this honestly: the two existing jobs run in the
  *19:30–20:30 and 21:30–22:30 IST* windows ([README.md:49](../README.md#L49)).
- Serverless functions are capped at `maxDuration: 60` ([vercel.json:6](../vercel.json#L6)).
- There is no shared KV, so even rate limiting is best-effort per isolate
  ([api/market.js:4](../api/market.js#L4)).

"Continuously fetches" and "scans monthly expiry during the session" are not expressible
in that budget. **Decision: a local `launchd` daemon on this Mac.** Your Kite session and
your mailbox tokens live here anyway, so nothing sensitive leaves the machine; the Vercel
deployment stays what it is today — a public, read-only research frontend — and gains one
authenticated endpoint the daemon pushes briefs into. Cost ₹0.

```xml
<!-- ~/Library/LaunchAgents/in.alphanova.jarvis.plist -->
<key>ProgramArguments</key>
<array>
  <string>/Users/sarda/.local/bin/node</string>
  <string>/Users/sarda/Downloads/alphanova-terminal/agents/jarvis/runtime.mjs</string>
</array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardErrorPath</key><string>/Users/sarda/.alphanova/logs/stderr.log</string>
```

The daemon owns its own scheduler (§4.2) rather than relying on `StartCalendarInterval`,
so the schedule is data, is testable, and survives a plan change. `KeepAlive` restarts it
on crash. If the Mac is asleep at a fire time the tick is skipped, not queued — briefs
state their coverage window so a gap is visible rather than silently backfilled.

*Later escape hatch:* if you ever want this off-machine, Vercel Pro (~$20/mo) gives
per-minute crons and 300 s functions, and §4.2's table moves into `vercel.json` almost
verbatim. Nothing in this design assumes the Mac.

---

## 2. Topology

```
┌─────────────────────────────── YOUR MAC (launchd) ───────────────────────────────┐
│                                                                                   │
│   agents/jarvis/runtime.mjs        ← the only long-lived process                  │
│   ┌───────────────────────────────────────────────────────────────────────┐       │
│   │  JARVIS  (Chief of Staff)                                             │       │
│   │  · scheduler (cron table §4.2)    · budget governor (§10.3)           │       │
│   │  · delegation + fan-out           · escalation policy (§4.4)          │       │
│   │  · cross-agent correlation (§4.3) · brief composer                    │       │
│   └───┬──────────────┬──────────────┬──────────────┬─────────────────────┘       │
│       │              │              │              │                              │
│   ┌───▼────┐    ┌────▼─────┐   ┌────▼─────┐   ┌────▼──────┐                       │
│   │ MACRO  │    │ OPTIONS  │   │ MOMENTUM │   │  ERRANDS  │                       │
│   │  §6    │    │   §7     │   │   §8     │   │    §9     │                       │
│   └───┬────┘    └────┬─────┘   └────┬─────┘   └────┬──────┘                       │
│       │              │              │              │                              │
│       └──────────────┴──────┬───────┴──────────────┘                              │
│                             │                                                     │
│                   ┌─────────▼──────────┐                                          │
│                   │  SIGNAL BUS (§3.1) │  append-only JSONL, local                │
│                   │  MEMORY   (§3.3)   │  SQLite                                  │
│                   └─────────┬──────────┘                                          │
│                             │                                                     │
│                   ┌─────────▼────────────────────────────┐                        │
│                   │  DASHBOARD  http://127.0.0.1:7777    │  §5                    │
│                   │  serves its own page from that same  │                        │
│                   │  store · loopback only · standalone  │                        │
│                   └──────────────────────────────────────┘                        │
│                                                                                   │
│   Keychain: Kite token · Google OAuth refresh token · ANTHROPIC_API_KEY           │
└─────────────────────────────┬─────────────────────────────────────────────────────┘
                              │ outbound reads only — market data and news
                              ▼
   Market API (any source exposing quotes/charts/news — §6.1)
   Yahoo Finance · NSE bhavcopy · Google News RSS · SEC EDGAR
   Kite Connect (options, live quotes)   ← local only, read scope
   Gmail API (triage, drafts)            ← local only, §9.1
```

Jarvis is self-contained. The daemon holds the agents, the store **and** the dashboard,
and reaches outward only to read market data and news. Nothing about Jarvis is deployed
anywhere, and it is not part of any other application.

**On the market data source.** The agents currently read quotes, charts, delivery and
news from the AlphaNova terminal's `/api/market`, because it already exists in this
checkout, is well tested, and saves writing a second Yahoo parser and bhavcopy reader.
That is a backend detail behind `JARVIS_MARKET_BASE` and one module
([market.mjs](../agents/jarvis/market.mjs)) — it is invisible in the Jarvis UI and swappable
for a direct feed or a broker API whenever you want. **Open question for you:** keep
reusing it, or have Jarvis fetch its own data and depend on nothing else? Default if
unanswered: keep reusing it, since rebuilding it buys nothing today.

---

## 3. Shared contracts

These three contracts are the whole integration surface. Get them right and the agents
are independently replaceable.

### 3.1 The Signal envelope

Every sub-agent emits only this. Jarvis consumes only this. The dashboard renders only
this.

```jsonc
{
  "id": "sig_01JB8...",              // ULID, sortable by time
  "ts": "2026-09-30T04:12:07.311Z",  // UTC, always
  "agent": "macro",                  // macro | options | momentum | errands
  "kind": "observation",             // observation | proposal | alert | task
  "severity": "elevated",            // routine | notable | elevated | urgent
  "confidence": 0.62,                // 0–1, agent's own calibration
  "title": "Brent +3.8% on Hormuz tanker report",
  "body": "Brent (BZ=F) 84.10 → 87.30 since 02:00 IST...",

  "subjects": [                      // what this is ABOUT — drives correlation §4.3
    {"type": "instrument", "ref": "BZ=F"},
    {"type": "theme",      "ref": "hormuz"},
    {"type": "sector",     "ref": "^CNXENERGY"}
  ],

  "evidence": [                      // MANDATORY. No evidence → signal is dropped.
    {"source": "Yahoo Finance", "url": "...", "fetchedAt": "...", "value": 87.30},
    {"source": "Reuters via Google News", "url": "https://...", "publishedAt": "..."}
  ],

  "expiresAt": "2026-09-30T10:00:00Z",
  "supersedes": "sig_01JB7...",      // optional; dashboard collapses chains

  "action": {                        // present only when kind = proposal | task
    "type": "options_strategy",
    "requiresApproval": true,        // ALWAYS true for anything with money attached
    "payload": { /* agent-specific, see §7.4 */ }
  }
}
```

Two rules, enforced in the bus writer, not by convention:

1. **`evidence[]` non-empty or the signal is rejected.** This is the single strongest
   defence against a model narrating a plausible market story with no data behind it.
   It matches the principle the terminal already holds to — *"No generated prices or
   fabricated fallback history… unavailable data stays unavailable"*
   ([README.md:18](../README.md#L18)).
2. **`action.requiresApproval` is forced to `true`** for `options_strategy`,
   `equity_order`, `send_email`, `booking`, `payment`. The writer overwrites whatever
   the agent set. An agent cannot opt itself out.

### 3.2 The Task envelope (Jarvis → agent)

```jsonc
{
  "taskId": "tsk_01JB8...",
  "agent": "options",
  "intent": "scan_monthly_expiry",
  "params": {"underlying": "NIFTY", "expiry": "2026-10-29"},
  "budget": {"tokens": 40000, "wallSeconds": 120, "toolCalls": 25},
  "context": ["sig_01JB7...", "sig_01JB6..."],  // signals Jarvis thinks are relevant
  "deadline": "2026-09-30T04:20:00Z",
  "trigger": {"kind": "cron", "rule": "options.intraday"}
}
```

Budgets are enforced by the runtime (hard kill), not requested politely in a prompt.

### 3.3 Memory

SQLite at `~/.alphanova/jarvis.db`. Four tables, deliberately small:

| Table | Purpose | Retention |
|---|---|---|
| `signals` | every emitted signal, full JSON | 180 days |
| `outcomes` | proposal → what you did → what happened at T+1/5/20 sessions | forever |
| `preferences` | learned weights (see §8.3) with provenance | forever |
| `runs` | task id, agent, tokens, wall time, tool calls, exit status | 30 days |

`outcomes` is what makes the system improve. Without it every agent restarts cold every
day and "learned to associate with the user's preferences" stays marketing copy. See
§8.3 for the only learning loop worth building first.

---

## 4. Jarvis — the Chief of Staff

### 4.1 Responsibilities

Jarvis does exactly five things. Anything else belongs in a sub-agent.

1. **Schedule** — fire tasks from the cron table, skipping market-closed windows via
   the existing `nseSession()` ([marketMath.js](../src/marketMath.js)).
2. **Delegate** — build Task envelopes, pick which prior signals go in `context`.
3. **Correlate** — the one job no sub-agent can do (§4.3).
4. **Compose** — fold the signal bus into the three daily briefs (§4.5).
5. **Escalate** — decide what interrupts you *now* versus waits for a brief (§4.4).

Explicitly **not** Jarvis's job: fetching data, analyzing charts, writing drafts. Jarvis
holds no tool credentials of its own beyond the signal bus and the ingest endpoint.

### 4.2 Schedule (IST)

```jsonc
// agents/jarvis/schedule.json — ORIGINAL DRAFT. As built (2026-10-09), the macro
// agent runs one intent, research_brief, at 06:30, 09:30, 12:00, 15:45, 20:00 and
// 23:30 on weekdays and 10:00 / 20:00 at weekends. See agents/jarvis/schedule.json.
[
  {"rule":"macro.overnight",  "cron":"30 6  * * 1-5", "agent":"macro",
   "intent":"overnight_wrap", "note":"US close + Asia open read, before pre-open"},
  {"rule":"macro.intraday",   "cron":"*/15 9-15 * * 1-5", "agent":"macro",
   "intent":"delta_scan",     "guard":"nseSession != closed"},
  {"rule":"macro.geopol",     "cron":"0 */2 * * *",  "agent":"macro",
   "intent":"geopolitical_scan", "note":"24×7 — Hormuz does not keep market hours"},

  {"rule":"options.preopen",  "cron":"5 9  * * 1-5", "agent":"options",
   "intent":"scan_monthly_expiry"},
  {"rule":"options.intraday", "cron":"*/10 9-15 * * 1-5", "agent":"options",
   "intent":"monitor_open_proposals"},

  {"rule":"momentum.eod",     "cron":"45 18 * * 1-5", "agent":"momentum",
   "intent":"rank_universe",  "note":"after NSE publishes delivery bhavcopy ~18:00"},
  {"rule":"momentum.preopen", "cron":"0 9  * * 1-5", "agent":"momentum",
   "intent":"gap_watch"},

  {"rule":"errands.morning",  "cron":"0 7  * * *",   "agent":"errands",
   "intent":"triage_inbox"},
  {"rule":"errands.evening",  "cron":"0 19 * * *",   "agent":"errands",
   "intent":"triage_inbox"},
  {"rule":"errands.bills",    "cron":"0 10 * * *",   "agent":"errands",
   "intent":"bill_sweep"}
]
```

### 4.3 Correlation — the only genuinely new analysis

Sub-agents see their own lane. Jarvis sees the bus. Correlation runs after every fan-out
and looks for three patterns, all cheap and deterministic — no model call needed to
*detect* them, only to phrase them:

**(a) Theme convergence.** ≥2 agents emit signals sharing a `subjects[].ref` within
90 minutes.
> `macro`: Hormuz escalation + Brent +3.8% · `momentum`: ONGC, OIL, GAIL entering top
> decile · → one merged `elevated` signal, not three `routine` ones.

**(b) Contradiction.** Two `proposal` signals whose net directional exposure on the same
underlying opposes.
> `options` proposes a NIFTY bear put spread while `momentum` flags eight large-cap
> breakouts. Jarvis does **not** resolve this. It surfaces both, side by side, labelled
> *Conflict*, and asks you. A supervisor that silently picks a side is worse than useless.

**(c) Stale conviction.** An open `proposal` whose supporting evidence has expired
(`expiresAt` passed) and has not been refreshed.
> Emits a `notable` "re-validate or drop" signal. Prevents yesterday's thesis quietly
> becoming today's position.

### 4.4 Escalation policy

| Severity | Channel | Latency |
|---|---|---|
| `routine` | dashboard only | next brief |
| `notable` | dashboard, badge count | next brief |
| `elevated` | Web Push via existing `api/push.js` | ≤15 min |
| `urgent` | Web Push, `requireInteraction: true` | immediate |

`urgent` is reserved and rate-limited to **3 per day, hard cap in the runtime**. The
whole value of an interrupt is its rarity. Candidates: a held position gapping through
its journalled stop; an options proposal invalidated by a >2σ gap; a bill due today
unpaid; a flight schedule change.

Reuses the existing push infrastructure unchanged — `send()`, the per-device Blob store,
the VAPID keys already set on the project ([api/push.js](../api/push.js),
[README.md:50](../README.md#L50)).

### 4.5 Briefs

Three per day, composed by Jarvis, rendered on the dashboard and pushed:

- **06:45 IST — Overnight.** US close, Asia open (Nikkei, KOSPI), Brent/gold overnight,
  geopolitical delta, what changed for open positions.
- **15:45 IST — Session close.** What the session did versus the morning read, momentum
  rank changes, options proposals resolved or still live.
- **19:15 IST — Personal + EOD.** Delivery radar results, tomorrow's calendar, bills due
  in 7 days, flagged mail awaiting your reply.

Each brief states its coverage window explicitly, so a daemon gap (Mac asleep) reads as
"no data 02:00–06:00" rather than as calm markets.

---

## 5. The Jarvis dashboard

### 5.1 Standalone, served by the daemon

**Jarvis has its own dashboard. It is not part of any other application.**

The daemon serves it directly from its own store at `http://127.0.0.1:7777`
([server.mjs](../agents/jarvis/server.mjs), [public/index.html](../agents/jarvis/public/index.html)).
No build step, no framework, no external requests — one self-contained page.

An earlier draft of this document put the dashboard inside the AlphaNova terminal as a
ninth tab. That was wrong: Jarvis is its own system and its dashboard is its own product
surface. It was removed in full, and the terminal is back to its original eight tabs.

Serving it locally is also better than publishing it, on four counts:

| | Local daemon | Published page |
|---|---|---|
| Availability | works offline, no website needed | depends on a deployment |
| Exposure | not reachable from the network | trading signals on a public host |
| Storage | reads SQLite directly | Blob writes on every tick |
| **Approvals** | **work in the browser** | impossible — see below |

The last row is the important one. A public site must not carry a mutating route that
approves trades, so an earlier version of this design pushed approvals to the CLI. A
loopback server shares an origin with its own page, so the dashboard can offer Approve
and Dismiss directly. Approving records the decision and prints the order ticket; it
still never transmits an order (§7.5).

Bound to `127.0.0.1` only, and the `Host` header is checked on every request so a page
you visit elsewhere cannot address the daemon by a hostname that resolves to it. The
page polls every 20 s and stops entirely while the tab is hidden.

### 5.2 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  JARVIS            NSE: open 14:22 IST      last sync 22s ago     ⟳     │
├──────────────────────────────┬──────────────────────────────────────────┤
│  NOW                         │  AGENTS                                  │
│  ┌────────────────────────┐  │  ┌────────────────────────────────────┐  │
│  │ ⚠ ELEVATED             │  │  │ ● Macro     ok    14:15  · 6 sig   │  │
│  │ Brent +3.8% · Hormuz   │  │  │ ● Options   ok    14:20  · 2 prop  │  │
│  │ Energy leading, 3 wl   │  │  │ ● Momentum  idle  18:45 (EOD)      │  │
│  │ names in top decile    │  │  │ ◐ Errands   degraded — OAuth expd  │  │
│  │ [evidence ×4]  [mute]  │  │  └────────────────────────────────────┘  │
│  └────────────────────────┘  │  TODAY'S BUDGET                          │
│  ┌────────────────────────┐  │  ████████░░░░  312k / 500k tokens        │
│  │ ⚑ CONFLICT             │  │  84 tool calls · 41 model calls          │
│  │ options: bear spread   │  ├──────────────────────────────────────────┤
│  │ momentum: 8 breakouts  │  │  AWAITING YOU                        (3) │
│  │ [see both]             │  │  ┌────────────────────────────────────┐  │
│  └────────────────────────┘  │  │ NIFTY 24800/25000 bull call spread │  │
│                              │  │ debit ₹4,120 · maxloss ₹4,120      │  │
│  BRIEFS                      │  │ [review]  [approve]  [dismiss]     │  │
│  06:45 Overnight        →    │  ├────────────────────────────────────┤  │
│  15:45 Session close    →    │  │ Draft ready: Kotak — KYC re-verify │  │
│                              │  │ [open in Gmail]        [dismiss]   │  │
│                              │  └────────────────────────────────────┘  │
├──────────────────────────────┴──────────────────────────────────────────┤
│  SIGNAL STREAM        [all ▾] [macro] [options] [momentum] [errands]     │
│  14:20  options   notable   IV crush in 25000CE, 3 DTE …                │
│  14:15  macro     elevated  Brent +3.8% …                        ⌄      │
│  14:02  momentum  routine   TITAN enters top quintile …                 │
└─────────────────────────────────────────────────────────────────────────┘
```

Four design rules, each earning its place:

1. **Every card expands to its `evidence[]`** — source name, URL, fetch timestamp, raw
   value. One click from claim to provenance. Consistent with the terminal's existing
   "sources and timestamps are visible" stance.
2. **"Awaiting you" is the only place with action buttons.** Nothing else in the UI
   executes anything. A single, obvious consent surface.
3. **Approve never places an order, and never sends mail.** For options it records the
   decision and shows the order ticket, which stays on screen until you dismiss it —
   the ticket is the reason you approved, so it must not vanish with the card (§7.5).
   For mail it deep-links to the Gmail draft (§9.1).
4. **Agent health is always visible.** `degraded` with a stated reason beats silence —
   the Errands card above is telling you OAuth expired, not pretending the inbox is
   empty.

### 5.3 API contract

Served by the daemon on `127.0.0.1:7777`. No auth: reaching it already means being on
this machine, and the `Host` check plus loopback binding are what enforce that.

| Route | Method | Returns |
|---|---|---|
| `/` | GET | the dashboard page and its assets |
| `/api/signals?agent=&severity=&since=&limit=` | GET | signals newest first, plus `pending` |
| `/api/health` | GET | per-agent status, last run, budget used, pending count |
| `/api/brief?kind=overnight\|close\|evening` | GET | composed over the live store |
| `/api/decide` | POST | `{signalId, decision}` → records it, returns the ticket |

There is no storage layer to design: the dashboard reads the same SQLite the agents
write, so there is nothing to publish, sync or invalidate, and nothing can go stale
between the daemon and the page.

**Approvals move nothing.** `/api/decide` writes a row to `outcomes` and hands back
`action.payload` as a ticket for you to place yourself. The options agent's allowlist
contains no order tool (§7.5, §10.2), so there is no code path from an approval to a
broker, by construction rather than by policy.

**Consequence, stated plainly:** the dashboard is reachable only from this Mac. Away from
it you cannot read Jarvis or approve anything. For a system whose approvals move money
that is the right default; if you later want remote read access, the honest shape is an
SSH tunnel, not a public deployment.

---

## 6. Agent 1 — Market Research & News (`macro`)

### 6.1 Coverage

| Instrument | Ticker | Status |
|---|---|---|
| Brent crude | `BZ=F` | ✅ in `data.js`, in Pulse global cues |
| Gold | `GC=F` | ✅ in `data.js`, in Pulse |
| Nasdaq | `^IXIC` | ✅ |
| S&P 500 | `^GSPC` | ✅ |
| Nikkei 225 | `^N225` | ✅ |
| **KOSPI** | `^KS11` | ➕ add one row to `data.js` |
| India VIX, USD/INR, US 10Y | `^INDIAVIX`, `INR=X`, `^TNX` | ✅ |

Adding KOSPI is genuinely one line in [data.js](../src/data.js):

```js
['^KS11','KOSPI','Global','Index'],
```

and it flows into `instruments`, `directory`, `groups.Indices`, search and the quotes
endpoint automatically. No other change. Add it to `Pulse.jsx`'s global-cues row too, so
it appears in the UI alongside Nikkei.

> **GIFT Nifty — out of scope by decision.** Not carried by Yahoo, and not a Kite
> segment. Investigated 2026-09-30: Groww does **not** carry it (`/indices/gift-nifty`
> returns a 200 catch-all shell with `undefined Index` and zeroed fields; its index API
> `…/latest_indices_ohlc/<SYM>` 404s on every GIFT variant). NSE IX does publish it
> publicly — `https://www.nseix.com/api/*`, unauthenticated, JSON, with a near-month
> GIFT Nifty future — so this is revivable in a couple of hours if the overnight gap read
> ever justifies it. Until then the overnight brief omits it rather than proxying it with
> spot plus a drift model, which would violate [README.md:18](../README.md#L18).

### 6.2 Geopolitical feed (Hormuz / Iran)

New op in `api/market.js`, deliberately server-side so no CSP change is needed — the
existing policy already restricts browser `connect-src` to self, Yahoo and
news.google.com ([vercel.json:52](../vercel.json#L52)), and `parseNews()` is already
written and tested.

```js
// api/market.js — op=macronews
const THEMES = {
  hormuz: {
    q: '("Strait of Hormuz" OR "Hormuz" OR "Iran tanker" OR "IRGC seizure" ' +
       'OR "Iran nuclear" OR "Iran sanctions" OR "Red Sea shipping") when:3d',
    linked: ['BZ=F', 'CL=F', '^CNXENERGY', 'INR=X']
  },
  fed:   { q: '(Federal Reserve OR FOMC OR "rate decision") when:3d',
           linked: ['^GSPC','^IXIC','^TNX','GC=F'] },
  india: { q: '(RBI OR "Indian rupee" OR "FII flows" OR "GST" OR "India inflation") when:3d',
           linked: ['^NSEI','INR=X'] }
};
```

Reuses `parseNews()` verbatim ([api/market.js:308](../api/market.js#L308)) — including
its `^https://` URL validation, which is exactly the RSS-safety behaviour
`tests/market.test.js` already covers.

### 6.3 What the agent actually does

Three steps, only the third needs a model:

1. **Fetch** — `GET /api/market?op=quotes&symbols=…` (16-symbol cap, so two batched
   calls) plus `op=macronews&theme=hormuz`.
2. **Detect, deterministically** — no model call. A news item is *material* only if it
   co-occurs with a price move:
   - move ≥ 1.5σ of that instrument's trailing 20-session daily range, **and**
   - ≥2 independent publishers on the theme in 6 h, **and**
   - the theme's `linked[]` instruments moved in the expected direction.

   All three, or it is `routine`. This is the guard against the classic failure mode —
   an LLM reading a headline and inventing a market narrative for a 0.2% drift.

   **As built** ([materiality.mjs](../agents/jarvis/materiality.mjs)): condition 3 is a
   *strict* majority, not "at least half". Building it surfaced the case — Nikkei
   +2.16% while KOSPI fell — where a 1-of-2 split would have confirmed a theme on a coin
   flip. A theme with no linked-instrument data fails closed rather than passing by
   default. Sigma uses the sample (n−1) standard deviation of daily returns over the
   trailing 20 *completed* sessions, reusing `completedDailyBars` so an in-progress
   session never contaminates the baseline.

   Observed live 2026-09-30: 16 publishers on Strait-of-Hormuz stories, including a
   naval-mine discovery, against Brent +0.09% (+0.03σ) — held at `routine`.
3. **Narrate** — only now call the model, and only to phrase the detected fact. The
   prompt receives numbers and headlines; it is instructed to add no causal claim beyond
   the co-occurrence, and its output is discarded if it cites a number not present in
   `evidence[]`.

### 6.4 Output

```jsonc
{
  "agent": "macro", "kind": "observation", "severity": "elevated", "confidence": 0.62,
  "title": "Brent +3.8% on Hormuz tanker reports; energy complex leading",
  "subjects": [{"type":"instrument","ref":"BZ=F"}, {"type":"theme","ref":"hormuz"},
               {"type":"sector","ref":"^CNXENERGY"}],
  "evidence": [
    {"source":"Yahoo Finance","value":87.30,"prior":84.10,"sigma":2.1,"fetchedAt":"…"},
    {"source":"Reuters via Google News","url":"https://…","publishedAt":"…"},
    {"source":"Bloomberg via Google News","url":"https://…","publishedAt":"…"}
  ],
  "expiresAt": "2026-09-30T10:00:00Z"
}
```

---

## 7. Agent 2 — Options Trading (`options`)

> **Hard boundary, stated once and enforced everywhere below:** this agent proposes.
> It never transmits an order. See §7.5.

### 7.1 Data source

The existing `/api/market` has no option chain — Yahoo's Indian options data is not
usable. Use **Kite Connect**:

| Need | Tool |
|---|---|
| Resolve monthly expiry contracts | `search_instruments` (segment `NFO-OPT`, name `NIFTY`) |
| Chain snapshot: LTP, OI, volume, bid/ask | `get_quotes` (batched by strike) |
| Underlying history for TA | `get_historical_data` on `NSE:NIFTY 50` |
| Margin check before proposing | `get_margins` |
| Existing exposure | `get_positions`, `get_holdings` |

Kite gives real OI and live bid/ask — which Yahoo cannot — and it is the same broker you
would execute through, so the prices in a proposal are the prices you would face.

The repo also has the **`options-trade-analyzer` skill** available, which fetches live
NSE chains and computes PCR, IV skew and Greeks. Use it as the analysis core rather than
reimplementing Black-Scholes; the agent's job is then to *frame* its output as a proposal
with evidence, not to do the quant from scratch.

### 7.2 Scan pipeline

```
1. EXPIRY       search_instruments → current monthly NIFTY expiry
                (skip weekly; the brief says monthly)

2. CHAIN        ATM ± 10 strikes, both legs.
                get_quotes batched → strike, LTP, OI, ΔOI, volume, bid, ask, IV

3. LIQUIDITY    Drop any strike with OI < 50,000 or (ask-bid)/mid > 2%.
   GATE         A "great" strategy on an illiquid strike is a bad strategy.
                This filter runs BEFORE analysis, not after.

4. TECHNICAL    get_historical_data on NIFTY, then the EXISTING functions:
                  marketMath.js  → signalSnapshot(), marketRegime()
                  tradeMath.js   → dailyLevels(), ATR(14), pivots, CPR
                No new indicator code.

5. VOL REGIME   India VIX (^INDIAVIX via /api/market) + chain IV
                → implied 1σ day move. Pulse.jsx already computes this — reuse it.

6. NEWS OVERLAY Pull macro signals from the bus where
                subjects[].ref ∈ {^NSEI, ^NSEBANK, INR=X, BZ=F}
                within the last 24 h. THIS is the "combines with latest news" step.

7. STRATEGY     Map (direction × vol regime × event risk) → structure. §7.3

8. SIZE         Risk budget from the journal's existing convention, then
                verify against get_margins. If margin insufficient → emit the
                proposal anyway, flagged "insufficient margin", never silently resized.
```

### 7.3 Strategy selection

Deterministic table, not a model judgement call. The model writes the rationale; the
table picks the structure.

| Directional read | IV percentile | Event within expiry | Structure |
|---|---|---|---|
| Bullish | low (<30) | no | Bull call spread |
| Bullish | high (>70) | no | Bull put spread (credit) |
| Bearish | low | no | Bear put spread |
| Bearish | high | no | Bear call spread (credit) |
| Neutral | high | no | Iron condor, short strikes ≥1.5σ |
| Neutral | low | no | **No trade.** Long premium on a neutral read is a fee. |
| Any | any | yes (budget/RBI/results) | Defined-risk only; no naked short legs |
| Any | any | <3 DTE | **No new proposals.** Gamma risk is not worth the edge. |

The two "no trade" rows matter more than the others. An agent that must produce an idea
every ten minutes will produce bad ideas. Silence is a valid output and the dashboard
shows it as such.

### 7.4 Proposal payload

```jsonc
{
  "kind": "proposal", "agent": "options",
  "action": {
    "type": "options_strategy",
    "requiresApproval": true,
    "payload": {
      "underlying": "NIFTY", "expiry": "2026-10-29", "structure": "bull_call_spread",
      "legs": [
        {"tradingsymbol":"NIFTY26OCT24800CE","side":"BUY","qty":75,"ltp":182.4,
         "bid":181.9,"ask":183.0,"oi":1843500,"iv":12.8},
        {"tradingsymbol":"NIFTY26OCT25000CE","side":"SELL","qty":75,"ltp":127.5,
         "bid":127.0,"ask":128.1,"oi":2210400,"iv":12.1}
      ],
      "netDebit": 4120, "maxProfit": 10880, "maxLoss": 4120,
      "breakeven": 24854.9, "rewardRisk": 2.64,
      "marginRequired": 4120, "marginAvailable": 186400,
      "costs": {"brokerage":40,"stt":0,"exchange":11,"gst":9,"stampDuty":1,"total":61},
      "invalidatedIf": "NIFTY closes below 24600, or India VIX > 18",
      "rationale": "…",
      "newsContext": ["sig_01JB7…"]
    }
  },
  "evidence": [ /* chain snapshot ts, VIX reading, the macro signals used */ ],
  "expiresAt": "2026-09-30T09:45:00Z"
}
```

`invalidatedIf` is not decoration — `options.intraday` re-evaluates it every 10 minutes
and emits an `urgent` signal when it trips. A proposal you approved this morning tells
you itself when its thesis broke.

Note `costs` — the planner already computes Indian charges precisely (STT, stamp duty,
NSE transaction, SEBI, GST, DP, brokerage with the intraday 0.03% cap, per
[README.md:33](../README.md#L33)). Extend that same module for F&O rather than writing a
second cost model.

### 7.5 Execution boundary

Kite exposes `place_order`, `place_gtt_order` and `modify_order`. **Jarvis must not hold
them.** Concretely:

- The options agent's tool allowlist contains only the read tools from §7.1. `place_*` is
  not merely unused — it is not in the allowlist, so a prompt injection arriving in a news
  headline cannot reach it.
- Dashboard **Approve** writes a decision record and renders a copy-ready order ticket.
  You place it in Kite yourself.
- This is also a constraint I operate under directly: I will not execute trades or
  transfer funds on your behalf, regardless of how the system is configured. Designing the
  boundary in from the start means the system never depends on something it cannot have.

If you later want one-click execution, the correct shape is a separate, explicitly
launched local CLI that reads an approved decision file and calls Kite — auditable,
outside the agent loop, invoked by you. Not a tool in an agent's belt.

---

## 8. Agent 3 — Momentum Stocks (`momentum`)

### 8.1 Reuse, don't rebuild

`buildScreen()` in [lib/nse.js](../lib/nse.js) already produces, for all of Nifty 500:
1-year momentum, relative strength vs Nifty 50, RSI, 50/200-DMA trend, 52-week-high
distance, volatility, volume surge, delivery %, and a 0–100 composite
([README.md:12](../README.md#L12)). `buildRadar()` adds delivery-based accumulation /
distribution / high-conviction / spike classification.

**The momentum agent is a consumer of `op=screen` and `op=delivery`, not a new screener.**
Its added value is three things the screener cannot do:

1. Intersect the ranked universe with *your* names.
2. Track rank *movement* over days — entries, exits, acceleration — which requires state
   the stateless endpoint does not keep.
3. Weight by learned preference (§8.3).

### 8.2 Universe assembly — the app watchlist is the source of truth

TradingView is out of scope: it publishes no watchlist API, and the only ways in are a
manual file export or cookie scraping. Neither earns its place when this app already has
a watchlist that is **already synced off-device**.

`api/push.js` stores `watch` in each device's subscription blob
([api/push.js:229](../api/push.js#L229)), written on preference changes and on entry to
Alerts. So the daemon reads your live watchlist from storage that already exists, with no
new sync path and no new UI:

```
universe = blob_watchlist         (push/subs/<id>.json → .watch — already synced)
         ∪ journal_symbols        (traded before = revealed interest)
         ∪ open_positions         (currently held)
         ∪ nifty500_top_decile    (from op=screen)
```

Each symbol carries a `source[]`, and the dashboard shows it. "This is here because it's
on your watchlist *and* top-decile" is a materially different statement from "this is here
because it's top-decile."

*Small prerequisite:* the daemon needs to know which subscription blob is yours. Simplest
is a one-line `JARVIS_DEVICE_ID` in the daemon config, copied once from the Alerts page.
If you later want the watchlist independent of push, promote `watch` to its own
`jarvis/watchlist.json` blob — a ~10-line change to `op=sync`.

### 8.3 The preference model — keep it honest

The brief asks for stocks "the system has learned to associate with the user's
preferences and past behaviours." The temptation is a black-box embedding. Resist it.
Build a **transparent linear score you can read and override**:

```
score(stock) = 0.40 · composite        (from buildScreen, already 0–100)
             + 0.20 · delivery_signal  (buildRadar conviction, normalized)
             + 0.15 · sector_affinity  (learned)
             + 0.15 · watchlist_bonus  (0 / 50 / 100 by source)
             + 0.10 · setup_match      (learned)
```

Only two terms learn, both from the `outcomes` table, both by a rule you can state in one
sentence:

- **`sector_affinity`** — EWMA (α = 0.1) over your journalled trades by sector. If 30% of
  your closed trades are financials against a 22% index weight, financials get a positive
  tilt. Decays if you stop trading them.
- **`setup_match`** — your journal already carries **setup tags** and per-setup expectancy
  in R ([README.md:36](../README.md#L36)). Weight a candidate by the realized expectancy
  of the setup it currently resembles. This is the single highest-value learning signal
  available, and it exists in your data already.

Three guardrails:

- **Cold start:** both learned terms are 0 until ≥20 closed trades. Below that the score
  is pure `buildScreen` + delivery, and the dashboard says so.
- **Bounded:** learned terms cap at ±15 points combined. Preference tilts the ranking; it
  cannot manufacture a top-decile name out of a weak one.
- **Inspectable and overridable:** the dashboard shows the five-term breakdown per stock,
  and you can pin a weight. A recommender you cannot argue with is a recommender you stop
  trusting.

### 8.4 Output

`routine` for daily rank changes. `notable` when a watchlist name enters the top decile
with a high-conviction delivery signal. `elevated` only when it coincides with a macro
signal on the same sector — which is Jarvis's correlation job (§4.3a), not this agent's.

---

## 9. Agent 4 — Personal Errands (`errands`)

### 9.1 Gmail access

The daemon uses the **Gmail REST API** with its own Google OAuth desktop client — not the
claude.ai Gmail connector, which is bound to a Claude session rather than to a background
process. Roughly an hour of setup: create an OAuth desktop client in Google Cloud Console,
run the device-code flow once, store the refresh token in Keychain.

**Scopes.** Start with the narrowest pair that does the job:

| Scope | Buys |
|---|---|
| `gmail.readonly` | read messages and threads for triage |
| `gmail.compose` | create drafts |

One honest caveat worth knowing before you grant it: **Google has no draft-only scope** —
`gmail.compose` includes the ability to send. So "drafts, never send" cannot be enforced
by the scope, and must be enforced in the daemon's Gmail wrapper, which exposes exactly
one write call (`users.drafts.create`) and no send path. That is code you own and can
test, and `tests/errands-classify.test.js` asserts it (§10.5). I am flagging it rather
than letting the design imply a guarantee the OAuth layer does not actually give.

*Optional later:* adding `gmail.modify` lets the agent apply `Jarvis/Urgent`,
`Jarvis/Bill` labels so triage shows up in your real Gmail client, not only the dashboard.
It is a materially broader grant (read/write on all mail bar permanent delete). Worth it
once you trust the classifier; not on day one.

### 9.2 Mail triage

Runs 07:00 and 19:00 IST. Classifies into five buckets by **deterministic rules first**,
model only for the residue:

| Bucket | Rule |
|---|---|
| `urgent` | sender ∈ pinned list, or subject matches deadline/expiry/suspension patterns, or a thread where you are the last-asked and >48 h have passed |
| `bill` | sender ∈ biller list, or body matches amount+due-date pattern → §9.3 |
| `travel` | PNR / booking-reference pattern → §9.4 |
| `action` | direct question addressed to you, unanswered |
| `noise` | everything else — counted, never summarized |

Gmail search does most of the narrowing before anything reaches the model —
`newer_than:2d -in:spam category:primary` keeps both cost and attack surface down.

The agent **reads and drafts. It never sends.** Drafts land in "Awaiting you" on the
dashboard and as real Gmail drafts, so you review and send from your normal client. This
is both a safety boundary and the right product: you do not want to discover what your
assistant said to your CA.

**Prompt-injection surface.** Email is the highest-risk input in this system — it is
attacker-controlled text arriving on a schedule. Four mitigations, all necessary:

1. Email bodies enter the model wrapped in an explicit data envelope, and the classifier
   prompt returns **only a bucket label and a span reference**. It has no tool access at
   all. A separate, tool-bearing step acts on the label, never on the text.
2. The errands agent's allowlist contains no send path (§9.1).
3. Any URL extracted from mail is displayed, never fetched, never navigated. If a "bill"
   wants paying, you get the amount, the due date and the sender — and you go to the
   biller yourself.
4. Draft bodies are assembled from templates plus your own prior text, never by echoing
   instructions found in the incoming message.

### 9.3 Bills

Two sources, reconciled:

- **Mail-derived** — parse amount, due date, biller from the `bill` bucket.
- **Recurring ledger** — `~/.alphanova/bills.json`, maintained by the agent as it learns
  your monthly pattern (rent, SIPs, cards, utilities, premiums), each entry with a typical
  amount and due day.

The agent flags: *due in ≤3 days and no payment confirmation seen*, *amount >1.5× the
trailing median for that biller*, and *expected-but-absent* — the recurring bill that did
not arrive, which is the failure mode that actually costs you a late fee.

Payment is never attempted. Not a capability limitation — a design choice, and one I hold
to regardless of configuration.

### 9.4 Travel

Realistic scope, stated plainly: **no agent should be booking your flights unattended, and
none here does.**

What it does do:
- Parse confirmations from Gmail into a trip ledger; push on schedule changes and when web
  check-in opens.
- On request ("Mumbai → Delhi, 14 Oct, morning"), assemble a comparison — carriers, times,
  fares, fare rules — and present it with deep links. Research, laid out.
- Cross-check against your calendar for conflicts before you commit. Google Calendar is
  the same OAuth client as Gmail, so `calendar.readonly` is one extra scope on a consent
  screen you are already building.

Booking itself — payment, passenger details, ticketing — is yours. The agent gets you to
the checkout page with the decision already made.

---

## 10. Cross-cutting concerns

### 10.1 Secrets

| Secret | Lives | Never |
|---|---|---|
| Kite API key / access token | macOS Keychain, read at daemon start | in the repo, in Blob, in Vercel env |
| Google OAuth refresh token | Keychain | as above |
| `JARVIS_INGEST_SECRET` | Keychain + Vercel env | in the client bundle |
| `ANTHROPIC_API_KEY` | Keychain | as above |

`.env.local` today holds only `BLOB_READ_WRITE_TOKEN` and `VERCEL_OIDC_TOKEN`, and
`.gitignore` covers it. **Do not put broker or Google credentials there** — that file sits
in `~/Downloads`, gets copied around, and is one `vercel env pull` away from surprises.
Keychain, via a small `security find-generic-password` helper at daemon start.

### 10.2 Tool allowlists

Enforced by the runtime, per agent. This is the primary containment mechanism and it is
worth being explicit:

| Agent | Allowed | Notably absent |
|---|---|---|
| `macro` | `fetch` → `/api/market` only | everything else |
| `options` | Kite read tools, `/api/market`, options-trade-analyzer | `place_order`, `place_gtt_order`, `modify_order`, `cancel_order` |
| `momentum` | `/api/market`, watchlist blob (read) | any write, any broker tool |
| `errands` | `gmail.users.messages.get/list`, `drafts.create`, calendar read | any send path, delete, payment, `fetch` of arbitrary URLs |
| `jarvis` | signal bus, ingest endpoint, push `send()` | every data and action tool |

### 10.3 Budget governor

Per-task budgets are in the Task envelope; Jarvis also enforces a **daily ceiling**
(default 500k tokens). At 80% it drops `macro.intraday` to 30-minute cadence; at 95% only
`urgent` paths run. The dashboard shows the meter (§5.2) — an agent system whose cost you
cannot see at a glance is one you will eventually switch off in annoyance.

Rough steady-state estimate, for sizing only: ~60 model calls/weekday, ~8k tokens each
→ ~500k tokens/day. Most of the pipeline is deterministic by design, which is what keeps
this number down.

### 10.4 Observability

- `runs` table: task id, agent, tokens, wall time, tool calls, exit status.
- Structured JSONL at `~/.alphanova/logs/jarvis-YYYY-MM-DD.jsonl`.
- `agents/jarvis/replay.mjs <taskId>` — re-run a task against its recorded inputs. When a
  proposal looks wrong three days later, you need to see what the agent actually saw.

### 10.5 Testing

Extend the existing `node --test tests/*.test.js` — no new framework.

| File | Covers |
|---|---|
| `tests/jarvis-bus.test.js` | envelope validation; **evidence-less signal is rejected**; `requiresApproval` forced true |
| `tests/jarvis-correlate.test.js` | convergence, contradiction, stale-conviction detection on fixtures |
| `tests/macro-materiality.test.js` | the 3-condition gate — a 0.2% move with a loud headline must stay `routine` |
| `tests/options-strategy.test.js` | strategy table incl. both no-trade rows; liquidity gate |
| `tests/momentum-score.test.js` | cold start yields zero learned weight; learned terms stay within ±15 |
| `tests/errands-classify.test.js` | rule-based buckets; **the Gmail wrapper exposes no send path**; injected "ignore previous instructions" text does not change the bucket |

The last one deserves a real adversarial corpus, not one token case.

---

## 11. Decisions taken (2026-09-30)

| Question | Decision | Consequence |
|---|---|---|
| Mail backend | **Gmail**, own OAuth desktop client in the daemon | §9.1. No Microsoft Graph work. Caveat: no draft-only scope exists — boundary enforced in code, tested |
| Runtime | **Local `launchd` daemon** | §1. Full intraday cadence, ₹0, secrets stay on the Mac. Approvals only work at this machine (§5.3) |
| GIFT Nifty | **Out of scope** | §6.1. Overnight brief omits it rather than fabricating it. NSE IX has a public JSON API if you revive it |
| TradingView watchlist | **Out of scope** | §8.2. The app watchlist — already synced to Blob — is the source of truth. Removes a manual export step entirely |

Two of these cut work rather than adding it: dropping TradingView removed a whole ingest
path in favour of plumbing that already exists, and dropping GIFT Nifty removed the only
component with no reliable source.

**Still open, neither blocking:**

1. **Options underlyings** — NIFTY only, or BANKNIFTY and FINNIFTY too? Affects the
   liquidity-gate thresholds in §7.2, not the architecture. Default if unanswered: NIFTY
   only.
2. **Risk budget** — the equity planner defaults to 0.5% per trade. Same for options
   proposals, or a separate, smaller F&O budget? Default if unanswered: 0.5%, flagged in
   each proposal so it is visible rather than assumed.

---

## 12. Build order

Each phase ends with something usable. Nothing is blocked.

| Phase | Deliverable | Depends on |
|---|---|---|
| ~~**1. Skeleton**~~ ✅ | `agents/jarvis/` runtime, launchd plist, signal bus, SQLite memory, envelope validation + tests, `cli.mjs` | — |
| ~~**2. Macro agent**~~ ✅ | `^KS11` in `data.js` + Pulse; `op=macronews`; materiality gate + tests; brief composer | 1 |
| ~~**3. Dashboard**~~ ✅ | **standalone** dashboard served by the daemon on `127.0.0.1:7777`; signal stream, evidence expansion, agent health, budget meter, approvals | 1, 2 |
| **4. Momentum agent** (~1 day) | watchlist read from the push blob, universe assembly, rank tracking, score *without* learned terms (cold start) | 1, 3 |
| **5. Escalation** (~half day) | severity → push via existing `api/push.js`; urgent cap; budget governor + meter | 3 |
| **6. Options agent** (~2 days) | Kite read integration, chain snapshot, liquidity gate, strategy table, proposal cards, `invalidatedIf` monitor | 1, 3, 5 |
| **7. Errands agent** (~2 days) | Google OAuth client, Gmail triage, bill ledger, draft-only replies, travel parsing, injection test corpus | 1, 3 |
| **8. Correlation** (~1 day) | convergence / contradiction / stale-conviction; merged signals; conflict cards | 2, 4, 6 |
| **9. Learning loop** (~1 day) | `outcomes` capture at T+1/5/20, `sector_affinity`, `setup_match`, breakdown UI, override pins | 4, 8, ≥20 closed journal trades |

Phases 1–3 are the real commitment: after them you have a working agent system with one
agent and a dashboard, and every later phase is an additive module against a stable
contract. Total ≈ 10–11 working days.
