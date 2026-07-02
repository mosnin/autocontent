"use client";

import * as React from "react";

import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-4">
          <SidebarTrigger aria-label="Toggle sidebar" />
          <Separator className="mr-1 h-4" orientation="vertical" />
          <span className="text-xs text-muted-foreground">
            <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              ⌘B
            </kbd>{" "}
            to collapse
          </span>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
