import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from api.lodestar import index as lodestar

class LodestarTests(unittest.TestCase):
    def setUp(self):
        lodestar._cache.clear()
        self.client = TestClient(lodestar.app)

    def test_real_model_result_and_cache(self):
        result = {'meta': {'symbol': 'TEGA.NS'}, 'verdict': {'action': 'HOLD', 'score': 50.9}}
        with patch.object(lodestar, 'analyze', return_value=result) as analyze:
            first = self.client.get('/api/lodestar?symbol=TEGA.NS')
            second = self.client.get('/api/lodestar?symbol=TEGA.NS')
        self.assertEqual(first.json()['verdict'], result['verdict'])
        self.assertTrue(first.json()['onDemand'])
        self.assertEqual(first.json(), second.json())
        self.assertEqual(analyze.call_count, 1)

    def test_invalid_symbol_never_reaches_source(self):
        with patch.object(lodestar, 'analyze') as analyze:
            response = self.client.get('/api/lodestar?symbol=../secret')
        self.assertEqual(response.status_code, 422)
        analyze.assert_not_called()

    def test_wrong_listing_is_not_cached_or_reported(self):
        with patch.object(lodestar, 'analyze', return_value={'meta': {'symbol': 'OTHER.NS'}}):
            response = self.client.get('/api/lodestar?symbol=TEGA.NS')
        self.assertFalse(response.json()['available'])
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(lodestar._cache, {})

    def test_source_failure_does_not_fabricate_a_score(self):
        with patch.object(lodestar, 'analyze', side_effect=RuntimeError('private provider failure')):
            response = self.client.get('/api/lodestar?symbol=TEGA.NS')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private', response.text)
        self.assertNotIn('verdict', response.json())

if __name__ == '__main__':
    unittest.main()
