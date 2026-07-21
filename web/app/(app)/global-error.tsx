"use client";

// global-error.tsx replaces the root layout on segment-level crashes,
// so it must render its own <html> + <body>. Tailwind works here;
// the theme provider has NOT mounted, so we use raw CSS rather than
// CSS custom properties that depend on it.

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  const message = error.message ?? "An unexpected error occurred.";
  const truncated = message.length > 800 ? message.slice(0, 800) + "…" : message;

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-white p-6 font-sans text-gray-900">
        <div className="w-full max-w-lg rounded-lg border border-red-200 bg-red-50 p-8 text-center shadow-sm">
          <h1 className="mb-2 text-xl font-semibold text-gray-900">
            Something went wrong
          </h1>
          <pre className="mb-6 overflow-x-auto rounded border border-red-200 bg-white p-3 text-left text-sm text-gray-600 whitespace-pre-wrap break-words">
            {truncated}
          </pre>
          <div className="flex justify-center gap-3">
            <button
              onClick={reset}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Try again
            </button>
            <a
              href="/dashboard"
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Go to dashboard
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
