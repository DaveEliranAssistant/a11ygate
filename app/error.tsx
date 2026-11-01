'use client';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="shell" tabIndex={-1}>
      <h1>Something went wrong</h1>
      <p role="alert">
        A11yGate hit an unexpected error and stopped this view. Your files were not uploaded.
      </p>
      {error.digest ? <p>Reference: {error.digest}</p> : null}
      <button type="button" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
