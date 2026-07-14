// Shadcn variant mapping for JobStatus. Preserves the same JSX shape
// callers expect: <StatusBadge status={...} />.
//
// In-flight jobs get the recording-light treatment: a pulsing brand dot,
// the same visual grammar as the marketing site's "live" indicators.
import { Badge } from "@/components/ui/badge";
import type { ArticleStatus, JobStatus } from "@/lib/types";

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
  if (status === "queued" || status === "skipped") return "secondary";
  if (status === "awaiting_approval") return "outline";
  return "outline";
}

export function StatusBadge({ status }: { status: JobStatus }) {
  const variant = statusVariant(status);
  const recording = IN_PROGRESS.has(status);
  if (status === "awaiting_approval") {
    return (
      <Badge
        className="gap-1.5 border-brand/50 font-mono lowercase text-brand"
        variant="outline"
      >
        <span aria-hidden className="size-2 rounded-full bg-brand" />
        needs approval
      </Badge>
    );
  }
  return (
    <Badge className="gap-1.5 font-mono lowercase" variant={variant}>
      {recording && (
        <span aria-hidden className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-brand" />
        </span>
      )}
      {status}
    </Badge>
  );
}

// --- Written-content pipeline ------------------------------------------

/** Article statuses that mean "the pipeline is actively working". */
export const ARTICLE_IN_PROGRESS: ReadonlySet<ArticleStatus> = new Set([
  "researching",
  "outlining",
  "writing",
  "qa",
  "metadata",
  "imaging",
]);

export function articleStatusVariant(status: ArticleStatus): Variant {
  if (status === "done") return "success";
  if (status === "failed") return "destructive";
  if (status === "queued") return "secondary";
  return "outline";
}

export function ArticleStatusBadge({ status }: { status: ArticleStatus }) {
  const variant = articleStatusVariant(status);
  const recording = ARTICLE_IN_PROGRESS.has(status);
  return (
    <Badge className="gap-1.5 font-mono lowercase" variant={variant}>
      {recording && (
        <span aria-hidden className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-brand" />
        </span>
      )}
      {status}
    </Badge>
  );
}
