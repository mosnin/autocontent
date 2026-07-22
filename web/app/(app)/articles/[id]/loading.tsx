import { Card, CardContent, CardHeader } from "@/components/square/ui/card";
import { Skeleton } from "@/components/square/ui/skeleton";

export default function ArticleDetailLoading() {
  return (
    <div className="space-y-6">
      {/* back nav */}
      <Skeleton className="h-8 w-36" />

      {/* header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-14" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-7 w-80 max-w-full" />
          <div className="flex gap-3 pt-1">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* article body */}
        <Card className="min-w-0 lg:w-2/3">
          <CardHeader className="space-y-2">
            <Skeleton className="h-5 w-24" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>

        {/* seo sidebar */}
        <div className="min-w-0 space-y-6 lg:w-1/3">
          <Card>
            <CardHeader className="space-y-2">
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
