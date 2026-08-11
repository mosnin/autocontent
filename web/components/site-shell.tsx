"use client";

import * as React from "react";

import { SidebarProvider } from "@/components/ui/sidebar";
import { SquareSidebar } from "@/components/square/sidebar";
import { SquareHeader } from "@/components/square/header";

/**
 * Logged-in shell.
 *
 * Structurally this is still the sidebar + inset-panel composition the app
 * was built on, but the content gutter is editorial rather than the
 * template's fixed 1440px column:
 *
 *   - The measure is wider (1600px) and the horizontal padding is larger,
 *     because `Gallery` sizes itself by the artifact. A fixed narrow column
 *     forced media into thumbnails, which is precisely the inversion the
 *     editorial system undoes.
 *   - Vertical rhythm is owned by the page's own `Section`s (each carries
 *     its own bottom margin), so the shell contributes top padding only and
 *     never fights them.
 *
 * Long-form surfaces clamp themselves with `max-w-(--measure)`; the shell
 * deliberately does not impose a reading width on everything, because a
 * gallery and an article want different ones.
 */
export function SiteShell({
  children,
  account,
}: {
  children: React.ReactNode;
  /** Account slot — defaults to Clerk's UserButton; previews pass a stub. */
  account?: React.ReactNode;
}) {
  return (
    <SidebarProvider className="bg-sidebar">
      <SquareSidebar account={account} />
      <div className="h-svh overflow-hidden lg:p-2 w-full">
        <div className="lg:border lg:rounded-md overflow-hidden flex flex-col h-full w-full bg-background">
          <SquareHeader />
          <main className="w-full flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-[1600px] px-5 pb-16 pt-10 md:px-10">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
