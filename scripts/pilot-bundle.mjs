import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const packageRoot = path.join(repoRoot, 'packages/cli');
const output = path.join(repoRoot, 'pilot-bundle');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const manifest = await readJson(path.join(packageRoot, 'package.json'));
const lockfile = await readJson(path.join(repoRoot, 'package-lock.json'));
const playwright = lockfile.packages['node_modules/playwright'].version;
const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const archive = `qe-atlas-a11ygate-${manifest.version}-${sha}.tgz`;

await mkdir(output, { recursive: true });
const stage = await mkdtemp(path.join(output, '.stage-'));
try {
  const packageStage = path.join(stage, 'package');
  await mkdir(packageStage);
  const bin = path.normalize(manifest.bin.a11ygate);
  for (const file of ['package.json', ...manifest.files.filter((file) => file !== bin)]) {
    await copyFile(path.join(packageRoot, file), path.join(packageStage, file));
  }
  execFileSync(process.execPath, [path.join(packageRoot, 'build.mjs')], {
    cwd: repoRoot,
    env: { ...process.env, A11YGATE_PILOT_STAGE: packageStage, A11YGATE_PILOT_SOURCE_SHA: sha },
    stdio: 'inherit',
  });
  const [packed] = JSON.parse(execFileSync('npm', [
    'pack', '.', '--json', '--offline', '--ignore-scripts', '--workspaces=false', '--pack-destination', stage,
  ], { cwd: packageStage, encoding: 'utf8' }));
  const packedPath = path.join(stage, packed.filename);
  const checksum = createHash('sha256').update(await readFile(packedPath)).digest('hex');
  const template = await readFile(new URL('./pilot-install.template.md', import.meta.url), 'utf8');
  await writeFile(path.join(stage, 'INSTALL.md'), template.replaceAll('{{archive}}', archive).replaceAll('{{playwright}}', playwright));
  await writeFile(path.join(stage, 'SHA256SUMS'), `${checksum}  ${archive}\n`);
  await rename(packedPath, path.join(output, archive));
  await rename(path.join(stage, 'SHA256SUMS'), path.join(output, 'SHA256SUMS'));
  await rename(path.join(stage, 'INSTALL.md'), path.join(output, 'INSTALL.md'));
  console.log(`Wrote pilot-bundle/${archive}, SHA256SUMS and INSTALL.md.`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
