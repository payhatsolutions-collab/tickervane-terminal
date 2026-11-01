import json
import unittest
from unittest.mock import patch
import numpy as np
from api import nifty_edge as api
from nifty_edge.storage import read_frame
from pathlib import Path
import pandas as pd

class HostedEdgeTests(unittest.TestCase):
    def test_clean_removes_non_finite_numbers(self):
        self.assertEqual(api.clean({'x':np.nan,'y':float('inf'),'z':np.int64(2)}), {'x':None,'y':None,'z':2})

    def test_lab_is_available_without_nse(self):
        response=api.handle(op='lab')
        self.assertEqual(response.status_code,200)
        self.assertTrue(json.loads(response.body)['built_at'])

    def test_non_finite_risk_is_rejected(self):
        response=api.handle(op='snapshot',capital=float('nan'),risk_pct=2.5,max_lots=10)
        self.assertEqual(response.status_code,422)

    def test_identical_requests_reuse_computation(self):
        class Calendar:
            def market_open(self, now): return True
        class Engine:
            cal=Calendar()
            calls=0
            def snapshot(self, settings):
                self.calls+=1
                return {'settings':settings}
        engine=Engine()
        with patch.object(api,'_engine',engine), patch.object(api,'_cache',{}):
            for _ in range(2):
                self.assertEqual(api.handle(capital=1000000,risk_pct=2.5,max_lots=10).status_code,200)
            self.assertEqual(engine.calls,1)
            api.handle(capital=10000,risk_pct=2.5,max_lots=10)
            self.assertEqual(engine.calls,2)

    def test_seed_preserves_dates_and_numeric_history(self):
        frame=read_frame(Path(__file__).resolve().parents[1]/'nifty_edge/seed/nifty_daily.json.gz')
        self.assertIsInstance(frame.index,pd.DatetimeIndex)
        self.assertTrue(np.isfinite(frame['close']).all())
        self.assertGreater(len(frame),4000)

if __name__=='__main__': unittest.main()
