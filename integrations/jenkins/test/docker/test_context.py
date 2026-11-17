"""The Docker build context must contain every file `npm run cli:build` bundles.

Walks static imports from each esbuild entry point in packages/cli/build.mjs,
resolving relative and `@/` specifiers inside the generated context, so a new
JSON/TS dependency outside the allowlist fails here instead of in the nightly
Docker build.
"""
import pathlib
import re
import tempfile
import unittest

import context

ROOT = pathlib.Path(__file__).resolve().parents[4]
ENTRY = re.compile(r"entryPoints:\s*\[path\.join\((packageRoot|repoRoot),\s*([^)]*)\)\]")
IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(?\s*|\bexport\s*\*\s*from\s*)['"]([^'"]+)['"]""")
EXTENSIONS = ('', '.ts', '.tsx', '.mts', '.mjs', '.js', '/index.ts', '/index.tsx')


def entry_points(source):
    text = (source / 'packages/cli/build.mjs').read_text(encoding='utf-8')
    for base, parts in ENTRY.findall(text):
        segments = re.findall(r"'([^']+)'", parts)
        yield (source / 'packages/cli' if base == 'packageRoot' else source).joinpath(*segments)


def resolve(source, importer, spec):
    if spec.startswith('@/'):
        base = source / spec[2:]
    elif spec.startswith('.'):
        base = importer.parent / spec
    else:
        return None  # package import, installed by npm ci
    for ext in EXTENSIONS:
        candidate = pathlib.Path(f'{base}{ext}')
        if candidate.is_file():
            return candidate.resolve()
    return pathlib.Path(base).resolve()


def bundled_files(source):
    seen, pending, missing = set(), list(entry_points(source)), []
    while pending:
        file = pending.pop().resolve()
        if file in seen:
            continue
        seen.add(file)
        if not file.is_file():
            missing.append(file)
            continue
        if file.suffix == '.json':
            continue
        for spec in IMPORT.findall(file.read_text(encoding='utf-8', errors='replace')):
            target = resolve(source, file, spec)
            if target is not None:
                pending.append(target)
    return seen, missing


class BuildContext(unittest.TestCase):
    def test_bundled_inputs_are_in_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            context.build_context(ROOT, tmp)
            source = (pathlib.Path(tmp) / 'source').resolve()
            seen, missing = bundled_files(source)
            self.assertGreaterEqual(len(list(entry_points(source))), 1)
            self.assertEqual([str(m.relative_to(source)) for m in missing], [])
            relative = {str(f.relative_to(source)) for f in seen}
            for required in ('schema/a11ygate.schema.json', 'schema/a11ygate.projects.schema.json', 'locales/en.json'):
                self.assertIn(required, relative)
            self.assertTrue(any(r.startswith('docs/perf/chromium-bench-') for r in relative))
            self.assertTrue((pathlib.Path(tmp) / 'Dockerfile').is_file())

    def test_context_excludes_working_tree_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            context.build_context(ROOT, tmp)
            source = pathlib.Path(tmp) / 'source'
            for name in ('.git', '.env', '.npmrc', 'app', 'docs/perf/README.md', 'docs/perf/chromium-bench-all-40.md'):
                self.assertFalse((source / name).exists(), name)
            self.assertFalse(list(source.rglob('node_modules')))


if __name__ == '__main__':
    unittest.main()
