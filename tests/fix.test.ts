import { describe, expect, it } from 'vitest';
import {
  applySuggestion,
  buildSuggestionBody,
  findSuggestionComment,
  patchLines,
  planSuggestions,
  suggestionMarker,
  unifiedDiffLines,
  type SourceFile,
} from '@/lib/fix';
import { humanize } from '@/lib/fix/rules/accessible-name';
import { mapFinding } from '@/lib/fix/mapper';

function allLines(content: string): Set<number> {
  return new Set(content.split('\n').map((_, index) => index + 1));
}

function file(path: string, content: string, diffLines?: Iterable<number>): SourceFile {
  return { path, content, diffLines: diffLines ? new Set(diffLines) : allLines(content) };
}

/** Plans one finding against one file whose every line is in the diff; returns the fixed source or null. */
function fix(path: string, content: string, ruleId: string, html: string, lang?: string) {
  const plan = planSuggestions([{ fingerprint: 'fp1', ruleId, html, status: 'new' }], [file(path, content)], { lang });
  const suggestion = plan.suggestions[0];
  if (!suggestion) return { suggestion: null, output: null, skipped: plan.skipped[0]?.reason };
  return { suggestion, output: applySuggestion(content, suggestion), skipped: undefined };
}

describe('label rule', () => {
  it('adds for/id to the adjacent visible label (HTML)', () => {
    const src = '<form>\n  <label>Email</label>\n  <input id="email" type="email">\n</form>\n';
    const { output, suggestion } = fix('a.html', src, 'label', '<input id="email" type="email">');
    expect(output).toBe('<form>\n  <label for="email">Email</label>\n  <input id="email" type="email">\n</form>\n');
    expect(suggestion?.startLine).toBe(2);
    expect(suggestion?.endLine).toBe(2);
  });

  it('uses htmlFor in JSX', () => {
    const src = 'export const F = () => (\n  <p>\n    <label>Search</label> <input id="q" name="q" />\n  </p>\n);\n';
    const { output } = fix('F.tsx', src, 'label', '<input id="q" name="q">');
    expect(output).toContain('<label htmlFor="q">Search</label> <input id="q" name="q" />');
  });

  it('wraps a control without an id in the existing label', () => {
    const src = '<p><label>Name</label> <input name="name"></p>\n';
    const { output } = fix('a.html', src, 'label', '<input name="name">');
    expect(output).toBe('<p><label>Name <input name="name"></label></p>\n');
  });

  it('wraps a checkbox in a label that follows it', () => {
    const src = '<p><input type="checkbox" name="keep"> <label>Remember me</label></p>\n';
    const { output } = fix('a.html', src, 'label', '<input type="checkbox" name="keep">');
    expect(output).toBe('<p><label><input type="checkbox" name="keep"> Remember me</label></p>\n');
  });

  it('gives the control the id an existing label already points at', () => {
    const src = '<label for="city">City</label>\n<select name="city"><option>A</option></select>\n';
    const { output } = fix('a.html', src, 'label', '<select name="city">');
    expect(output).toContain('<select id="city" name="city">');
  });

  it('never invents a label when there is no visible label text', () => {
    expect(fix('a.html', '<p><input name="q"></p>\n', 'label', '<input name="q">').suggestion).toBeNull();
    expect(fix('a.html', '<label></label><input name="q">\n', 'label', '<input name="q">').suggestion).toBeNull();
  });
});

describe('button-name / link-name rule', () => {
  it('derives aria-label from an icon file name', () => {
    const src = '<button class="x"><img src="/icons/close-icon.svg"></button>\n';
    const { output, suggestion } = fix('a.html', src, 'button-name', '<button class="x">');
    expect(output).toBe('<button aria-label="Close" class="x"><img src="/icons/close-icon.svg"></button>\n');
    expect(suggestion?.placeholder).toBe(false);
  });

  it('derives aria-label from an icon component in JSX', () => {
    const src = 'const B = () => <button onClick={go}><TrashIcon /></button>;\n';
    const { output } = fix('B.tsx', src, 'button-name', '<button>');
    expect(output).toContain('<button aria-label="Trash" onClick={go}>');
  });

  it('copies the title of a link', () => {
    const src = '<a href="/cart" title="Cart"><svg></svg></a>\n';
    const { output } = fix('a.html', src, 'link-name', '<a href="/cart" title="Cart">');
    expect(output).toContain('<a aria-label="Cart" href="/cart" title="Cart">');
  });

  it('falls back to a TODO placeholder, never a made-up name', () => {
    const src = '<a href="/next"><span class="arrow"></span></a>\n';
    const { output, suggestion } = fix('a.html', src, 'link-name', '<a href="/next">');
    expect(output).toContain('aria-label="TODO(a11ygate): add accessible name"');
    expect(suggestion?.placeholder).toBe(true);
  });

  it('does not suggest when the control already has aria-label or visible text', () => {
    expect(fix('a.html', '<button aria-label="">x</button>\n', 'button-name', '<button aria-label="">').suggestion).toBeNull();
    expect(fix('a.html', '<button class="b">Save</button>\n', 'button-name', '<button class="b">').suggestion).toBeNull();
  });

  it('rejects hash-like file names', () => {
    expect(humanize('/static/media/a8f3k2.svg')).toBeNull();
    expect(humanize('icon-search')).toBe('Search');
    expect(humanize('arrowLeft')).toBe('Arrow left');
  });
});

