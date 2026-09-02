'use client';

import { AlertOctagon, RotateCcw } from 'lucide-react';

/**
 * Last-resort error boundary. It replaces the root layout, so it cannot use the
 * app's providers or fonts and must render its own <html>/<body> with inline
 * styles only.
 *
 * The error message is never shown: at this level it may contain a stack trace
 * or a configuration detail. The digest is enough to find it in the server log.
 */
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
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '1.5rem',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <div
            style={{
              width: '3.5rem',
              height: '3.5rem',
              margin: '0 auto',
              display: 'grid',
              placeItems: 'center',
              borderRadius: '1rem',
              background: 'rgba(220, 38, 38, 0.12)',
              color: '#dc2626',
            }}
          >
            <AlertOctagon size={28} />
          </div>

          <h1 style={{ margin: '1.25rem 0 0.5rem', fontSize: '1.5rem', fontWeight: 600 }}>
            Something went wrong
          </h1>
          <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.6, color: '#475569' }}>
            The application hit an unexpected error. Nothing in the vault has been changed.
          </p>

          {error.digest ? (
            <p
              style={{
                margin: '0.75rem 0 0',
                fontSize: '0.75rem',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: '#94a3b8',
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.7rem 1.4rem',
              borderRadius: '0.625rem',
              border: 'none',
              background: '#4f46e5',
              color: '#ffffff',
              fontSize: '0.9375rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <RotateCcw size={16} />
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
