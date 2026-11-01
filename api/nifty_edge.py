"""On-demand NIFTY EDGE. No background threads or shared visitor journal."""
import json
import math
import os
import shutil
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(tempfile.gettempdir()) / 'alphanova-nifty-edge-v2'
DATA.mkdir(parents=True, exist_ok=True)
for source in (ROOT / 'nifty_edge' / 'seed').glob('*'):
    target = DATA / source.name
    if not target.exists():
        shutil.copy2(source, target)
os.environ['NIFTY_EDGE_DATA'] = str(DATA)

import numpy as np
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from nifty_edge.edge import lab
from nifty_edge.edge.engine import Engine, now_ist

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_lock = threading.Lock()
_engine = None
_cache = {}


def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return float(value) if math.isfinite(value) else None
    return value


@app.get('/api/nifty_edge')
def handle(op: str = 'snapshot', capital: float = Query(1_000_000, ge=0, le=1e10),
           risk_pct: float = Query(2.5, ge=0.1, le=10), max_lots: int = Query(10, ge=1, le=100)):
    global _engine
    headers = {'Cache-Control': 'private, no-store'}
    if op == 'lab':
        return JSONResponse(lab.load() or {'error': 'Evidence lab unavailable'}, headers=headers)
    if op != 'snapshot':
        return JSONResponse({'error': 'Unknown operation'}, status_code=400, headers=headers)
    if not all(math.isfinite(v) for v in (capital, risk_pct)):
        return JSONResponse({'error': 'Risk settings must be finite'}, status_code=422, headers=headers)
    key = (round(capital), round(risk_pct, 2), max_lots)
    # Serialize use of the engine and daily-file updates within each instance.
    with _lock:
        try:
            if _engine is None:
                _engine = Engine()
            ttl = 60 if _engine.cal.market_open(now_ist()) else 300
            hit = _cache.get(key)
            if hit and time.time() - hit[0] < ttl:
                return JSONResponse(hit[1], headers=headers)
            snap = clean(_engine.snapshot(dict(zip(('capital', 'risk_pct', 'max_lots'), key))))
            snap['hosting'] = {'lab_mode': 'versioned', 'journal_mode': 'browser'}
            if len(_cache) >= 50:
                _cache.clear()
            _cache[key] = (time.time(), snap)
            return JSONResponse(snap, headers=headers)
        except Exception as exc:
            # No traceback, paths or configuration details are exposed publicly.
            print('NIFTY EDGE snapshot failed:', type(exc).__name__)
            return JSONResponse({'error': 'Live NSE data or current daily history is unavailable. Please retry shortly.'}, status_code=503, headers=headers)
