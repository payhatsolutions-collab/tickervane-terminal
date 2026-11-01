# NIFTY EDGE in F&O

The F&O workspace now offers NIFTY EDGE and the existing option-chain/futures desk.
The local `/Users/sarda/Downloads/nifty-edge` application is unchanged.

The hosted desk uses a same-origin frame under `/nifty-edge/index.html` and one Python function, `/api/nifty_edge?op=snapshot` (or `op=lab`). Math/model code is copied from the supplied app. Per-instance cache: 60 seconds in market hours, 5 minutes outside them; refresh cannot bypass it. No scheduled jobs, paid services or plan upgrade added.

## Data and persistence

- Live NSE quotes, current expiry-specific market lots and daily price refresh run on demand.
- Daily history writes only to temporary storage and can be reconstructed from the bundled seed plus Yahoo. Missing recent sessions prevent a live model response.
- The evidence lab, participant OI and signal history are versioned with the deployment. Their displayed dates must be respected. Frozen directional scores are not treated as current signals.
- Closed markets, stale/missing timestamps or unverified lot sizes suppress trade calls.
- Each visitor's paper journal is stored in their own browser. Only the first fresh call they view per session is recorded. Clearing browser storage removes it. Settlement happens on a later visit when the expiry close is available (recent 200 sessions). This is not an unattended or synced journal.
- No local journal, risk settings, credentials or raw historical archive is published.

## Refresh the research version

Run the original app's history and lab maintenance locally, then:

```sh
../nifty-edge/.venv/bin/python scripts/refresh-nifty-edge-seed.py ../nifty-edge
```

Rebuild and stage a new deployment, test the snapshot and lab endpoints, and promote it. The seed export does not change the original app.

## Free-plan limits

Hobby is restricted to personal, non-commercial use and includes finite CPU, memory and request allowances. This design avoids the local app's continuous process and 30-minute maintenance loop, but traffic can exhaust free allowances. NSE can also refuse cloud requests independently of hosting plan. No guarantee of unlimited usage or data availability.
