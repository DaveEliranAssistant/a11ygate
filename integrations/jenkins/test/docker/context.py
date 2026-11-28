"""Build the Docker context for the Jenkins acceptance image from an explicit allowlist.

The context is never the owner's working tree wholesale (no .git, .env, npm config,
host node_modules, or credentials). `npm run cli:build` bundles JSON that lives
outside packages/ and lib/ (config schemas, the locale catalog, the pricing and
own-host allowlist config used by `a11ygate prospect`, Chromium benchmark data
used by `a11ygate estimate`, and the ten outreach templates plus demo-shop fixture
used by `a11ygate outreach`, listed file by file), so those are listed here too.
config/ holds only committed, non-secret JSON; .env* and .npmrc are ignored everywhere.
"""
import pathlib
import shutil
import sys

# Directories or single files, relative to the repository root.
PATHS = [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'packages',
    'lib',
    'scripts',
    'schema',
    'config',
    'locales',
    'examples/jenkins',
    'integrations/gitlab/a11ygate.gitlab-ci.yml',
    'integrations/azure-devops/a11ygate.yml',
    'integrations/jenkins/vars',
    'integrations/jenkins/test/docker',
    'docs/pilot/outreach/conversion-email.md',
    'docs/pilot/outreach/demo-invite.md',
    'docs/pilot/outreach/first-touch-email.md',
    'docs/pilot/outreach/first-touch-linkedin.md',
    'docs/pilot/outreach/follow-up-1.md',
    'docs/pilot/outreach/follow-up-2.md',
    'docs/pilot/outreach/objections.md',
    'docs/pilot/outreach/pilot-proposal.md',
    'docs/pilot/outreach/post-demo-recap.md',
    'docs/pilot/outreach/warm-intro-request.md',
    'fixtures/demo-shop-current.json',
]
# Glob patterns, relative to the repository root, for data files bundled by the CLI build.
GLOBS = ['docs/perf/chromium-bench-*.json']
IGNORE = shutil.ignore_patterns('node_modules', 'dist', '.gradle', 'build', '.env*', '.npmrc', '__pycache__')


def build_context(root, context):
    root, context = pathlib.Path(root), pathlib.Path(context)
    dest = context / 'source'
    dest.mkdir()
    for name in PATHS:
        _copy(root / name, dest / name)
    for pattern in GLOBS:
        matches = sorted(root.glob(pattern))
        if not matches:
            raise SystemExit(f'No files match required build input {pattern}')
        for src in matches:
            _copy(src, dest / src.relative_to(root))
    shutil.copy2(root / 'integrations/jenkins/test/docker/Dockerfile', context / 'Dockerfile')


def _copy(src, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        shutil.copytree(src, target, ignore=IGNORE)
    else:
        shutil.copy2(src, target)


if __name__ == '__main__':
    build_context(*sys.argv[1:3])
