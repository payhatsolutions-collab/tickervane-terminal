"""Hosted read-only research seed and on-demand daily-price cache.
Full archive maintenance remains in the original local NIFTY EDGE application.
"""
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote
import numpy as np
import pandas as pd
import requests
from nifty_edge.storage import read_frame, write_frame

DATA = Path(os.environ['NIFTY_EDGE_DATA'])
DAILY_FILE = DATA / 'nifty_daily.json.gz'
POI_FILE = DATA / 'participant_oi.json.gz'
BHAV_ALL = DATA / 'bhav_all.json.gz'
IST = timezone(timedelta(hours=5, minutes=30))


def load_daily():
    return read_frame(DAILY_FILE)


def load_participant():
    return read_frame(POI_FILE)


def load_bhav():
    return read_frame(BHAV_ALL)


def recent_prices(symbol):
    response = requests.get(f'https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol)}',
                            params={'range':'1mo', 'interval':'1d'},
                            headers={'User-Agent':'Mozilla/5.0'}, timeout=8)
    response.raise_for_status()
    result = response.json()['chart']['result'][0]
    frame = pd.DataFrame(result['indicators']['quote'][0],
                         index=pd.to_datetime(result['timestamp'], unit='s', utc=True).tz_convert(IST).tz_localize(None).normalize())
    # Never persist an unfinished daily bar as completed history.
    return frame[frame.index < pd.Timestamp(datetime.now(IST).date())].dropna(subset=['close'])


def update_daily(live_bar=None):
    frame = load_daily()
    if time.time() - DAILY_FILE.stat().st_mtime > 6*3600:
        try:
            price, vix = recent_prices('^NSEI'), recent_prices('^INDIAVIX')
            fresh = price[['open','high','low','close']].copy()
            fresh['vix'] = vix['close'].reindex(fresh.index)
            fresh['vix_high'] = vix['high'].reindex(fresh.index)
            fresh = fresh.dropna()
            frame = pd.concat([frame.loc[~frame.index.isin(fresh.index)], fresh]).sort_index()
            write_frame(frame, DAILY_FILE)
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError):
            pass  # Engine checks missing recent trading sessions before producing a call.
    if live_bar and live_bar.get('final'):
        day = pd.Timestamp(live_bar['date'])
        if day not in frame.index:
            frame.loc[day] = [live_bar.get(c, np.nan) for c in frame.columns]
            frame = frame.sort_index()
            write_frame(frame, DAILY_FILE)
    return frame
