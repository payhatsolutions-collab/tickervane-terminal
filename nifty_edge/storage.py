"""Compact, portable data frames without a parquet runtime dependency."""
import gzip
import json
from pathlib import Path
import pandas as pd


def write_frame(frame, path):
    payload = json.loads(frame.to_json(orient='split', date_format='iso'))
    payload['date_columns'] = [c for c in frame.columns if pd.api.types.is_datetime64_any_dtype(frame[c])]
    payload['date_index'] = isinstance(frame.index, pd.DatetimeIndex)
    with gzip.open(path, 'wt') as f:
        json.dump(payload, f, allow_nan=False, separators=(',', ':'))


def read_frame(path):
    with gzip.open(path, 'rt') as f:
        payload = json.load(f)
    frame = pd.DataFrame(payload['data'], columns=payload['columns'], index=payload['index'])
    for column in payload.get('date_columns', []):
        frame[column] = pd.to_datetime(frame[column])
    if payload.get('date_index'):
        frame.index = pd.to_datetime(frame.index)
    return frame
