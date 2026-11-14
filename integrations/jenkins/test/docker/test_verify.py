"""Negative acceptance checks without Docker or a live Jenkins boot."""
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import verify


class JenkinsApiAssertions(unittest.TestCase):
    def run_fixture(self, fixture, result, total=1, failures=0, skipped=0, missing=False):
        port = 4173 if fixture == 'bad' else 4174

        def response(path, *args):
            if path == '/crumbIssuer/api/json':
                return json.dumps({'crumbRequestField': 'Jenkins-Crumb', 'crumb': 'local-test'})
            if path.endswith('/buildWithParameters'):
                self.assertIn(f'SITE_URL=http://127.0.0.1:{port}/', args)
                self.assertIn('Jenkins-Crumb: local-test', args)
                return ''
            if path.endswith('/testReport/api/json'):
                if missing:
                    raise subprocess.CalledProcessError(22, ['curl'])
                return json.dumps({'_class': 'hudson.tasks.junit.TestResult', 'passCount': total - failures - skipped, 'failCount': failures, 'skipCount': skipped})
            if path.endswith('/consoleText'):
                return 'synthetic console'
            return json.dumps({'building': False, 'result': result})

        with tempfile.TemporaryDirectory() as directory:
            with patch.object(verify, 'output', pathlib.Path(directory)), patch.object(verify, 'request', response):
                return verify.verify(fixture)

    def test_expected_bad_and_clean(self):
        for result in ['UNSTABLE', 'FAILURE']:
            self.assertIn(result, self.run_fixture('bad', result, failures=1))
        self.assertIn('SUCCESS', self.run_fixture('clean', 'SUCCESS'))

    def test_mismatched_build_results_fail(self):
        for fixture, result in [('bad', 'SUCCESS'), ('clean', 'UNSTABLE'), ('clean', 'FAILURE')]:
            with self.subTest(fixture=fixture, result=result), self.assertRaises(AssertionError):
                self.run_fixture(fixture, result, failures=1)

    def test_bad_setup_failure_cannot_pass_without_junit(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_fixture('bad', 'FAILURE', missing=True)

    def test_empty_skipped_or_contradictory_junit_fails(self):
        for fixture, result, total, failures, skipped in [
            ('bad', 'FAILURE', 0, 0, 0),
            ('clean', 'SUCCESS', 0, 0, 0),
            ('bad', 'UNSTABLE', 1, 0, 0),
            ('clean', 'SUCCESS', 1, 1, 0),
            ('clean', 'SUCCESS', 1, 0, 1),
        ]:
            with self.subTest(fixture=fixture, total=total, failures=failures, skipped=skipped), self.assertRaises(AssertionError):
                self.run_fixture(fixture, result, total, failures, skipped)


if __name__ == '__main__':
    unittest.main()
