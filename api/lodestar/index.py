"""Run the unchanged Lodestar model for companies outside published snapshots."""
import threading
import time
import tempfile
from pathlib import Path
import yfinance as yf
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from lodestar_engine.engine import analyze, AnalysisError

yf.set_tz_cache_location(str(Path(tempfile.gettempdir()) / 'alphanova-lodestar-yf'))
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_cache = {}
_lock = threading.Lock()
# Bound simultaneous upstream fan-out and reuse results on warm instances.
_slots = threading.BoundedSemaphore(3)
TTL = 900


def report(symbol):
    with _lock:
        cached = _cache.get(symbol)
        if cached and time.monotonic() - cached[0] < TTL:
            return cached[1]
    if not _slots.acquire(timeout=2):
        raise AnalysisError('Analysis is busy. Please retry in a moment.')
    try:
        data = analyze(symbol)
        # Upstream name search can resolve another listing; never silently substitute it.
        if data.get('meta', {}).get('symbol') != symbol:
            raise AnalysisError('The source did not return the selected listing.')
        data = {**data, 'available': True, 'source': 'Yahoo Finance', 'onDemand': True}
        with _lock:
            if len(_cache) >= 256:
                _cache.pop(next(iter(_cache)))
            _cache[symbol] = (time.monotonic(), data)
        return data
    finally:
        _slots.release()


@app.get('/api/lodestar')
@app.get('/api/lodestar/index')
def handle(symbol: str = Query(..., min_length=1, max_length=25, pattern=r'^[A-Z0-9][A-Z0-9.&_-]*$')):
    try:
        return JSONResponse(report(symbol), headers={'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300'})
    except AnalysisError as error:
        return JSONResponse({'available': False, 'symbol': symbol, 'reason': str(error)}, headers={'Cache-Control': 'no-store'})
    except Exception:
        return JSONResponse({'error': 'Company analysis is temporarily unavailable. Please retry.'}, status_code=503, headers={'Cache-Control': 'no-store'})
