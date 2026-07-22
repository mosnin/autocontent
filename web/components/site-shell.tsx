"use client";

import * as React from "react";

import { SidebarProvider } from "@/components/square/ui/sidebar";
import { SquareSidebar } from "@/components/square/sidebar";
import { SquareHeader } from "@/components/square/header";

/**
 * Logged-in shell — the Square UI "marketing-dashboard" template's page
 * composition (app/page.tsx), ported faithfully: SidebarProvider on the
 * sidebar surface, the sidebar itself, and a rounded inset panel holding
 * the sticky header plus a scrollable main region. Page content keeps a
 * centered max-width gutter so every existing (app) page renders as-is.
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
            <div className="mx-auto w-full max-w-[1440px] px-4 py-8 md:px-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
