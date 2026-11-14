// Lighthouse's Node timing implementation clears process-wide performance marks.
// Keep the lock shared by every adapter instance, including simultaneous scans.
let tail: Promise<void> = Promise.resolve();

export async function serializeLighthouse<T>(snapshot: () => Promise<T>): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await snapshot();
  } finally {
    // Release only when the underlying snapshot settles, even if its caller timed out.
    release();
  }
}
