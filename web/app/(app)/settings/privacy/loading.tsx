import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PrivacyLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* header */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      {/* export card */}
      <Card className="border-border/60 bg-card/40">
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full max-w-md" />
          <Skeleton className="h-4 w-full max-w-sm" />
          <div className="flex justify-end">
            <Skeleton className="h-9 w-40" />
          </div>
        </CardContent>
      </Card>

      {/* danger zone card */}
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-full max-w-sm" />
            <Skeleton className="h-9 w-36 shrink-0" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
