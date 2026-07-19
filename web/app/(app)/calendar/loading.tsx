import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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

      {/* Range switcher */}
      <Skeleton className="h-10 w-80 max-w-full" />

      {/* Day sections */}
      {Array.from({ length: 3 }).map((_, s) => (
        <div key={s} className="space-y-3">
          <div className="flex items-baseline gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Card className="gap-0 overflow-hidden py-0">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b px-4 py-3 last:border-0"
              >
                <Skeleton className="h-4 w-12 font-mono" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}
