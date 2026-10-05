# Jarvis — phases 1–3

A standalone Chief-of-Staff agent system: a local daemon that schedules specialist
agents, collects evidence-backed signals, and serves **its own dashboard**. See
[docs/JARVIS-BLUEPRINT.md](../../docs/JARVIS-BLUEPRINT.md).

- **Phase 1** — orchestration: scheduler, signal bus, memory, budget governor, CLI.
- **Phase 2** — the first agent: `macro` (market research & news), plus brief composition.
- **Phase 3** — the dashboard, served by the daemon at `http://127.0.0.1:7777`.

`momentum`, `options` and `errands` are not registered yet. Their scheduled rules fire,
record `skipped — no handler registered`, and say so in `health` and on the dashboard.
A daemon that pretended otherwise would be worse than one reporting the gap.

Jarvis is self-contained and is not part of any other application. It reads market data
over HTTP from a market API (configurable — see *Data source* below) and stores
everything else itself.

## The dashboard

```bash
npm run jarvis:dashboard      # dashboard only, on http://127.0.0.1:7777
npm run jarvis:daemon         # agents + dashboard together
```

It shows what is above routine right now, the latest brief, per-agent health, today's
token budget, anything awaiting your approval, and the full signal stream — every signal
expanding to the evidence behind it.

Bound to `127.0.0.1`, with the `Host` header checked on every request, so it is not
reachable from the network and a page you visit elsewhere cannot address it. Because the
page and the daemon share an origin, **Approve and Dismiss work in the browser**:
approving records your decision and prints the order ticket for you to place. It never
transmits an order — the options agent has no order tool in its allowlist at all.

## Try it

```bash
npm run jarvis -- schedule          # upcoming fire times, IST
npm run jarvis -- health            # budget, agent status, today's signal counts
npm run jarvis -- signals --evidence --body
npm run jarvis -- tick              # run one scheduler tick right now
npm run jarvis -- serve             # dashboard without the agent loop
```

Run the macro agent and read the brief it feeds:

```bash
npm run jarvis -- run macro overnight_wrap
npm run jarvis -- run macro geopolitical_scan
npm run jarvis -- brief overnight
```

### Data source

Agents read quotes, charts and news from `JARVIS_MARKET_BASE` (default
`https://alphanova48.in`, which exposes the market API in this checkout). It is a
backend detail behind one module, [market.mjs](market.mjs) — nothing in the Jarvis UI
refers to it, and swapping in a direct feed or a broker API is a single file.

```bash
JARVIS_MARKET_BASE=http://localhost:5177 npm run jarvis -- run macro delta_scan
```

Emit a signal by hand to see the envelope rules bite:

```bash
# accepted
npm run jarvis -- emit '{"agent":"macro","kind":"observation","severity":"elevated",
  "title":"Brent +3.8% on Hormuz reports",
  "subjects":[{"type":"instrument","ref":"BZ=F"}],
  "evidence":[{"source":"Yahoo Finance","value":87.3}]}'

# rejected — no evidence
npm run jarvis -- emit '{"agent":"macro","kind":"observation","title":"Feels bullish","evidence":[]}'
```

## Install as a background service

```bash
cp agents/jarvis/in.alphanova.jarvis.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/in.alphanova.jarvis.plist
```

`launchctl unload …` stops it gracefully. The plist hardcodes this checkout's path and
`/Users/sarda/.local/bin/node`; edit both if either moves.

## Layout

| File | Role |
|---|---|
| `runtime.mjs` | the daemon — tick loop, dispatch, budget governor, signal handling |
| `scheduler.mjs` | `schedule.json` → due tasks, with guards |
| `schedule.json` | the cron table (§4.2). Data, not code |
| `cron.mjs` | 5-field cron matcher, evaluated in IST. No dependency |
| `envelope.mjs` | signal + task validation. **Where the two invariants live** |
| `bus.mjs` | append-only JSONL log + SQLite index, subscribe/emit |
| `memory.mjs` | SQLite: signals, subjects, outcomes, preferences, runs |
| `registry.mjs` | agent registration and the tool allowlist boundary |
| `config.mjs` | paths, IST helpers, Keychain access |
| `ulid.mjs` | sortable ids |
| `cli.mjs` | inspection commands |
| `server.mjs` | the dashboard server — loopback only, serves `public/` and the JSON API |
| `public/index.html` | the dashboard: one self-contained page, no build, no CDN |
| `market.mjs` | the agents' only data tool — a client over a market API |
| `materiality.mjs` | the 3-condition gate (§6.3). **No model calls** |
| `brief.mjs` | folds the bus into the three daily briefs (§4.5) |
| `agents/macro.mjs` | agent 1 — market research & news |
| `agents/jarvis-self.mjs` | brief composition and retention |
| `agents/index.mjs` | registration — one line per agent |

