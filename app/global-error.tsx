'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#f3efe6',
          color: '#1c1712',
          fontFamily: 'system-ui, sans-serif',
          lineHeight: 1.5,
        }}
      >
        <main id="main" tabIndex={-1} style={{ maxWidth: '40rem', margin: '2rem auto', padding: '0 1.25rem' }}>
          <h1>Something went wrong</h1>
          <p role="alert">A11yGate hit an unexpected error. Your files were not uploaded.</p>
          {error.digest ? <p>Reference: {error.digest}</p> : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              minHeight: 44,
              padding: '0.5rem 0.9rem',
              font: 'inherit',
              color: '#f7f3ea',
              background: '#1c1712',
              border: '2px solid #1c1712',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
