import { Card, Skeleton } from "@/design-system";
import { AdminFrame } from "./admin-frame";

/** Loading state for any admin page: the frame, then quiet placeholder blocks. */
export function AdminLoading({ title, kpis = 0, rows = 8 }: { title?: string; kpis?: number; rows?: number }) {
  return (
    <AdminFrame crumbs={title ? [{ label: title }] : []}>
      {kpis > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: kpis }).map((_, i) => (
            <Card key={i} className="space-y-3 p-3.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-20" />
            </Card>
          ))}
        </div>
      )}
      {rows > 0 && (
        <Card className="space-y-3 p-3.5">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="ml-auto h-3.5 w-20" />
            </div>
          ))}
        </Card>
      )}
    </AdminFrame>
  );
}
