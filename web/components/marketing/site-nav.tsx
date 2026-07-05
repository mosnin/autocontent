"use client";

import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";

import { Button } from "@/components/ui/button";

const LINKS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
  { label: "The system", href: "#features" },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <Link className="flex items-center gap-2.5" href="/">
          {/* Mark: a closed loop — literally the product. */}
          <svg
            aria-hidden
            className="size-5 text-brand"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
          <span className="text-sm font-semibold tracking-tight">
            autocontent
          </span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {LINKS.map((l) => (
            <a
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              href={l.href}
              key={l.href}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <SignedIn>
            <Button asChild size="sm">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          </SignedIn>
          <SignedOut>
            <Button asChild size="sm" variant="ghost">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/sign-in">Start a channel</Link>
            </Button>
          </SignedOut>
        </div>
      </div>
    </header>
  );
}
