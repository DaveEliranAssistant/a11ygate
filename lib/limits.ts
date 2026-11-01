/** 8 MiB. Large enough for multi-page axe JSON, small enough to parse in the browser. */
export const MAX_AXE_JSON_BYTES = 8 * 1024 * 1024;

export function axeJsonByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function axeJsonTooLargeMessage(): string {
  return 'This file is larger than 8 MB. A11yGate reads scans in the browser, so split the results by page or remove the passes, incomplete, and inapplicable arrays before importing.';
}