describe('image-alt rule', () => {
  it('adds alt="" and an HTML TODO comment', () => {
    const src = '<main>\n  <img src="hero.jpg">\n</main>\n';
    const { output, suggestion } = fix('a.html', src, 'image-alt', '<img src="hero.jpg">');
    expect(output).toBe(
      '<main>\n  <!-- TODO(a11ygate): write alt text that describes this image, or confirm it is decorative and keep alt="" -->\n  <img alt="" src="hero.jpg">\n</main>\n',
    );
    expect(suggestion?.replacement).toHaveLength(2);
    expect(suggestion?.original).toHaveLength(1);
  });

  it('uses a JSX comment among JSX children', () => {
    const src = 'export default function P() {\n  return (\n    <div>\n      <img src={hero} />\n    </div>\n  );\n}\n';
    const { output } = fix('P.tsx', src, 'image-alt', '<img src="/_next/static/media/hero.123.jpg">');
    expect(output).toContain('      {/* TODO(a11ygate): write alt text');
    expect(output).toContain('      <img alt="" src={hero} />');
  });

  it('uses an in-tag comment when the JSX is not inside children', () => {
    const src = 'const I = () => <img src={hero} />;\n';
    const { output } = fix('I.tsx', src, 'image-alt', '<img src="/hero.jpg">');
    expect(output).toBe('const I = () => <img alt="" /* TODO(a11ygate): write alt text that describes this image, or confirm it is decorative and keep alt="" */ src={hero} />;\n');
  });

  it('does not suggest when alt is already present', () => {
    expect(fix('a.html', '<img src="a.png" alt="">\n', 'image-alt', '<img src="a.png" alt="">').suggestion).toBeNull();
  });
});

describe('clickable div/span rule', () => {
  it('converts a clickable div to a button and keeps attributes', () => {
    const src = '<div class="close" onclick="closeDialog()" aria-label="Close">\n  <span>×</span>\n</div>\n';
    const { output, suggestion } = fix('a.html', src, 'aria-prohibited-attr', '<div class="close" onclick="closeDialog()" aria-label="Close">');
    expect(output).toBe('<button type="button" class="close" onclick="closeDialog()" aria-label="Close">\n  <span>×</span>\n</button>\n');
    expect(suggestion?.startLine).toBe(1);
    expect(suggestion?.endLine).toBe(3);
  });

  it('converts a clickable span in JSX', () => {
    const src = 'const S = () => <span className="x" onClick={toggle}>Menu</span>;\n';
    const { output } = fix('S.tsx', src, 'aria-command-name', '<span class="x">');
    expect(output).toContain('<button type="button" className="x" onClick={toggle}>Menu</button>');
  });

  it('does not touch an element that is already a button or has block content', () => {
    expect(fix('a.html', '<button onclick="go()"></button>\n', 'aria-prohibited-attr', '<button onclick="go()">').suggestion).toBeNull();
    expect(fix('a.html', '<div onclick="go()"><p>x</p></div>\n', 'aria-prohibited-attr', '<div onclick="go()">').suggestion).toBeNull();
  });
});

describe('html-has-lang rule', () => {
  it('adds lang from config and a TODO comment (HTML)', () => {
    const src = '<!doctype html>\n<html>\n<head><title>x</title></head>\n</html>\n';
    const { output } = fix('index.html', src, 'html-has-lang', '<html>', 'de');
    expect(output).toContain('<html lang="de"><!-- TODO(a11ygate): confirm "de" is the main language of this document -->');
  });

  it('defaults to en and uses a JSX comment in TSX', () => {
    const src = 'export default function L({ children }) {\n  return (\n    <html className={font.className}>\n      <body>{children}</body>\n    </html>\n  );\n}\n';
    const { output } = fix('layout.tsx', src, 'html-has-lang', '<html class="inter">');
    expect(output).toContain('<html lang="en" className={font.className}>{/* TODO(a11ygate): confirm "en" is the main language of this document */}');
  });

  it('does not suggest when lang is set or the config value is invalid', () => {
    expect(fix('a.html', '<html lang="fr">\n</html>\n', 'html-has-lang', '<html lang="fr">').suggestion).toBeNull();
    expect(fix('a.html', '<html>\n</html>\n', 'html-has-lang', '<html>', '"><script>').output).toContain('lang="en"');
  });
});

