import type { DepartmentId } from "@/lib/departments";

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export function parsePeriod(v: string | undefined): Period {
  const n = Number(v);
  return (PERIODS as readonly number[]).includes(n) ? (n as Period) : 30;
}

/** Deep link that opens a new session with a department and a first question. */
export function askHref(q?: string, dept: DepartmentId = "analytics"): string {
  return `/sessions/new?dept=${dept}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
}
