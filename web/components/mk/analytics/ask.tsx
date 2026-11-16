import { Sparkles } from "lucide-react";
import Link from "next/link";
import type { DepartmentId } from "@/lib/departments";
import { cx } from "../cx";

/** Deep link that opens a new session with a department and a first question. */
export function askHref(q?: string, dept: DepartmentId = "analytics"): string {
  return `/sessions/new?dept=${dept}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
}

/**
 * The small "Why?" affordance next to any metric an agent could explain.
 * Could be promoted to components/mk/ui.tsx: every number in the product
 * should be one click from an explanation.
 */
export function AskWhy({ q, dept = "analytics", label = "Why?", className }: { q: string; dept?: DepartmentId; label?: string; className?: string }) {
  return (
    <Link
      href={askHref(q, dept)}
      title={q}
      className={cx("press inline-flex shrink-0 items-center gap-1 rounded-full text-[12px] text-faint transition-colors hover:text-accent [&_svg]:size-3", className)}
    >
      <Sparkles aria-hidden />
      {label}
    </Link>
  );
}
