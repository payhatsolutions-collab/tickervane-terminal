"""Run with the local nifty-edge virtualenv after updating/rebuilding that app.
Usage: ../nifty-edge/.venv/bin/python scripts/refresh-nifty-edge-seed.py ../nifty-edge
Then stage, verify and promote a deployment to publish the new research version.
Never copies the user's private paper journal.
"""
import shutil
import sys
from pathlib import Path
import pandas as pd

source = Path(sys.argv[1]).resolve() / 'data'
target = Path(__file__).resolve().parents[1] / 'nifty_edge' / 'seed'
sys.path.insert(0, str(target.parents[1]))
from nifty_edge.storage import write_frame
for name in ('lab.json', 'holidays.json'):
    shutil.copy2(source / name, target / name)
for name in ('lab_trades', 'lab_signals', 'nifty_daily', 'participant_oi', 'bhav_all'):
    frame = pd.read_parquet(source / (name + '.parquet'))
    if name == 'bhav_all':
        frame = frame[frame.date == frame.date.max()]
    write_frame(frame, target / (name + '.json.gz'))
print('Updated research seed; private journal excluded.')
