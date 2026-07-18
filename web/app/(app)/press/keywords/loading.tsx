import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function KeywordsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-10 w-full" />
          </div>
          <Skeleton className="h-9 w-40" />
        </CardContent>
      </Card>

      <Skeleton className="h-10 w-72" />

      <Card className="gap-0 overflow-hidden py-0">
        <CardContent className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
