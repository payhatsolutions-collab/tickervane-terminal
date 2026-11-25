# Forecast accuracy work — 27 October 2026

## Scope and target

The Forecast layout, controls, copy and styling are preserved. The target is the
adjusted close ten completed trading sessions after the forecast origin, expressed
as a return from the adjusted close at that origin. Crypto uses calendar days.
The existing 5-, 20- and 30-session model interfaces remain supported.

## Correctness changes

- Remove the unconditional 30-session drift added after model selection. The
  displayed median, prediction bands and returned probability samples now describe
  the same distribution. A trend can earn selection as an explicit candidate.
- Select directional models using mean absolute error in the actual horizon's
  simple return, rather than selecting solely for interval sharpness and coverage.
  A directional model must improve tuning point error by at least 5%, with weighted
  interval score no more than 5% worse than the unchanged-price baseline. A model
  with identical point forecasts can win on at least 5% better interval score.
- Repeat selection at each historical forecast origin, using only outcomes whose
  targets have already completed. Use up to 32 recent, non-overlapping target
  periods; require 14 completed origins before selecting away from baseline.
- Keep price error, root mean squared return error, directional call coverage,
  accuracy conditional on a directional call, interval coverage and Brier score
  separate. A neutral forecast is not credited as a directional win.
- Use the same forecast construction during fitting/evaluation and live inference.
  Historical simulations use 512 paths and live inference 4,096 seeded paths;
  their simulation precision differs, while the model and price formula agree.
- Only Forecast admits a same-day closing candle. It requires exchange-provided
  session boundaries, a quote within five minutes of the close, and both a data
  fetch and the current time at least fifteen minutes after the close. Missing or
  inconsistent evidence preserves the previous-session filter. Other workspaces
  keep their existing completed-bar rules.

## Model experiments

The original six candidates remain the production family. Additional research
candidates, enabled by `experimentalMeans`, are an explicit
30-session trend and ridge regression trained directly on the full forecast
horizon. The latter never uses a training label ending beyond its current origin.
Its fixed ridge penalty is multiplied by the horizon to account conservatively
for overlapping training labels.

An offline context experiment adds volume relative to the previous twenty
observations and dated market/sector returns and relative strength over five and
twenty observations. It uses exact historical date matches, fits normalization
within each training window, and rejects missing latest factors instead of
substituting made-up values. It does not require future market/sector paths.
The context experiment is enabled by `experimentalContext`. The added candidates
did not earn selection in the development assessment and remain outside the
production family. No additional live factor requests are made.

## Registered historical assessment

The configuration lives in `scripts/forecast-benchmark-config.json`. It fixes the
universe, horizon, partitions and comparison thresholds before the final period
is opened. Eight NSE stocks cover energy, technology, banking, healthcare, FMCG,
metals and auto. Apple, Microsoft, Bitcoin and Ethereum extend the coverage.
Nifty 50, relevant sector indices, S&P 500 and XLK supply context where available.

Download and freeze five years of adjusted daily history. SHA-256 fingerprints
check every input file. Reserve the final 126 observations of each instrument for
the locked assessment; use the preceding 252 observations for development. Issue
forecasts every ten observations, starting with at least 504 observations of
training. Each successive forecast may use outcomes that have completed by that
date, including earlier outcomes in the assessment period.

Compare the actual displayed v3.1 forecast, the corrected original candidate
family, the expanded accuracy family, the context experiment, an unchanged-price
baseline and an unconditional simple-trend baseline. The v3.1 benchmark shifts its
returned samples by its displayed trend overlay so it scores the number users
actually received. Report results by instrument, NSE/US/crypto group and the
past sixty-observation trend regime. Paired calendar-month block resampling gives
exploratory uncertainty estimates while retaining common market moves.
The two direct regressions are also assessed unconditionally, with their input
availability reported, so rejection by the selection gate is distinguishable from
an untested candidate.

Reproduction:

```sh
node scripts/forecast-benchmark.mjs snapshot
node scripts/forecast-benchmark.mjs development
node scripts/forecast-benchmark.mjs holdout
```

An optional output-directory argument creates an independent snapshot. The script
archives the v3.1 model from commit
`ab21308d0cd8f56f28c4e5ca72c11171be7f988e`. Reopening an existing final assessment
with changed model/benchmark code is rejected. Raw data and detailed reports live
under the ignored `outputs/forecast-accuracy-2026-10-27/` directory.

## Limits

This fixed convenience universe is not a survivorship-free exchange panel. The
download contains currently adjusted history rather than point-in-time data
vintages; historical revisions and corporate-action adjustments are not recreated
as they were known each day. Missing sessions are not invented or forward-filled.
Existing checks reject invalid prices and duplicate/non-chronological sessions,
and gaps over seven calendar days are flagged. Inputs and targets use the same
provider. Results on a small number of monthly blocks have substantial
uncertainty and do not establish future predictive skill.

## Measured results

The frozen dataset contains all 12 registered instruments and all 10 distinct
context series, with no download failures. Development uses 300 forecasts;
the locked final assessment uses 144 forecasts, twelve per instrument. The
production family was settled using development results before the final
assessment was opened. Its source fingerprint was checked again afterwards.

The primary error below is mean absolute error in the ten-session simple return,
in percentage points relative to the price at the forecast origin.

