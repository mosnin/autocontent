import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function SearchConsoleLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-4 w-80 max-w-full" />
          <Skeleton className="h-9 w-40" />
        </CardContent>
      </Card>
    </div>
  );
}
