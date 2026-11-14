import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTOMATED_TESTING_DISCLAIMER } from '@/lib/copy';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const docPath = path.join(repoRoot, 'docs/integrations/jenkins.md');

const CLAIM_RE = /fixes everything|WCAG\/EAA compliant|\bcertified\b|\bguarantee\b/i;
const INCLUDE_RE = /<!-- include:([^\s]+?) -->\s*```(?:\w+)?\n([\s\S]*?)```/g;
const LINK_RE = /\[[^\]]*]\(([^)]+)\)/g;

describe('docs/integrations/jenkins.md', () => {
  it('includes the exact files used by the Jenkins tests, with no copy-paste drift', async () => {
    const doc = await readFile(docPath, 'utf8');
    const includes = [...doc.matchAll(INCLUDE_RE)];
    expect(includes.map((match) => match[1])).toEqual([
      'examples/jenkins/Jenkinsfile.sh-step',
      'examples/jenkins/Jenkinsfile',
      'examples/jenkins/Jenkinsfile.scripted',
      'examples/jenkins/record-issues.groovy',
    ]);
    for (const match of includes) {
      const rel = match[1] as string;
      const expected = (await readFile(path.join(repoRoot, rel), 'utf8')).replace(/\s+$/, '');
      const fenced = (match[2] as string).replace(/\s+$/, '');
      expect(fenced, rel).toBe(expected);
    }
  });

  it('has a working markdown link check for relative targets', async () => {
    const doc = await readFile(docPath, 'utf8');
    const hrefs = [...doc.matchAll(LINK_RE)].map((match) => match[1] as string);
    expect(hrefs.length).toBeGreaterThan(5);
    const missing: string[] = [];
    for (const href of hrefs) {
      if (href.startsWith('http://') || href.startsWith('https://')) {
        expect(href).toMatch(/^https:\/\//);
        continue;
      }
      const [file, hash] = href.split('#');
      if (!file) continue;
      const target = path.resolve(path.dirname(docPath), file);
      try {
        await stat(target);
      } catch {
        missing.push(href);
      }
      void hash;
    }
    expect(missing, missing.join(', ')).toEqual([]);
  });

  it('includes the disclaimer and makes no compliance claims', async () => {
    const doc = await readFile(docPath, 'utf8');
    expect(doc).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(doc).not.toMatch(CLAIM_RE);
    const shStep = await readFile(path.join(repoRoot, 'examples/jenkins/Jenkinsfile.sh-step'), 'utf8');
    expect(shStep).toContain(AUTOMATED_TESTING_DISCLAIMER);
    expect(shStep).not.toMatch(CLAIM_RE);
  });
});
