import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export default function QueueLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {["All", "In progress", "Done", "Failed"].map((label) => (
          <Skeleton key={label} className="h-9 w-24" />
        ))}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="border-b px-4 py-3">
          <div className="flex gap-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 flex-1" />
          </div>
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-0">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-4 w-16 font-mono" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </Card>
    </div>
  );
}
