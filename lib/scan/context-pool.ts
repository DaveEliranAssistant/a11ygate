/**
 * Browser-context pool that optionally recycles the context every N pages.
 *
 * Without `recycleEvery` it holds exactly one context for the whole scan, which is
 * the historical behaviour. With it, the N+1st page opens in a fresh context; the
 * retired context closes once its in-flight pages have been released, so concurrent
 * workers are never cut off mid-analysis.
 */
export type ClosableContext = { close: () => Promise<void> };

type Slot<C> = { context: C; opened: number; active: number; retired: boolean; closed?: Promise<void> };

export class ContextPool<C extends ClosableContext> {
  private current?: Slot<C>;
  private creating?: Promise<Slot<C>>;
  private readonly live = new Set<Slot<C>>();
  /** Number of contexts created, including the first. */
  created = 0;
  /** Number of contexts retired because they reached the page budget. */
  recycled = 0;

  constructor(private readonly create: () => Promise<C>, readonly recycleEvery?: number) {
    if (recycleEvery !== undefined && (!Number.isInteger(recycleEvery) || recycleEvery < 1)) throw new Error('recycleEvery must be a positive integer.');
  }

  /** Create the first context eagerly so setup errors surface before scanning. */
  async init(): Promise<C> {
    return (await this.slot(false)).context;
  }

  private async fresh(): Promise<Slot<C>> {
    const slot: Slot<C> = { context: await this.create(), opened: 0, active: 0, retired: false };
    this.created += 1;
    this.live.add(slot);
    this.current = slot;
    return slot;
  }

  /** Pick (and, when `reserve`, synchronously reserve a page in) the current slot. */
  private async slot(reserve = true): Promise<Slot<C>> {
    for (;;) {
      while (this.creating) await this.creating.catch(() => undefined);
      const current = this.current;
      if (current && !(this.recycleEvery !== undefined && current.opened >= this.recycleEvery)) {
        if (reserve) { current.opened += 1; current.active += 1; }
        return current;
      }
      if (current) {
        current.retired = true;
        this.recycled += 1;
        if (current.active === 0) void this.dispose(current);
        this.current = undefined;
      }
      this.creating = this.fresh();
      try { await this.creating; } finally { this.creating = undefined; }
    }
  }

  private dispose(slot: Slot<C>): Promise<void> {
    slot.closed ??= slot.context.close().catch(() => undefined).finally(() => { this.live.delete(slot); });
    return slot.closed;
  }

  /** Reserve a page slot in the current context. Call `release` once the page is closed. */
  async acquire(): Promise<{ context: C; release: () => void }> {
    const slot = await this.slot();
    let released = false;
    return {
      context: slot.context,
      release: () => {
        if (released) return;
        released = true;
        slot.active -= 1;
        if (slot.retired && slot.active === 0) void this.dispose(slot);
      },
    };
  }

  /** Number of contexts that are open right now (current plus retired ones still draining). */
  get openContexts(): number {
    return [...this.live].filter((slot) => !slot.closed).length;
  }

  async close(): Promise<void> {
    while (this.creating) await this.creating.catch(() => undefined);
    await Promise.all([...this.live].map((slot) => this.dispose(slot)));
    this.current = undefined;
  }
}
