"""NSE clients: the live JSON API (needs the cookie warm-up dance) and the
static archives (participant OI, F&O bhavcopy) which need no cookies.

Gotchas (verified Oct 2026):
  * warm up on /option-chain, not the homepage (homepage 403s)
  * never send `Accept-Encoding: br` -- requests can't decode brotli here
  * UDiFF bhavcopy exists from 2024-07-05; earlier days use the old format
"""
from __future__ import annotations

import threading
import csv
import io
from datetime import datetime
import time

import requests

BASE = "https://www.nseindia.com"
ARCH = "https://nsearchives.nseindia.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
HEADERS = {
    "User-Agent": UA,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/option-chain",
    "X-Requested-With": "XMLHttpRequest",
}


class NSE:
    """Thread-safe live-API client. Re-warms cookies on 401/403. Responses are
    cached briefly so many viewers (public URL) share one NSE fetch."""

    CACHE_TTL = 20  # seconds

    def __init__(self):
        self._lock = threading.Lock()
        self._cache: dict[str, tuple[float, object]] = {}
        self._new_session()

    def _new_session(self):
        self.s = requests.Session()
        self.s.headers.update(HEADERS)
        self._warm()

    def _warm(self):
        try:
            self.s.get(f"{BASE}/option-chain", timeout=5)
        except requests.RequestException:
            pass

    def get(self, path: str, retries: int = 1):
        url = f"{BASE}{path}"
        last = None
        for attempt in range(retries):
            try:
                with self._lock:
                    hit = self._cache.get(path)
                    if hit and time.time() - hit[0] < self.CACHE_TTL:
                        return hit[1]
                    r = self.s.get(url, timeout=6)
                if r.status_code == 200:
                    j = r.json()
                    self._cache[path] = (time.time(), j)
                    return j
                last = f"HTTP {r.status_code}"
                if r.status_code in (401, 403):
                    with self._lock:
                        self._warm()
            except (requests.RequestException, ValueError) as e:
                last = str(e)
                if attempt == retries - 2:
                    with self._lock:
                        self._new_session()
            time.sleep(0.8 * (attempt + 1))
        raise RuntimeError(f"NSE refused {path}: {last}")

    # ------------------------------------------------------------ live feeds
    def lot_size(self, expiry: str) -> int:
        key = "contract-lots"
        hit = self._cache.get(key)
        if hit and time.time() - hit[0] < 3600:
            rows = hit[1]
        else:
            response = self.s.get(f"{ARCH}/content/fo/fo_mktlots.csv", timeout=8)
            response.raise_for_status()
            rows = [{k.strip(): v.strip() for k, v in row.items() if k and v}
                    for row in csv.DictReader(io.StringIO(response.text))]
            self._cache[key] = (time.time(), rows)
        month = datetime.strptime(expiry, "%d-%b-%Y").strftime("%b-%y").upper()
        row = next(r for r in rows if r.get("SYMBOL") == "NIFTY")
        lot = int(row[month])
        if lot <= 0:
            raise ValueError("Invalid NSE lot size")
        return lot

    def indices(self) -> dict:
        j = self.get("/api/allIndices")
        out = {"timestamp": j.get("timestamp", "")}
        for row in j.get("data", []):
            if row.get("index") in ("NIFTY 50", "INDIA VIX", "NIFTY BANK"):
                out[row["index"]] = row
        return out

    def expiries(self, symbol: str = "NIFTY") -> list[str]:
        j = self.get(f"/api/option-chain-contract-info?symbol={symbol}")
        return j.get("expiryDates") or []

    def chain(self, expiry: str, symbol: str = "NIFTY") -> dict:
        j = self.get(f"/api/option-chain-v3?type=Indices&symbol={symbol}"
                     f"&expiry={expiry.replace(' ', '%20')}")
        return j.get("records", {})

    def fii_dii_cash(self) -> list[dict]:
        return self.get("/api/fiidiiTradeReact") or []

    def market_status(self) -> dict:
        j = self.get("/api/marketStatus")
        for m in j.get("marketState", []):
            if m.get("market") == "Capital Market":
                return m
        return {}


class Archive:
    """nsearchives static files. 404 -> None (holiday / not yet published)."""

    def __init__(self):
        self.local = threading.local()

    def _session(self) -> requests.Session:
        s = getattr(self.local, "s", None)
        if s is None:
            s = requests.Session()
            s.headers.update({"User-Agent": UA, "Accept": "*/*",
                              "Referer": "https://www.nseindia.com/"})
            self.local.s = s
        return s

    def fetch(self, path: str, retries: int = 1) -> bytes | None:
        url = f"{ARCH}{path}"
        for attempt in range(retries):
            try:
                r = self._session().get(url, timeout=30)
                if r.status_code == 200:
                    return r.content
                if r.status_code == 404:
                    return None
            except requests.RequestException:
                pass
            time.sleep(1.0 * (attempt + 1))
        return None

    @staticmethod
    def participant_oi_path(d) -> str:
        return f"/content/nsccl/fao_participant_oi_{d:%d%m%Y}.csv"

    @staticmethod
    def bhavcopy_path(d) -> str:
        if (d.year, d.month, d.day) >= (2024, 7, 5):
            return f"/content/fo/BhavCopy_NSE_FO_0_0_0_{d:%Y%m%d}_F_0000.csv.zip"
        mon = d.strftime("%b").upper()
        return f"/content/historical/DERIVATIVES/{d.year}/{mon}/fo{d:%d}{mon}{d.year}bhav.csv.zip"
