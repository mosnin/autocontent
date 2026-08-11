"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { LEGAL_DOCS } from "./legal-docs";

// Text-only legal navigation. The accent hairline marks the active
// document; no icons, no boxes — just type and space.
export function LegalNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Legal documents">
      <ul className="os-toc">
        {LEGAL_DOCS.map((doc) => {
          const href = `/legal/${doc.slug}`;
          const active = pathname === href;
          return (
            <li key={doc.slug}>
              <Link
                aria-current={active ? "page" : undefined}
                className={cn("os-toc__link", active && "os-toc__link--on")}
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
