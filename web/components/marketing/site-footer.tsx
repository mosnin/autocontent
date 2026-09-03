import { BrandWordmark } from "@/components/brand-logo";
import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/marketing/nav/logo";
import {
  LEGAL_LINKS,
  PRODUCT_LINKS,
  RESOURCE_LINKS,
  SOCIAL_LINKS,
} from "@/components/marketing/nav/menu-data";

type FooterLink = {
  label: string;
  href: string;
};

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      ...PRODUCT_LINKS.map(({ label, href }) => ({ label, href })),
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Resources",
    links: RESOURCE_LINKS.map(({ label, href }) => ({ label, href })),
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "Legal", href: "/legal" },
    ],
  },
  {
    title: "Legal",
    links: LEGAL_LINKS.filter((link) => link.href !== "/legal"),
  },
  {
    title: "Social",
    links: SOCIAL_LINKS,
  },
];

export function Footer(): ReactNode {
  return (
    <footer className="border-border border-t">
      <div className="mx-auto max-w-[1440px] px-5 pt-16 sm:px-8 sm:pt-20 lg:px-10">
        <div className="flex flex-col gap-14 lg:flex-row lg:justify-between">
          <div className="max-w-xs">
            <Logo tone="black" />
            <p className="text-muted-foreground mt-6 text-sm leading-relaxed">
              An AI agent that makes your marketing: videos, SEO articles, and
              ads. You set a budget. It does the work.
            </p>
            <Link
              href="/sign-up"
              className="focus-ring bg-foreground text-background mt-8 inline-flex h-11 items-center rounded-full px-6 text-sm font-medium transition-opacity hover:opacity-85"
            >
              Start creating
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:grid-cols-5 lg:gap-x-10">
            {COLUMNS.map((column) => (
              <div key={column.title}>
                <h3 className="text-foreground text-sm font-medium tracking-tight">
                  {column.title}
                </h3>
                <ul className="mt-4 space-y-3">
                  {column.links.map((link) => (
                    <li key={`${column.title}-${link.href}`}>
                      <Link
                        href={link.href}
                        className="focus-ring text-muted-foreground hover:text-foreground text-sm transition-colors"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col-reverse items-start justify-between gap-4 pt-6 sm:flex-row sm:items-center">
          <p className="text-muted-foreground text-xs">
            © {new Date().getFullYear()} marketer.sh. All rights reserved.
          </p>
          <p className="text-muted-foreground text-xs">
            Prepaid credits. No subscription.
          </p>
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none overflow-hidden select-none"
        >
          <BrandWordmark className="translate-y-[22%] opacity-25 dark:invert" />
        </div>
      </div>
    </footer>
  );
}
