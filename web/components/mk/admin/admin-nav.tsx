"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "../ui";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/health", label: "Health" },
  { href: "/admin/flags", label: "Flags" },
  { href: "/admin/security", label: "Security" },
  { href: "/admin/media", label: "Media" },
  { href: "/admin/templates", label: "Templates" },
];

/** Section pills for the admin console; scrolls sideways inside itself on phones. */
export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="-mx-5 mb-8 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <div className="flex w-max gap-1.5">
        {LINKS.map((l) => {
          const active = l.href === "/admin" ? pathname === "/admin" : pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={cx("press inline-flex h-8 items-center rounded-full border px-3 text-[13px]", active ? "border-transparent bg-muted text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground")}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
