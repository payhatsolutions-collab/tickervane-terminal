"""Paper journal: the first call of every session is logged automatically --
including NO TRADE days, whose shadow condor is tracked too. After expiry each
entry is settled against the NIFTY close, so the app accumulates a live,
out-of-sample record of both its trades and its abstentions."""
from __future__ import annotations

import json
import threading
from datetime import datetime

import numpy as np
import pandas as pd

from . import history, lab

JOURNAL = history.DATA / "journal.json"
_lock = threading.Lock()


def _load() -> list[dict]:
    try:
        return json.loads(JOURNAL.read_text())
    except (OSError, ValueError):
        return []


def _save(rows: list[dict]):
    JOURNAL.write_text(json.dumps(rows, indent=1))


def log(snap: dict):
    rec = snap.get("rec") or {}
    if rec.get("action") not in ("TRADE", "NO TRADE"):
        return
    legs, met, shadow = rec.get("legs"), rec.get("metrics"), False
    if rec["action"] == "NO TRADE":
        sh = rec.get("shadow") or {}
        legs, met, shadow = sh.get("legs"), sh.get("metrics"), True
    if not legs or not met:
        return
    day = snap["data_time"][:10]
    with _lock:
        rows = _load()
        if any(r["date"] == day for r in rows):
            return
        rows.append({
            "date": day, "logged_at": snap["generated"], "expiry": rec["expiry"],
            "action": rec["action"], "structure": rec.get("structure") or (rec.get("shadow") or {}).get("structure"),
            "shadow": shadow,
            "legs": [{"right": l["right"], "qty": l["qty"], "strike": l["strike"], "price": l["price"]}
                     for l in legs],
            "credit": met["credit"], "max_loss": met["max_loss"], "lot": rec.get("lot"),
            "lots": rec.get("lots", 0), "spot": snap["levels"]["spot"], "iv_rv": rec.get("iv_rv"),
            "est_pts": (rec.get("conditional", {}).get("iron_condor") or {}).get("estimate_pts"),
            "status": "open",
        })
        _save(rows)


def settle(daily: pd.DataFrame):
    with _lock:
        rows = _load()
        changed = False
        for r in rows:
            if r["status"] != "open":
                continue
            ex = pd.Timestamp(datetime.strptime(r["expiry"], "%d-%b-%Y").date())
            if ex not in daily.index:
                continue
            S_E = float(daily.loc[ex, "close"])
            pnl = 0.0
            cost = 0.0
            for l in r["legs"]:
                pay = max(S_E - l["strike"], 0) if l["right"] == "CE" else max(l["strike"] - S_E, 0)
                pnl += l["qty"] * (pay - l["price"])
                cost += lab.COST_FIXED + lab.COST_PROP * l["price"]
                if l["qty"] > 0:
                    cost += lab.EXERCISE_STT * pay
            r.update(status="settled", settle=S_E, pnl_pts=round(pnl - cost, 2),
                     R=round((pnl - cost) / r["max_loss"], 3) if r["max_loss"] else None)
            changed = True
        if changed:
            _save(rows)


def summary() -> dict:
    rows = _load()

    def agg(sub):
        s = [r for r in sub if r["status"] == "settled"]
        pts = [r["pnl_pts"] for r in s]
        return {"n": len(sub), "settled": len(s), "open": len(sub) - len(s),
                "wins": int(sum(p > 0 for p in pts)),
                "total_pts": round(float(np.sum(pts)), 1) if pts else 0.0,
                "avg_pts": round(float(np.mean(pts)), 2) if pts else None,
                "avg_R": round(float(np.mean([r["R"] for r in s if r.get("R") is not None])), 3) if s else None}

    return {"traded": agg([r for r in rows if not r["shadow"]]),
            "stood_aside": agg([r for r in rows if r["shadow"]]),
            "rows": sorted(rows, key=lambda r: r["date"], reverse=True)[:60]}
