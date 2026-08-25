"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { IntroDone } from "@/components/marketing/intro-done";
import { Logo } from "@/components/marketing/nav/logo";
import { SkipToContent } from "@/components/marketing/skip-to-content";
import { ThemeSwitch } from "@/components/marketing/theme-switch";
import { SidebarProvider } from "@/components/square/ui/sidebar";
import { SquareSidebar } from "@/components/square/sidebar";
import { SquareHeader } from "@/components/square/header";

function OnboardingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing-site flex min-h-svh flex-col">
      <IntroDone />
      <SkipToContent />
      <header className="flex h-20 items-center px-5 sm:px-8">
        <Logo />
      </header>
      <main
        id="main-content"
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 pb-20 sm:px-8"
      >
        {children}
      </main>
      <ThemeSwitch />
    </div>
  );
}

/**
 * Logged-in shell. Onboarding uses the Cortex marketing canvas (no
 * dashboard chrome). Everything else uses the Square dashboard template.
 */
export function SiteShell({
  children,
  account,
}: {
  children: React.ReactNode;
  account?: React.ReactNode;
}) {
  const pathname = usePathname();
  if (pathname.startsWith("/onboarding")) {
    return <OnboardingShell>{children}</OnboardingShell>;
  }

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
