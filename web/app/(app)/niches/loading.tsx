import { Skeleton } from "@/components/square/ui/skeleton";

export default function NichesLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
        <span aria-hidden className="relative flex size-2">
          <span className="relative inline-flex size-2 rounded-full bg-brand" />
        </span>
        Loading
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>

      {/* Niches table */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center gap-3 p-4 border-b">
          <Skeleton className="h-8 w-full max-w-xs" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="ml-auto h-8 w-32" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <Skeleton className="size-6 rounded-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="ml-auto h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
