import { Skeleton } from "@/components/ui/skeleton";

export default function NewAdCampaignLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
        <span aria-hidden className="relative flex size-2">
          <span className="relative inline-flex size-2 rounded-full bg-brand" />
        </span>
        Loading
      </div>
      <div className="space-y-2">
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-96 max-w-xl rounded-lg" />
    </div>
  );
}
