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

// Human-readable labels for the raw JobStatus enum. Keeps the wire
// values in the badge's data model while showing something a person
// would actually say ("Generating images", not "generating_images").
const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: "Queued",
  ideating: "Ideating",
  scripting: "Scripting",
  generating_images: "Generating images",
  animating: "Animating",
  voicing: "Voicing",
  editing: "Editing",
  captioning: "Captioning",
  qa: "QA",
  scheduling: "Scheduling",
  awaiting_approval: "Awaiting approval",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

export function jobStatusLabel(status: JobStatus): string {
  return JOB_STATUS_LABELS[status] ?? status;
}

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
        className="gap-1.5 border-brand/50 font-mono text-brand"
        variant="outline"
      >
        <span aria-hidden className="size-2 rounded-full bg-brand" />
        Needs approval
      </Badge>
    );
  }
  return (
    <Badge className="gap-1.5 font-mono" variant={variant}>
      {recording && (
        <span aria-hidden className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-brand" />
        </span>
      )}
      {jobStatusLabel(status)}
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

const ARTICLE_STATUS_LABELS: Record<ArticleStatus, string> = {
  queued: "Queued",
  researching: "Researching",
  outlining: "Outlining",
  writing: "Writing",
  qa: "QA",
  metadata: "Metadata",
  imaging: "Imaging",
  done: "Done",
  failed: "Failed",
};

export function articleStatusLabel(status: ArticleStatus): string {
  return ARTICLE_STATUS_LABELS[status] ?? status;
}

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
    <Badge className="gap-1.5 font-mono" variant={variant}>
      {recording && (
        <span aria-hidden className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-brand" />
        </span>
      )}
      {articleStatusLabel(status)}
    </Badge>
  );
}
