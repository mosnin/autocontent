"use client";

import { Button, ButtonLink, Card } from "@/design-system";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: ErrorProps) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-[420px] p-5">
        <h1 className="text-[15px] font-medium">Something went wrong</h1>
        {/* Never render error.message here: it can leak internals. */}
        <p className="mt-1.5 text-[13px] text-fg-muted">An unexpected error occurred. Try again, or go back home.</p>
        {error.digest && <p className="mt-2 font-mono text-[11.5px] text-fg-faint">Error digest: {error.digest}</p>}
        <div className="mt-4 flex gap-1.5">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <ButtonLink href="/home" variant="secondary">
            Go home
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
