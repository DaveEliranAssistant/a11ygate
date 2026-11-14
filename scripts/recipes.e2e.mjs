import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const frameworks = ['nextjs', 'vite-react', 'angular', 'storybook'];
const selected = process.argv.slice(2);
if (selected.some((name) => !frameworks.includes(name))) throw new Error('Unknown framework');
function command(cmd, args, cwd = root, allowed = [0], track = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', STORYBOOK_DISABLE_TELEMETRY: '1', NG_CLI_ANALYTICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const pids = new Set();
    const timer = track ? setInterval(() => {
      const rows = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map((row) => row.trim().split(/\s+/).map(Number));
      const parents = new Set([child.pid]);
      for (let pass = 0; pass < 12; pass++) for (const [pid, parent] of rows) if (parents.has(parent)) { parents.add(pid); pids.add(pid); }
    }, 100) : undefined;
    child.stdout.on('data', (s) => { output += s; }); child.stderr.on('data', (s) => { output += s; });
    child.once('error', (error) => { clearInterval(timer); reject(error); });
    child.once('exit', async (code) => {
      clearInterval(timer);
      try {
        if (!allowed.includes(code)) throw new Error(`${cmd} ${args.join(' ')} exited ${code}\n${output}`);
        if (track) {
          assert.ok(pids.size > 1, 'must observe owned server descendants');
          for (let retry = 0; retry < 30; retry++) {
            const alive = [...pids].filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
            if (!alive.length) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          for (const pid of pids) assert.throws(() => process.kill(pid, 0), `orphan process ${pid}`);
        }
        resolve(output);
      } catch (error) { reject(error); }
    });
  });
}
async function portClosed(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(true));
  });
}
for (const [i, framework] of frameworks.entries()) {
  test(`${framework}: build → ready → planted issue → no server`, { skip: selected.length > 0 && !selected.includes(framework), timeout: 600_000 }, async () => {
    const cwd = path.join(root, 'examples/recipes', framework);
    const port = 4311 + i;
    assert.equal(await portClosed(port), true, 'port must be unused before test');
    await command('npm', ['ci', '--workspaces=false', '--no-audit', '--no-fund'], cwd);
    await command('npm', ['run', 'build'], cwd);
    // Keep docs code blocks byte-for-byte synchronized with executable files.
    const docs = await readFile(path.join(root, 'docs/recipes', `${framework}.md`), 'utf8');
    for (const file of ['scan.sh', 'init.sh']) assert.ok(docs.includes('```sh\n' + (await readFile(path.join(cwd, file), 'utf8')).trimEnd() + '\n```'));
    await rm(path.join(cwd, 'scan.json'), { force: true });
    try {
      await command('sh', ['scan.sh'], cwd, [1], true);
      const report = JSON.parse(await readFile(path.join(cwd, 'scan.json'), 'utf8'));
      assert.ok(report.findings.some((finding) => finding.ruleId === 'image-alt' || finding.id === 'image-alt'), JSON.stringify(report.findings));
      const urls = report.pages.map((page) => page.url).sort();
      if (framework === 'storybook') {
        const index = JSON.parse(await readFile(path.join(cwd, 'storybook-static/index.json'), 'utf8'));
        const expected = Object.values(index.entries).filter((entry) => entry.type === 'story').map((entry) => `http://127.0.0.1:${port}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story`).sort();
        assert.ok(expected.length >= 2);
        assert.deepEqual(urls, expected, 'every index story must be scanned');
      } else assert.deepEqual(urls, [`http://127.0.0.1:${port}/`]);
      await command('sh', ['init.sh'], cwd);
      const config = await readFile(path.join(cwd, '.a11ygate.yml'), 'utf8');
      assert.ok(config.includes(`http://127.0.0.1:${port}/`));
    } finally {
      assert.equal(await portClosed(port), true, 'owned server must stop even when scan exits 1');
    }
  });
}
test('published CLI excludes recipe dependencies and sources', async () => {
  const output = await command('npm', ['pack', '--dry-run', '--json'], path.join(root, 'packages/cli'));
  const files = JSON.parse(output)[0].files.map((f) => f.path);
  assert.ok(files.includes('dist/cli.mjs'));
  assert.ok(files.every((f) => !/(examples|node_modules|package-lock|recipes)/.test(f)), files.join('\n'));
});
