"use client";

/**
 * Page skeletons: what a route's `loading.tsx` renders while its server fetch
 * runs. One per page template (README §5), so the frame doesn't jump when the
 * data lands. Quiet blocks only; the header keeps the real title.
 */
import type { ReactNode } from "react";
import { cx } from "../cx";
import { Skeleton } from "./kit";
import { Canvas, Card, Column, PageHeader } from "./layout";

export type PageSkeletonTemplate = "column" | "tool" | "dashboard" | "detail" | "chat" | "home";

const Busy = ({ label, children, className }: { label: string; children: ReactNode; className?: string }) => (
  <div role="status" aria-busy="true" className={cx("flex min-h-0 flex-1 flex-col", className)}>
    <span className="sr-only">Loading {label}</span>
    {children}
  </div>
);

function Rows({ n = 5 }: { n?: number }) {
  return (
    <Card className="divide-y divide-hairline">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex h-12 items-center gap-3 px-3.5">
          <Skeleton className="size-7 shrink-0 rounded-ds-md" />
          <Skeleton className={cx("h-3.5", i % 3 === 0 ? "w-1/2" : i % 3 === 1 ? "w-2/5" : "w-3/5")} />
          <Skeleton className="ml-auto h-3.5 w-14" />
        </div>
      ))}
    </Card>
  );
}

function Kpis({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => (
        <Card key={i} className="space-y-3 p-3.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-24" />
        </Card>
      ))}
    </div>
  );
}

export function PageSkeleton({
  template = "column",
  title,
  crumbs,
  icon,
  width = "md",
  rows = 5,
}: {
  template?: PageSkeletonTemplate;
  /** The page's real title, shown in the 48px header while it loads. */
  title: string;
  crumbs?: { label: string; href?: string }[];
  icon?: ReactNode;
  width?: "sm" | "md" | "lg";
  rows?: number;
}) {
  if (template === "home")
    return (
      <Busy label={title}>
        <div className="mx-auto w-full max-w-[1000px] px-5 pt-[12vh] sm:px-6">
          <div className="mx-auto max-w-[720px] space-y-5">
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-[120px] w-full rounded-ds-xl" />
          </div>
          <div className="mt-16 grid gap-3 md:grid-cols-12">
            <Skeleton className="h-40 rounded-ds-lg md:col-span-5" />
            <Skeleton className="h-40 rounded-ds-lg md:col-span-7" />
            <Skeleton className="h-28 rounded-ds-lg md:col-span-2" />
            <Skeleton className="h-28 rounded-ds-lg md:col-span-6" />
            <Skeleton className="h-28 rounded-ds-lg md:col-span-4" />
          </div>
        </div>
      </Busy>
    );

  const header = <PageHeader icon={icon} title={crumbs ? undefined : title} crumbs={crumbs} />;

  if (template === "chat")
    return (
      <Busy label={title}>
        {header}
        <div className="mx-auto w-full max-w-[720px] flex-1 space-y-6 px-5 pt-6">
          <Skeleton className="ml-auto h-9 w-2/3 rounded-ds-bubble" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        </div>
        <div className="mx-auto w-full max-w-[720px] px-4 pb-4">
          <Skeleton className="h-[104px] w-full rounded-ds-xl" />
        </div>
      </Busy>
    );

  if (template === "dashboard")
    return (
      <Busy label={title}>
        {header}
        <div className="flex gap-1.5 px-4 pt-3">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-7 w-24" />
        </div>
        <Canvas>
          <Kpis />
          <Card className="p-3.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-4 h-[220px] w-full rounded-ds-md" />
          </Card>
          <div className="grid gap-3 lg:grid-cols-2">
            <Rows n={4} />
            <Rows n={4} />
          </div>
        </Canvas>
      </Busy>
    );

  return (
    <Busy label={title}>
      {header}
      <Column
        width={template === "tool" ? "lg" : width}
        title={<Skeleton className="h-7 w-48" />}
        description={<Skeleton className="h-4 w-72 max-w-full" />}
        control={template === "detail" ? undefined : <Skeleton className={cx("w-full rounded-ds-md", template === "tool" ? "h-[88px] rounded-ds-xl" : "h-8 max-w-[260px]")} />}
      >
        {template === "tool" && <Kpis />}
        {template === "detail" && (
          <Card className="divide-y divide-hairline">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex h-10 items-center justify-between px-3.5">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-28" />
              </div>
            ))}
          </Card>
        )}
        <div className="space-y-3">
          <Skeleton className="h-4 w-28" />
          <Rows n={rows} />
        </div>
      </Column>
    </Busy>
  );
}