describe('source/diff mapper', () => {
  const content = '<main>\n  <img src="a.png">\n  <p>text</p>\n  <img src="b.png">\n</main>\n';

  it('suggests on a changed line', () => {
    const plan = planSuggestions([{ fingerprint: 'f', ruleId: 'image-alt', html: '<img src="b.png">', status: 'new' }], [file('p.html', content, [4])]);
    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0].endLine).toBe(4);
  });

  it('does not suggest when the element is only outside the diff', () => {
    const plan = planSuggestions([{ fingerprint: 'f', ruleId: 'image-alt', html: '<img src="a.png">', status: 'new' }], [file('p.html', content, [4])]);
    expect(plan.suggestions).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('outside-diff');
  });

  it('does not suggest when the match is ambiguous', () => {
    const twice = '<img src="a.png">\n<img src="a.png">\n';
    const plan = planSuggestions([{ fingerprint: 'f', ruleId: 'image-alt', html: '<img src="a.png">', status: 'new' }], [file('p.html', twice)]);
    expect(plan.skipped[0].reason).toBe('ambiguous');
  });

  it('counts copies in other files as ambiguous too', () => {
    const outcome = mapFinding('<img src="a.png">', [file('one.html', '<img src="a.png">'), file('two.tsx', 'x = <img src="a.png" />')]);
    expect(outcome.status).toBe('ambiguous');
  });

  it('only suggests for new findings', () => {
    const plan = planSuggestions([{ fingerprint: 'f', ruleId: 'image-alt', html: '<img src="b.png">', status: 'still-open' }], [file('p.html', content)]);
    expect(plan.suggestions).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('not-new');
  });

  it('rejects a source tag with a different literal attribute', () => {
    const outcome = mapFinding('<input name="email">', [file('f.html', '<input name="phone">')]);
    expect(outcome.status).toBe('no-match');
  });

  it('reads head-side lines from a GitHub patch and a unified diff', () => {
    const patch = '@@ -1,3 +1,4 @@\n <main>\n-  <img>\n+  <img src="a.png">\n+  <img src="b.png">\n </main>';
    expect([...patchLines(patch)]).toEqual([1, 2, 3, 4]);
    const diff = `diff --git a/x.html b/x.html\nindex 1..2 100644\n--- a/x.html\n+++ b/x.html\n${patch}\n`;
    expect([...(unifiedDiffLines(diff).get('x.html') ?? [])]).toEqual([1, 2, 3, 4]);
  });
});

describe('review comment body', () => {
  const plan = planSuggestions(
    [
      { fingerprint: 'img-1', ruleId: 'image-alt', html: '<img src="hero.jpg">', status: 'new' },
      { fingerprint: 'btn-1', ruleId: 'button-name', html: '<button class="menu">', status: 'new' },
    ],
    [file('index.html', '<main>\n  <img src="hero.jpg">\n  <button class="menu"><span></span></button>\n</main>\n')],
  );

  it('contains the marker, a suggestion fence and a TODO placeholder', () => {
    expect(plan.suggestions).toHaveLength(2);
    for (const suggestion of plan.suggestions) {
      const body = buildSuggestionBody(suggestion);
      expect(body).toContain(suggestionMarker(suggestion.fingerprint));
      expect(body).toContain('```suggestion\n');
      expect(body).toContain(`\`\`\`suggestion\n${suggestion.replacement.join('\n')}\n\`\`\``);
      expect(body).toContain('TODO(a11ygate)');
      expect(body).toContain('Apply suggestion');
    }
  });

  it('never contains invented alt or aria-label prose', () => {
    for (const suggestion of plan.suggestions) {
      const code = suggestion.replacement.join('\n');
      for (const match of code.matchAll(/(?:alt|aria-label)="([^"]*)"/g)) {
        expect(match[1] === '' || match[1].includes('TODO(a11ygate)')).toBe(true);
      }
    }
  });

  it('finds an earlier comment by its marker', () => {
    const body = buildSuggestionBody(plan.suggestions[0]);
    expect(findSuggestionComment([{ id: 1, body: 'other' }, { id: 2, body }], plan.suggestions[0].fingerprint)?.id).toBe(2);
    expect(findSuggestionComment([{ id: 1, body }], 'different')).toBeNull();
  });
});
