"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { retryJobAction } from "@/lib/actions";

export function RetryButton({ jobId }: { jobId: string }) {
  const [pending, setPending] = React.useState(false);

  async function onClick() {
    setPending(true);
    const fd = new FormData();
    fd.set("job_id", jobId);
    const res = await retryJobAction({ ok: false }, fd);
    setPending(false);
    if (res.ok) toast.success("Retry enqueued");
    else toast.error(res.error ?? "Retry failed");
  }

  return (
    <Button variant="destructive" onClick={onClick} disabled={pending}>
      <RefreshCw className="h-4 w-4" />
      {pending ? "Retrying…" : "Retry"}
    </Button>
  );
}
