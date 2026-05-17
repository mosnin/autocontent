import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function JobDetailLoading() {
  return (
    <div className="space-y-6">
      {/* Back button */}
      <Skeleton className="h-8 w-28" />

      {/* Job header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-4 w-40 font-mono" />
          </div>
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-44" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      {/* Two-column content */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Video card */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-28" />
          </CardHeader>
          <CardContent>
            <Skeleton className="aspect-[9/16] w-full rounded-lg" />
          </CardContent>
        </Card>

        {/* Tabs card */}
        <Card>
          <CardContent className="p-0">
            <div className="flex gap-2 border-b p-2">
              {["Script", "Scenes", "Costs", "Logs"].map((tab) => (
                <Skeleton key={tab} className="h-8 w-16" />
              ))}
            </div>
            <div className="space-y-3 p-6">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
