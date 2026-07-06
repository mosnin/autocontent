"use client";

import * as React from "react";

import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

/**
 * Reference-style shell: the sidebar rides directly on the warm page, and
 * the content is a white panel that floats inside it with a soft border,
 * rounded corners, and a whisper of shadow.
 */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider className="bg-page">
      <AppSidebar />
      <SidebarInset className="bg-page">
        <div className="flex min-h-svh flex-1 flex-col overflow-hidden border-border/70 bg-card md:m-2 md:ml-0 md:rounded-2xl md:border md:shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-16px_rgb(0_0_0/0.12)]">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-4">
            <SidebarTrigger aria-label="Toggle sidebar" />
            <Separator className="mr-1 h-4" orientation="vertical" />
            <span className="hidden text-xs text-muted-foreground sm:inline">
              <kbd className="rounded border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                ⌘B
              </kbd>{" "}
              to collapse
            </span>
          </header>
          <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 md:px-8 md:py-8">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
