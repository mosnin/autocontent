"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { LEGAL_DOCS } from "./legal-docs";

export function LegalNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Legal documents" className="mt-4">
      <ul className="flex flex-col gap-1 border-l border-border">
        {LEGAL_DOCS.map((doc) => {
          const href = `/legal/${doc.slug}`;
          const active = pathname === href;
          return (
            <li key={doc.slug}>
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring -ml-px block border-l border-transparent py-1.5 pl-4 text-sm transition-colors",
                  active
                    ? "border-foreground text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
                href={href}
              >
                {doc.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
