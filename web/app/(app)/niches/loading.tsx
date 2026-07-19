import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";

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
        <Skeleton className="h-9 w-28" />
      </div>

      {/* Niche cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="flex flex-col">
            <CardHeader className="pb-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="mt-1 h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </CardHeader>
            <CardContent className="flex-1 space-y-4 pb-3">
              <Skeleton className="h-4 w-40" />
              <div className="flex flex-wrap gap-1.5">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-14" />
                <Skeleton className="h-5 w-20" />
              </div>
              <Skeleton className="h-4 w-48" />
            </CardContent>
            <CardFooter className="flex items-center justify-between pt-0">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