## The materiality gate

`materiality.mjs` is the reason the macro agent cannot invent a narrative. A headline
becomes material only when all three hold:

1. **move** — the lead instrument moved ≥1.5σ of its own trailing 20-session daily return
2. **publishers** — ≥2 distinct outlets carried the theme in the last 6 hours
3. **coherence** — a *strict* majority of the theme's linked instruments moved the way
   that theme's correlation structure predicts

Nothing in it calls a model; the model (later) only phrases what the arithmetic found,
and may only restate numbers already present in `evidence[]`. Failing any condition is
not an error — it is a `routine` signal. Most hours of most days are routine, and a
system that cannot say so is not measuring anything.

Observed live on 2026-09-30: 16 publishers were running Strait-of-Hormuz stories,
including a naval-mine discovery, while Brent moved +0.09% (+0.03σ). The gate held it at
`routine`. That is the whole point.

Macro observations top out at `elevated`. `urgent` is reserved for position risk and
capped at 3/day (§4.4) — spending that budget on a commodity move would defeat the cap.

Themes live in `api/market.js` (`THEMES`) so the endpoint and the agent cannot drift
apart, and a test asserts every theme instrument exists in the terminal's directory.

## The two invariants

Both are enforced in `envelope.mjs`, on the write path, so no agent can route around
them by "writing to the bus directly":

1. **`evidence[]` must be non-empty.** A signal an agent cannot substantiate is
   rejected. This is the defence against a model narrating a market story with no data
   behind it, and it mirrors the terminal's existing stance that unavailable data stays
   unavailable.
2. **`action.requiresApproval` is forced `true`** for `options_strategy`,
   `equity_order`, `send_email`, `booking` and `payment` — overwriting whatever the
   agent set. An agent cannot opt itself out.

`registry.mjs` adds the third boundary: an agent declaring a tool outside its allowlist,
or any tool in `FORBIDDEN` (order placement, mail send, payment), fails to register at
all. Containment is a startup error, not a runtime hope.

## Storage

Everything lives under `~/.alphanova/` (override with `JARVIS_HOME`):

```
jarvis.db              SQLite query index — rebuildable
signals/2026-09-30.jsonl   durable append-only log — the source of truth
logs/jarvis-2026-09-30.jsonl
briefs/
```

The JSONL log is authoritative. A lost or corrupted database is recoverable:

```bash
rm ~/.alphanova/jarvis.db*
npm run jarvis -- reindex
```

## Secrets

Never in `.env.local` — that file sits in `~/Downloads` and gets copied around. The
daemon reads from the Keychain:

```bash
security add-generic-password -a "$USER" -s jarvis.kite.token -w
security add-generic-password -a "$USER" -s jarvis.anthropic.key -w
```

`config.mjs: secret(name)` returns `null` when a secret is absent rather than throwing,
so a missing credential shows up as one degraded agent instead of a dead daemon.

## Tests

```bash
npm test          # 161 tests
```

| File | Covers |
|---|---|
| `tests/jarvis-envelope.test.js` | the two envelope invariants, ULID ordering |
| `tests/jarvis-bus.test.js` | bus, memory, correlation primitives, retention |
| `tests/jarvis-schedule.test.js` | cron/IST correctness, guards, registry containment, budget governor |
| `tests/jarvis-macro.test.js` | the materiality gate, theme config, brief composition |
| `tests/jarvis-server.test.js` | dashboard API, approvals, loopback guard, path traversal, CSP |

`npm test` points `JARVIS_HOME` at a temp directory, so running the suite never touches
the real store.

## Next

Phase 4 is the `momentum` agent. Adding an agent is unchanged from the contract phase 1
fixed: register into `Registry` with a `tools` allowlist, and return
`{signals, tokens, toolCalls}` from each intent handler. `agents/macro.mjs` is the
worked example, and a new agent appears on the dashboard with no UI work.
