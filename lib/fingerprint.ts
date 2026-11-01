/**
 * Fingerprints stay stable when a build changes generated ids, CSS-module
 * hashes, or nth-child positions, and change when the rule, the element, or
 * the page path changes.
 */

function unescapeCss(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

function isDynamicId(id: string): boolean {
  const value = id.trim();
  if (value.length === 0) return false;
  if (/^:r[0-9a-z]+:?$/i.test(value)) return true;
  if (/^ember\d+$/i.test(value)) return true;
  if (/^(?:react|mui|headlessui|radix)-/i.test(value) && /\d/.test(value)) return true;
  if (
    /(?:^|[-_])[a-f0-9]{6,}(?:$|[-_])/i.test(value) &&
    /\d/.test(value) &&
    /[a-f]/i.test(value)
  ) {
    return true;
  }
  if (/[-_]\d{4,}$/.test(value) || /^\d{4,}$/.test(value)) return true;
  return false;
}

function stripDynamicIds(selector: string): string {
  const withoutAttributes = selector.replace(
    /\[id=(?:'([^']*)'|"([^"]*)"|([^\]]+))\]/gi,
    (match, single: string | undefined, double: string | undefined, bare: string | undefined) => {
      const id = unescapeCss(single ?? double ?? bare ?? '');
      return isDynamicId(id) ? '' : match;
    },
  );

  return withoutAttributes.replace(/#(?:\\.|[^\s#.\[>,+~])+/g, (match) => {
    const id = unescapeCss(match.slice(1));
    return isDynamicId(id) ? '' : match;
  });
}

function stripHashClasses(selector: string): string {
  return selector
    .replace(/\.css-[a-z0-9]+\b/gi, '')
    .replace(/\.([A-Za-z_][\w-]*?)__[A-Za-z0-9]{5,}\b/g, '.$1');
}

function tidySelector(selector: string): string {
  let current = selector.replace(/\s+/g, ' ').trim();
  let previous = '';
  while (current !== previous) {
    previous = current;
    current = current
      .replace(/\s*>\s*>\s*/g, ' > ')
      .replace(/\s*\+\s*\+\s*/g, ' + ')
      .replace(/^\s*[>+~]\s*/, '')
      .replace(/\s*[>+~]\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return current;
}

export function normaliseSelector(selector: string): string {
  const withoutIndexes = selector
    .trim()
    .replace(/:nth-(?:last-)?(?:child|of-type)\([^)]*\)/gi, '');
  return tidySelector(stripHashClasses(stripDynamicIds(withoutIndexes)));
}

export function pagePath(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    let path = parsed.pathname || '/';
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return path || '/';
  } catch {
    const withoutQuery = trimmed.split(/[?#]/)[0] ?? '';
    if (withoutQuery.length === 0) return '/';
    let path = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return path;
  }
}

export function fingerprint(ruleId: string, selector: string, url: string): string {
  return `${ruleId}|${normaliseSelector(selector)}|${pagePath(url)}`;
}
