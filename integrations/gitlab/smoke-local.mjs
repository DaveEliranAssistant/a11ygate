// Executes the template's exact scan script against an existing static fixture.
// Separate from vitest: this manual integration check requires installed Chromium.
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import Ajv from 'ajv';

const root = fileURLToPath(new URL('../../', import.meta.url));
const template = yaml.load(await readFile(new URL('./a11ygate.gitlab-ci.yml', import.meta.url), 'utf8'));
const schema = JSON.parse(await readFile(new URL('../../tests/schemas/gitlab-codequality.schema.json', import.meta.url), 'utf8'));
const cwd = await mkdtemp(path.join(tmpdir(), 'a11ygate-gitlab-smoke-'));
const fixture = path.join(root, 'fixtures/scan-site');
const requests = [];
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  requests.push(pathname);
  const file = path.resolve(fixture, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(fixture + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.png') ? 'image/png' : 'text/plain');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
try {
  await symlink(path.join(root, 'node_modules'), path.join(cwd, 'node_modules'), 'dir');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const [policy, expected] of [['serious', 1], ['none', 0]]) {
    const child = spawn('/bin/sh', ['-c', template.a11ygate.script.join('\n')], {
      cwd, stdio: 'inherit', env: { ...process.env, A11YGATE_URL: url, A11YGATE_FAIL_ON: policy, npm_config_offline: 'true', npm_config_update_notifier: 'false' },
    });
    const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(exit, expected, `--fail-on ${policy}`);
    const report = JSON.parse(await readFile(path.join(cwd, template.a11ygate.artifacts.reports.codequality), 'utf8'));
    const validate = new Ajv().compile(schema);
    assert(validate(report), JSON.stringify(validate.errors));
    assert(report.some((issue) => issue.check_name === 'image-alt'));
    assert(report.every((issue) => issue.description.includes(url)));
    const junit = await readFile(path.join(cwd, template.a11ygate.artifacts.reports.junit), 'utf8');
    assert(junit.includes('<testsuite'));
    console.log(`Template script: fail-on=${policy}, exit=${exit}, ${report.length} Code Quality issue(s), JUnit present.`);
  }
  assert(requests.includes('/robots.txt'));
  assert(!requests.includes('/private/secret.html'));
  console.log('Local fixture smoke passed. No GitLab account or Docker used.');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(cwd, { recursive: true, force: true });
}
