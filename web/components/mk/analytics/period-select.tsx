"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cx, Segmented } from "../ui";

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export function parsePeriod(v: string | undefined): Period {
  const n = Number(v);
  return (PERIODS as readonly number[]).includes(n) ? (n as Period) : 30;
}

/** 7 / 30 / 90 days, kept in ?days= so the server refetches the window. */
export function PeriodSelect({ value, className }: { value: Period; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <Segmented
      label="Period"
      className={cx("w-[132px] transition-opacity", pending && "opacity-60", className)}
      value={String(value)}
      onChange={(v) => {
        const next = new URLSearchParams(params?.toString());
        next.set("days", v);
        start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
      }}
      options={PERIODS.map((p) => ({ value: String(p), label: `${p}d` }))}
    />
  );
}
