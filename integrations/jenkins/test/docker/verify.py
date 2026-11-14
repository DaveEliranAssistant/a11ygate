#!/usr/bin/env python3
"""Read real build and JUnit results through the loopback Jenkins HTTP API."""
import json
import pathlib
import subprocess
import sys
import time

container = ''
output = pathlib.Path('.')
BASE = 'http://127.0.0.1:8080'


def request(path, *args):
    return subprocess.check_output([
        'docker', 'exec', container, 'curl', '--silent', '--show-error', '--fail',
        '--connect-timeout', '3', '--max-time', '15',
        '--cookie-jar', '/tmp/api-cookies', '--cookie', '/tmp/api-cookies',
        *args, BASE + path,
    ], text=True)


def api(path):
    return json.loads(request(path))


def until(description, probe, timeout=600):
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            value = probe()
            if value:
                return value
        except (subprocess.CalledProcessError, json.JSONDecodeError) as error:
            last_error = str(error)
        time.sleep(3)
    raise RuntimeError(f'Timed out waiting for {description}; last error: {last_error}')


def completed(path):
    build = api(path + 'api/json')
    return build if not build['building'] and build.get('result') else None


def verify(fixture):
    path = f'/job/{fixture}/1/'
    # Keep CSRF protection enabled: obtain a crumb in the same anonymous session.
    crumb = api('/crumbIssuer/api/json')
    request(f'/job/{fixture}/buildWithParameters', '-X', 'POST',
            '-H', f"{crumb['crumbRequestField']}: {crumb['crumb']}",
            '--data-urlencode', f'SITE_URL=http://127.0.0.1:{4173 if fixture == "bad" else 4174}/',
            '--data-urlencode', 'FAIL_ON=serious')
    try:
        build = until(f'{fixture} build completion', lambda: completed(path))
        (output / f'{fixture}-build.json').write_text(json.dumps(build, indent=2))
        # A 404 or missing/empty suite is an error, even if BAD was already FAILURE.
        report = api(path + 'testReport/api/json')
        (output / f'{fixture}-junit.json').write_text(json.dumps(report, indent=2))
        assert report['totalCount'] > 0, f'{fixture}: no JUnit testcases'
        assert report['skipCount'] == 0, f'{fixture}: unexpectedly skipped JUnit tests'
        if fixture == 'bad':
            assert build['result'] in ('UNSTABLE', 'FAILURE'), build['result']
            assert report['failCount'] > 0, 'BAD did not publish failing JUnit tests'
        else:
            assert build['result'] == 'SUCCESS', build['result']
            assert report['failCount'] == 0, 'clean published failing JUnit tests'
        summary = (f"{fixture.upper()} → {build['result']}; "
                   f"JUnit API: {report['totalCount']} tests, {report['failCount']} failures")
        print(summary, flush=True)
        return summary
    finally:
        try:
            (output / f'{fixture}-console.log').write_text(request(path + 'consoleText'))
        except subprocess.CalledProcessError:
            pass


def main():
    global container, output
    container, directory = sys.argv[1:]
    output = pathlib.Path(directory)
    until('JCasC jobs and Jenkins startup', lambda: api('/job/clean/api/json'))
    headers = request('/api/json', '-I')
    version = next(line.split(':', 1)[1].strip() for line in headers.splitlines()
                   if line.lower().startswith('x-jenkins:'))
    assert version == '2.580.2', f'Unexpected Jenkins version: {version}'
    print(f'Jenkins {version}', flush=True)
    summaries = [verify(fixture) for fixture in ('bad', 'clean')]
    (output / 'summary.md').write_text(f'Tested on Jenkins {version}\n\n' + '\n\n'.join(summaries) + '\n')


if __name__ == '__main__':
    main()
