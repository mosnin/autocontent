"use client";

// global-error.tsx replaces the root layout on crashes, so it renders its own
// <html> and <body>. The design-system tokens come from globals.css; `.ds`
// gives the dark default without the app shell.
import "../globals.css";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body className="ds flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-[420px] rounded-ds-lg border border-hairline bg-surface p-5">
          <h1 className="text-[15px] font-medium">Something went wrong</h1>
          {/* Never render error.message here: it can leak internals. */}
          <p className="mt-1.5 text-[13px] text-fg-muted">Marketer hit an unexpected error. Try again in a moment.</p>
          {error.digest && <p className="mt-2 font-mono text-[11.5px] text-fg-faint">Error digest: {error.digest}</p>}
          <div className="mt-4 flex gap-1.5">
            <button type="button" onClick={reset} className="inline-flex h-7 items-center rounded-ds-sm bg-ds-primary px-2.5 text-[13px] font-medium text-ds-primary-fg">
              Try again
            </button>
            <a href="/home" className="inline-flex h-7 items-center rounded-ds-sm border border-hairline bg-surface-2 px-2.5 text-[13px] font-medium text-fg">
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
