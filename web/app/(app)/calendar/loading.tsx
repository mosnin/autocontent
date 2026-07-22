import { Skeleton } from "@/components/square/ui/skeleton";

export default function CalendarLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
        <span aria-hidden className="relative flex size-2">
          <span className="relative inline-flex size-2 rounded-full bg-brand" />
        </span>
        Loading
      </div>

      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Calendar table */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center gap-3 p-4 border-b">
          <Skeleton className="h-8 w-full max-w-xs" />
          <Skeleton className="h-8 w-20" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
