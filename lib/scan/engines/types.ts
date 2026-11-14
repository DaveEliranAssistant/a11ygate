import type { NormalizedFinding } from './normalized';

/** Engines analyze an existing session. Navigation, crawling and lifecycle belong to the caller. */
export interface Engine<Context, NativeResults> {
  readonly id: string;
  readonly displayName: string;
  run(context: Context, url: string): Promise<NativeResults>;
  normalize(results: NativeResults): NormalizedFinding[];
}

export type EngineExecution<NativeResults> =
  | { engine: string; status: 'complete'; native: NativeResults; findings: NormalizedFinding[] }
  | { engine: string; status: 'errored'; error: string };

/** Catch both analyzer and mapper errors so callers can continue with later engines. */
export async function runEngine<Context, NativeResults>(engine: Engine<Context, NativeResults>, context: Context, url: string): Promise<EngineExecution<NativeResults>> {
  try {
    const native = await engine.run(context, url);
    return { engine: engine.id, status: 'complete', native, findings: engine.normalize(native) };
  } catch (error) {
    return { engine: engine.id, status: 'errored', error: error instanceof Error ? error.message.split('\n')[0]! : 'Engine failed.' };
  }
}
