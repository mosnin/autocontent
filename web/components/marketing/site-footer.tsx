import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/marketing/nav/logo";

type FooterLink = {
  label: string;
  href: string;
};

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Overview", href: "/#overview" },
      { label: "How it works", href: "/#how-it-works" },
      { label: "Features", href: "/features" },
      { label: "Pricing", href: "/pricing" },
      { label: "FAQ", href: "/resources/faq" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/company" },
      { label: "Use cases", href: "/use-cases" },
      { label: "Resources", href: "/resources" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "/legal/privacy" },
      { label: "Terms of Service", href: "/legal/terms" },
      { label: "Cookie Policy", href: "/legal/cookies" },
    ],
  },
  {
    title: "Social",
    links: [
      { label: "X", href: "https://x.com" },
      { label: "LinkedIn", href: "https://www.linkedin.com" },
    ],
  },
];

export function Footer(): ReactNode {
  return (
    <footer className="border-border border-t">
      <div className="mx-auto max-w-[1440px] px-5 pt-16 sm:px-8 sm:pt-20 lg:px-10">
        <div className="flex flex-col gap-14 lg:flex-row lg:justify-between">
          <div className="max-w-xs">
            <Logo />
            <p className="text-muted-foreground mt-6 text-sm leading-relaxed">
              Autonomous marketing for video, articles, and ads. One brief in,
              every format out, every dollar capped.
            </p>
            <Link
              href="/sign-up"
              className="focus-ring bg-foreground text-background mt-8 inline-flex h-11 items-center rounded-full px-6 text-sm font-medium transition-opacity hover:opacity-85"
            >
              Start creating
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4 lg:gap-x-16">
            {COLUMNS.map((column) => (
              <div key={column.title}>
                <h3 className="text-foreground text-sm font-medium tracking-tight">
                  {column.title}
                </h3>
                <ul className="mt-4 space-y-3">
                  {column.links.map((link) => (
                    <li key={link.href}>
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
          <p className="text-muted translate-y-[22%] text-center text-[clamp(72px,18vw,260px)] leading-[0.85] font-medium tracking-tighter">
            marketer.sh
          </p>
        </div>
      </div>
    </footer>
  );
}
