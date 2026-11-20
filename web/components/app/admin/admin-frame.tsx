"use client";

import { Shield } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Canvas, Chip, PageHeader, Toolbar } from "@/design-system";

const SECTIONS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/health", label: "Health" },
  { href: "/admin/flags", label: "Flags" },
  { href: "/admin/security", label: "Security" },
  { href: "/admin/media", label: "Media" },
  { href: "/admin/templates", label: "Templates" },
];

/**
 * The admin console frame (ref 05, dashboard): a 48px header with crumbs and
 * actions, the section switcher, an optional filter toolbar, then the canvas.
 */
export function AdminFrame({ crumbs = [], actions, toolbar, toolbarEnd, children }: { crumbs?: { label: string; href?: string }[]; actions?: ReactNode; toolbar?: ReactNode; toolbarEnd?: ReactNode; children: ReactNode }) {
  const pathname = (usePathname() ?? "").replace(/^\/preview\/app/, "");
  const current = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <>
      <PageHeader icon={<Shield />} crumbs={[{ label: "Admin", href: crumbs.length ? "/admin" : undefined }, ...crumbs]} actions={actions} />
      <nav aria-label="Admin sections" className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pt-3 [scrollbar-width:none]">
        {SECTIONS.map((s) => (
          <Chip key={s.href} href={s.href} selected={current(s.href)}>
            {s.label}
          </Chip>
        ))}
      </nav>
      {(toolbar || toolbarEnd) && <Toolbar end={toolbarEnd}>{toolbar}</Toolbar>}
      <Canvas>{children}</Canvas>
    </>
  );
}
