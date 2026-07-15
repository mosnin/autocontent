import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function BrandKitLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* header */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-lg" />
        <Skeleton className="h-4 w-3/4 max-w-md" />
      </div>

      {/* identity card */}
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* voice & keywords card */}
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-12 rounded-lg" />
            <Skeleton className="h-8 w-40" />
          </div>
        </CardContent>
      </Card>

      {/* save bar */}
      <div className="flex justify-end">
        <Skeleton className="h-9 w-36" />
      </div>
    </div>
  );
}
