/** In-memory only. Never serialize the source credentials or this registry. */
export class AuthRedactor {
  private readonly values = new Set<string>();

  add(value: unknown): void {
    if (typeof value !== 'string' || !value) return;
    this.values.add(value);
    this.values.add(encodeURIComponent(value));
    this.values.add(Buffer.from(value).toString('base64'));
    try { this.values.add(decodeURIComponent(value)); } catch { /* Opaque cookies need not be URL encoded. */ }
    this.values.add(JSON.stringify(value).slice(1, -1));
    this.values.add(value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  }

  storage(state: { cookies?: { value: string }[]; origins?: { localStorage?: { value: string }[] }[] }): void {
    for (const cookie of state.cookies ?? []) this.add(cookie.value);
    for (const origin of state.origins ?? []) for (const entry of origin.localStorage ?? []) this.add(entry.value);
  }

  text(input: string): string {
    let output = input;
    for (const value of [...this.values].filter(Boolean).sort((a, b) => b.length - a.length)) {
      output = output.split(/(\[REDACTED\])/).map(part => part === '[REDACTED]' ? part : part.split(value).join('[REDACTED]')).join('');
    }
    return output
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
      .replace(/([?&](?:access_token|id_token|token|api_key|apikey|password|secret|client_secret)=)[^&\s"'<>]+/gi, '$1[REDACTED]')
      .replace(/((?:authorization|proxy-authorization|set-cookie|cookie)\s*:\s*)[^\r\n<>]+/gi, '$1[REDACTED]');
  }

  /** Redact before rendering, so escaping cannot hide credentials from the filter. */
  object<T>(input: T): T {
    const visit = (value: unknown): unknown => {
      if (typeof value === 'string') return this.text(value);
      if (Array.isArray(value)) return value.map(visit);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [this.text(key),
        /^(?:cookies?|set-cookie|authorization|proxy-authorization|.*token|password|secret|client_secret)$/i.test(key) ? '[REDACTED]' : visit(item)]));
      return value;
    };
    return visit(input) as T;
  }
}
