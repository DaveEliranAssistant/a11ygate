/** Head-side line numbers inside the hunks of one file patch (GitHub `files[].patch`). */
export function patchLines(patch: string): Set<number> {
  const lines = new Set<number>();
  let right = 0;
  let inHunk = false;
  for (const line of String(patch ?? '').split('\n')) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      right = Number(header[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+') || line.startsWith(' ')) {
      lines.add(right);
      right += 1;
    } else if (line === '' ) {
      // A trailing empty string from split, or a context line stripped of its space.
      continue;
    }
    // '-' lines and '\ No newline at end of file' do not move the head side.
  }
  return lines;
}

/** Head-side hunk lines per file from a full unified diff (`git diff`). */
export function unifiedDiffLines(diff: string): Map<string, Set<number>> {
  const files = new Map<string, Set<number>>();
  const chunks = String(diff ?? '').split(/^diff --git /m);
  for (const chunk of chunks) {
    const target = /^\+\+\+ (?:b\/)?(.+)$/m.exec(chunk);
    if (!target || target[1].trim() === '/dev/null') continue;
    const at = chunk.indexOf('\n@@');
    if (at < 0) continue;
    files.set(target[1].trim(), patchLines(chunk.slice(at + 1)));
  }
  return files;
}
