"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { LEGAL_DOCS } from "./legal-docs";

// Text-only legal navigation. A hairline marks the active document; no icons,
// no boxes — just type and space.
export function LegalNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Legal documents" className="space-y-1">
      {LEGAL_DOCS.map((doc) => {
        const href = `/legal/${doc.slug}`;
        const active = pathname === href;
        return (
          <Link
            key={doc.slug}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "block border-l-2 py-1.5 pl-4 text-sm transition-colors",
              active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {doc.title}
          </Link>
        );
      })}
    </nav>
  );
}
