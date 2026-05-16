// Shadcn variant mapping for JobStatus. Replaces the older inline
// StatusBadge component while preserving the same JSX shape callers
// expect: <StatusBadge status={...} />.
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/lib/types";

type Variant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success";

const IN_PROGRESS: Set<JobStatus> = new Set([
  "ideating",
  "scripting",
  "generating_images",
  "animating",
  "voicing",
  "editing",
  "captioning",
  "qa",
  "scheduling",
]);

export function statusVariant(status: JobStatus): Variant {
  if (status === "done") return "success";
  if (status === "failed") return "destructive";
  if (status === "queued") return "secondary";
  return "default";
}

export function StatusBadge({ status }: { status: JobStatus }) {
  const variant = statusVariant(status);
  const showSpinner = IN_PROGRESS.has(status);
  return (
    <Badge variant={variant} className="gap-1 font-mono lowercase">
      {showSpinner && <Loader2 className="h-3 w-3 animate-spin" />}
      {status}
    </Badge>
  );
}