| Method | Development error | Final assessment error | Final assessment RMSE |
| --- | ---: | ---: | ---: |
| Previous v3.1 displayed forecast | 4.597 | 5.411 | 7.048 |
| Corrected production forecast | 3.860 | 4.340 | 5.918 |
| Unchanged-price baseline | 3.856 | 4.334 | 5.916 |
| Expanded mean-model selection (research) | 3.860 | 4.351 | 5.926 |
| Context-model selection (research) | 3.860 | 4.341 | 5.921 |
| Direct horizon ridge, unconditional | 3.947 | 4.368 | 6.040 |
| Direct context ridge, unconditional | 4.005 | 4.449 | 6.121 |

The corrected production forecast reduces final-assessment point error by 19.80%
relative to v3.1; development reduction is 16.03%. Final group errors (old → new)
are NSE 4.719 → 3.908, US 6.772 → 4.949 and crypto 6.817 → 5.458.
The 80% interval contains 76.39% of final outcomes, versus 66.67% previously;
the 95% interval contains 93.75%, versus 88.89% previously.

There is no demonstrated advantage over the unchanged-price baseline: production
point error is 0.126% higher, with an exploratory monthly-block skill interval
spanning zero. Production makes a directional call on only four of 144 forecasts,
with two correct. Most projections therefore stay near the last completed close.
This is a conservative fallback, not evidence of a useful up/down prediction.

Neither added model family improved development results; they were kept outside
the production defaults before the locked assessment. Their final results also
show no incremental point-error benefit. The unconditional context model has all
144 final inputs available; it has 277 of 300 development inputs, with baseline
fallbacks explicitly included in that development result.

Only six calendar-month blocks occur in the final assessment. Its exploratory
resampling interval for error reduction against v3.1 is 18.28%–21.97%; these
figures describe this sample and are not a future accuracy guarantee. No model
or threshold was changed after the final assessment was opened.

Full derived metrics, per-symbol and regime results, source fingerprints and
input-file fingerprints are preserved in
[`forecast-accuracy-results-2026-10-27.json`](forecast-accuracy-results-2026-10-27.json).
The original raw snapshots and individual forecast records remain in the ignored
output directory for local reproduction.

## Verification

All 314 regression tests pass. The production build passes. Tests exercise the
former double-trend case, agreement between displayed medians and probability
samples, future-data leakage, historical selection against prefix-only runs,
direct-horizon training targets, missing context, settlement timing, US daylight
saving, source normalization and the actual forecast worker's message handling.

A local browser using frozen development data rendered RELIANCE, accepted TCS
through the existing ticker form, and rendered its calculated result. The Forecast
JSX markup was compared with the previous source and is identical; only the
history-preparation import and invocation changed in that component. Its screenshot
is `outputs/forecast-accuracy-2026-10-27/forecast-browser-check.png`. This work is
implemented and verified locally, then deployed on 27 October 2026.

Method references: [rolling-origin validation and horizon-specific errors](https://otexts.com/fpp3/toolbox.html#time-series-cross-validation),
[weighted interval score](https://arxiv.org/abs/2005.12881).

## Production deployment

Published `dpl_BWVXCv4JXeN5q9k1NhAXi59RPa4T`
(`https://alphanova2-awyv6bibe-wdcre.vercel.app`) to
[Alpha Nova](https://alphanova48.in/forecast) on 27 October 2026. The hosted
build passed. All 13 public app routes return HTTP 200 with the new app bundle.
The production forecast worker exactly matches the tested local worker, and its
staged calculation using real adjusted history matches the source model.
The public daily-history response includes the exchange-session metadata. Quotes,
registration status and push configuration endpoints are healthy, and both
existing alternate domains redirect to the main domain.

A browser rendered the live RELIANCE forecast at 1,201.80 INR for 8 November 2026.
The existing markup and stylesheet are preserved. Live screenshot:
`outputs/forecast-accuracy-2026-10-27/forecast-live.png`. Deployment details and
rollback instructions are recorded in
[`forecast-accuracy-deployment-2026-10-27.json`](forecast-accuracy-deployment-2026-10-27.json).

## What the page shows (17 November 2026)

The model, its candidates and its selection rules are unchanged from the assessment above, and
`src/forecastModel.js` was not edited. Only the Forecast card changed.

Because no candidate beat an unchanged price, the selected model is usually the random walk, so the
single number the card used to show equalled the last close and read `+0.00% trend projection` for
almost every ticker. Once each Pro workspace opened on a free example, every visitor saw that.

The card now leads with what the model is measured to do well:

- **Likely range**: the 80% band at the horizon, labelled "8 in 10 outcomes". Prices of 1,000 or more
  are rounded to whole numbers in this headline only.
- **Centre**: the median. When it is within 0.05% of the last close the card says "No clear direction";
  otherwise it gives the change from the last close.
- **Trend what-if**: where the price would be if the slope of the last 30 sessions carried on for the
  horizon (`src/forecastScenario.js`, using the existing `trendDriftPerDay`, capped at 1% a session).
  It is a scenario beside the forecast, never part of it. The card says so, and that extending the
  trend tested less accurate than assuming no change. A flat trend shows "no trend to extend".
- **This ticker's record**: how many of its own past evaluation forecasts finished inside their 80%
  band, taken from `evaluation.count` and `evaluation.selected.coverage80`.

The earlier trend overlay was removed because it changed the forecast itself (final-assessment error
5.411 against 4.340). The what-if does not: the median, bands and samples still describe one
distribution. The paywall's illustrative Forecast sample and the Pro copy in `lib/proCopy.js` were
updated to describe a range with a what-if, replacing a projected price of +4.50%.

Checks: `node --test tests/forecast.test.js tests/workspace-render.test.js`.
